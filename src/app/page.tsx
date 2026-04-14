"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import CHARACTERS from "../data/characters.json";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { ChatRoomPanel } from "../components/ChatRoomPanel";
import { GoldCoinIcon } from "../components/GoldCoinIcon";
import { MyRankStatus } from "../components/MyRankStatus";
import { DEFAULT_INITIAL_RATING } from "../lib/rating";
import {
  ensureAnonymousSession,
  getFirebaseAuth,
} from "../lib/firebaseClient";
import { DEBUG_USER_UPDATED_EVENT } from "../lib/debugUserEvents";
import { useAdminMode } from "@/components/AdminModeProvider";
import { isAdminUid } from "../lib/adminUids";
import { validateDisplayName } from "../lib/validateDisplayName";
import {
  normalizeRoomCode,
  ROOM_UNLIMITED_GUESS_CAP,
  type RoomDocument,
} from "@/lib/roomTypes";
import { roomPasswordInputKey, sha256HexUtf8 } from "@/lib/roomHash";
import { dissolveRoomClient } from "@/lib/roomDissolve";
import { PLAYER_NAME_STORAGE_KEY } from "@/lib/playerNameStorage";

type Character = (typeof CHARACTERS)[number];

type RoomPresencePlayer = {
  uid: string;
  displayName: string;
  joinedMs: number;
};

const MAX_GUESSES = 7;
/** これ未満では降参不可（API の MIN と一致） */
const MIN_GUESSES_TO_RESIGN = 4;
/** 対戦（ゴーストあり） / 個人（ゴーストなし） */
const BATTLE_MODE_KEY = "genshin-guesser-battle-mode";
const ACCENT = "text-[#ece5d8]";

/** 「※クイズは既に始まっています…」直下の臨時お知らせ。不要になったら `false` にするか、定数＋QUIZ_LINE_NOTICE の JSX ごと削除。 */
const SHOW_PLAY_GUIDE_MAINTENANCE_NOTICE = true;
const PLAY_GUIDE_MAINTENANCE_NOTICE_TEXT =
  "本日は勝ってもレートが増えません。\n" +
  "リアルタイム対戦準備中に鯖落ちさせたことが原因で17時ごろ復活予定です。再発するようであればリアルタイム対戦は実装しません。よろしくお願いします。";

function normalizeForSearch(s: string) {
  const t = s.trim().replace(/\s+/g, "");
  const noLongVowel = t.replace(/ー/g, "");
  return noLongVowel.replace(/[ァ-ヶ]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60)
  );
}

function getVer(c: Character): number | null {
  const anyC = c as unknown as { ver?: unknown; version?: unknown };
  const v = anyC.ver ?? anyC.version;
  return typeof v === "number" ? v : null;
}

function pickRandomTarget(list: Character[]): Character {
  const i = Math.floor(Math.random() * list.length);
  return list[i]!;
}

function matchClass(ok: boolean) {
  return ok
    ? "border-emerald-500/70 bg-emerald-950/50 text-emerald-100 shadow-[0_0_20px_-6px_rgba(52,211,153,0.45)]"
    : "border-[#ece5d8]/20 bg-[#12182a]/95 text-[#ece5d8]/95";
}

type GhostInfo = {
  ghostRunId: string;
  displayName: string;
  handCount: number;
};

type RatingStats = {
  before: number;
  after: number;
  delta: number;
  alreadySubmitted: boolean;
  /** 正解キャラの全プレイヤー記録に基づく平均手数（単純平均・サーバー算出） */
  characterAverageHands?: number;
  /** このラウンドで獲得したゴールド（レート増分×10、重複送信時は 0） */
  goldEarned?: number;
  /** 反映後の累計ゴールド */
  goldTotal?: number;
  /** シーズンレートでティアまたはランク帯が一段上がった（この送信で初めて記録したときのみ） */
  seasonTierPromoted?: boolean;
  /** 昇格後の表示ラベル（例: ウォリアー III） */
  promotedToRankLabel?: string;
  /** ショップの次回勝利2倍バフを消費してレート増分が2倍だった */
  ratingDoubledApplied?: boolean;
};

function Home() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const list = CHARACTERS as Character[];

  const roomCodeFromUrl = useMemo(
    () => normalizeRoomCode(searchParams.get("room")),
    [searchParams]
  );

  const [target, setTarget] = useState<Character>(() =>
    pickRandomTarget(list)
  );
  const [roundId, setRoundId] = useState(() =>
    typeof crypto !== "undefined" ? crypto.randomUUID() : String(Date.now())
  );
  const [guesses, setGuesses] = useState<Character[]>([]);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [playerName, setPlayerName] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [nameModalOpen, setNameModalOpen] = useState(false);
  const [nameFieldTouched, setNameFieldTouched] = useState(false);
  const [surrendered, setSurrendered] = useState(false);
  const [ratingStats, setRatingStats] = useState<RatingStats | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitRetryKey, setSubmitRetryKey] = useState(0);
  const submitDoneRoundRef = useRef<string | null>(null);
  /** null = 読み込み中 */
  const [totalGold, setTotalGold] = useState<number | null>(null);
  /** Firestore current_rate（シーズン・ランク表示の基準） */
  const [seasonRatingForRank, setSeasonRatingForRank] = useState<number | null>(
    null
  );
  const [userProfileLoading, setUserProfileLoading] = useState(true);
  const [goldHintOpen, setGoldHintOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const goldBarRef = useRef<HTMLDivElement | null>(null);
  const { showAdminTools } = useAdminMode();
  const [debugRevealAnswer, setDebugRevealAnswer] = useState(false);
  const [ghost, setGhost] = useState<GhostInfo | null>(null);
  const [ghostEcho, setGhostEcho] = useState<string | null>(null);
  const ghostToastShownRef = useRef(false);
  /** true = 対戦モード（ゴースト） / false = 個人モード */
  const [battleModeVs, setBattleModeVs] = useState(true);
  const [viewerUid, setViewerUid] = useState<string | null>(null);

  const [roomDoc, setRoomDoc] = useState<RoomDocument | null>(null);
  const [roomDocLoading, setRoomDocLoading] = useState(false);
  const [roomMissing, setRoomMissing] = useState(false);
  const [roomPwUnlocked, setRoomPwUnlocked] = useState(true);
  const [roomPwDraft, setRoomPwDraft] = useState("");
  const [roomPwError, setRoomPwError] = useState<string | null>(null);
  const [roomPwBusy, setRoomPwBusy] = useState(false);
  const [moveSecondsLeft, setMoveSecondsLeft] = useState<number | null>(null);
  const [roomPresencePlayers, setRoomPresencePlayers] = useState<
    RoomPresencePlayer[]
  >([]);
  const [roomJoinToast, setRoomJoinToast] = useState<string | null>(null);
  const presenceBaselineRef = useRef(false);
  const prevPresenceIdsRef = useRef<Set<string>>(new Set());
  const [roomStartBusy, setRoomStartBusy] = useState(false);
  const [roomDissolveBusy, setRoomDissolveBusy] = useState(false);
  const [roomLeaveBusy, setRoomLeaveBusy] = useState(false);
  const roomSyncedRoundRef = useRef<string | null>(null);
  const presenceDocRef = useRef<ReturnType<typeof doc> | null>(null);

  /** roomDoc はスナップショットのたびに新オブジェクトになる。依存配列に直参照すると無限ループの原因になる */
  const roomDocPresent = roomDoc != null;

  const roomPresenceCount = roomPresencePlayers.length;

  const roomInLobby = useMemo(
    () =>
      Boolean(roomCodeFromUrl) &&
      roomDoc != null &&
      roomDoc.matchStarted === false,
    [roomCodeFromUrl, roomDoc]
  );

  const maxGuessesThisRound = useMemo(() => {
    if (!roomDoc) return MAX_GUESSES;
    return roomDoc.maxHandsLimited ? 7 : ROOM_UNLIMITED_GUESS_CAP;
  }, [roomDoc]);

  const moveTimeoutSec = roomDoc?.moveTimeoutSec ?? 30;

  useEffect(() => {
    if (!roomCodeFromUrl) {
      setRoomDoc(null);
      setRoomMissing(false);
      setRoomDocLoading(false);
      setRoomPwUnlocked(true);
      return;
    }
    setRoomDocLoading(true);
    const db = getFirestore(getFirebaseAuth().app);
    const unsub = onSnapshot(
      doc(db, "rooms", roomCodeFromUrl),
      (snap) => {
        setRoomDocLoading(false);
        if (!snap.exists()) {
          setRoomMissing(true);
          setRoomDoc(null);
          return;
        }
        setRoomMissing(false);
        setRoomDoc(snap.data() as RoomDocument);
      },
      (err) => {
        console.warn("[room] snapshot error", err);
        setRoomDocLoading(false);
        setRoomMissing(true);
        setRoomDoc(null);
      }
    );
    return () => unsub();
  }, [roomCodeFromUrl]);

  useEffect(() => {
    if (!roomCodeFromUrl) {
      roomSyncedRoundRef.current = null;
    }
  }, [roomCodeFromUrl]);

  useEffect(() => {
    presenceBaselineRef.current = false;
    prevPresenceIdsRef.current = new Set();
    if (!roomCodeFromUrl || !roomDocPresent || roomMissing) {
      setRoomPresencePlayers([]);
      setRoomJoinToast(null);
      return;
    }
    const db = getFirestore(getFirebaseAuth().app);
    const col = collection(db, "rooms", roomCodeFromUrl, "presence");
    const unsub = onSnapshot(
      col,
      (snap) => {
        const players: RoomPresencePlayer[] = [];
        snap.forEach((d) => {
          const data = d.data();
          const displayName =
            typeof data.displayName === "string" && data.displayName.length > 0
              ? data.displayName
              : "???";
          const ja = data.joinedAt as { toMillis?: () => number } | undefined;
          const joinedMs =
            ja && typeof ja.toMillis === "function" ? ja.toMillis() : 0;
          players.push({ uid: d.id, displayName, joinedMs });
        });
        players.sort((a, b) => a.joinedMs - b.joinedMs);

        if (!presenceBaselineRef.current) {
          presenceBaselineRef.current = true;
          prevPresenceIdsRef.current = new Set(players.map((p) => p.uid));
          setRoomPresencePlayers(players);
          return;
        }

        const myUid = getFirebaseAuth().currentUser?.uid ?? null;
        const prev = prevPresenceIdsRef.current;
        const newcomers = players.filter(
          (p) => !prev.has(p.uid) && p.uid !== myUid
        );
        if (newcomers.length === 1) {
          setRoomJoinToast(
            `${newcomers[0]!.displayName}さんがやってきました`
          );
        } else if (newcomers.length > 1) {
          setRoomJoinToast(
            `${newcomers.map((n) => n.displayName).join("さん、")}さんがやってきました`
          );
        }
        prevPresenceIdsRef.current = new Set(players.map((p) => p.uid));
        setRoomPresencePlayers(players);
      },
      (err) => {
        console.warn("[presence] snapshot error", err);
        setRoomPresencePlayers([]);
      }
    );
    return () => unsub();
  }, [roomCodeFromUrl, roomDocPresent, roomMissing]);

  useEffect(() => {
    if (!roomCodeFromUrl || !roomDocPresent || !roomPwUnlocked || roomMissing) {
      const p = presenceDocRef.current;
      presenceDocRef.current = null;
      if (p) void deleteDoc(p).catch(() => {});
      return;
    }
    const nameCheck = validateDisplayName(playerName, {
      ignoreBadSubstrings: isAdminUid(viewerUid),
    });
    if (!nameCheck.ok) {
      const p = presenceDocRef.current;
      presenceDocRef.current = null;
      if (p) void deleteDoc(p).catch(() => {});
      return;
    }
    let cancelled = false;
    void (async () => {
      await ensureAnonymousSession();
      if (cancelled) return;
      const uid = getFirebaseAuth().currentUser?.uid;
      if (!uid) return;
      const db = getFirestore(getFirebaseAuth().app);
      const pref = doc(db, "rooms", roomCodeFromUrl, "presence", uid);
      presenceDocRef.current = pref;
      try {
        const existing = await getDoc(pref);
        const payload: Record<string, unknown> = {
          displayName: nameCheck.name,
        };
        if (!existing.exists()) {
          payload.joinedAt = serverTimestamp();
        }
        await setDoc(pref, payload, { merge: true });
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
      const p = presenceDocRef.current;
      presenceDocRef.current = null;
      if (p) void deleteDoc(p).catch(() => {});
    };
  }, [
    roomCodeFromUrl,
    roomDocPresent,
    roomPwUnlocked,
    roomMissing,
    playerName,
    viewerUid,
  ]);

  useEffect(() => {
    if (
      !roomCodeFromUrl ||
      !roomDoc?.matchStarted ||
      !roomDoc.targetCharacterName ||
      !roomDoc.activeRoundId
    ) {
      return;
    }
    if (roomSyncedRoundRef.current === roomDoc.activeRoundId) {
      return;
    }
    roomSyncedRoundRef.current = roomDoc.activeRoundId;
    const c = list.find((x) => x.name === roomDoc.targetCharacterName);
    if (!c) return;
    setTarget(c);
    setRoundId(roomDoc.activeRoundId);
    setGuesses([]);
    setSurrendered(false);
    setMessage(null);
    setQuery("");
    setRatingStats(null);
    setSubmitError(null);
    setSubmitLoading(false);
    submitDoneRoundRef.current = null;
    setGhost(null);
    setGhostEcho(null);
    ghostToastShownRef.current = false;
  }, [
    roomCodeFromUrl,
    roomDoc?.matchStarted,
    roomDoc?.targetCharacterName,
    roomDoc?.activeRoundId,
    list,
  ]);

  const handleRoomStartMatch = useCallback(async () => {
    if (!roomCodeFromUrl || !roomDoc || viewerUid !== roomDoc.hostUid) return;
    if (roomPresenceCount < 2) return;
    setRoomStartBusy(true);
    try {
      await ensureAnonymousSession();
      const char = pickRandomTarget(list);
      const rid =
        typeof crypto !== "undefined"
          ? crypto.randomUUID()
          : String(Date.now());
      const db = getFirestore(getFirebaseAuth().app);
      await updateDoc(doc(db, "rooms", roomCodeFromUrl), {
        matchStarted: true,
        targetCharacterName: char.name,
        activeRoundId: rid,
        lastActivityAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch {
      /* ignore */
    } finally {
      setRoomStartBusy(false);
    }
  }, [roomCodeFromUrl, roomDoc, viewerUid, roomPresenceCount, list]);

  const roomHostUid = roomDoc?.hostUid;

  useEffect(() => {
    if (
      !roomCodeFromUrl ||
      !roomDocPresent ||
      roomMissing ||
      !roomPwUnlocked
    ) {
      return;
    }
    /** 全員が lastActivityAt を書くと人数×回数だけ書き込みが増えるため、ホストのみ更新 */
    if (!viewerUid || !roomHostUid || viewerUid !== roomHostUid) {
      return;
    }
    const tick = () => {
      void (async () => {
        try {
          await ensureAnonymousSession();
          const db = getFirestore(getFirebaseAuth().app);
          await updateDoc(doc(db, "rooms", roomCodeFromUrl), {
            lastActivityAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } catch {
          /* ignore */
        }
      })();
    };
    tick();
    /**
     * 掃除の「最終操作から N 分」より短い間隔で更新し、放置判定と被って誤削除されないようにする。
     * （ROOM_LOBBY_NO_MATCH_MS 既定 7 分なら 2 分ハートビートで余裕あり）
     */
    const id = window.setInterval(tick, 120_000);
    return () => clearInterval(id);
  }, [
    roomCodeFromUrl,
    roomDocPresent,
    roomMissing,
    roomPwUnlocked,
    viewerUid,
    roomHostUid,
  ]);

  const handleRoomDissolve = useCallback(async () => {
    if (!roomCodeFromUrl || !roomDoc || viewerUid !== roomDoc.hostUid) return;
    if (
      !window.confirm(
        "ルームを解散します。全員がこのURLから外れます。よろしいですか？"
      )
    ) {
      return;
    }
    setRoomDissolveBusy(true);
    try {
      await ensureAnonymousSession();
      const db = getFirestore(getFirebaseAuth().app);
      await dissolveRoomClient(db, roomCodeFromUrl);
      router.push("/rooms");
    } catch {
      /* ignore */
    } finally {
      setRoomDissolveBusy(false);
    }
  }, [roomCodeFromUrl, roomDoc, viewerUid, router]);

  const handleRoomLeave = useCallback(async () => {
    if (!roomCodeFromUrl) return;
    if (!window.confirm("このルームから抜けますか？（ルーム一覧へ移動します）")) {
      return;
    }
    setRoomLeaveBusy(true);
    try {
      await ensureAnonymousSession();
      const uid = getFirebaseAuth().currentUser?.uid;
      const db = getFirestore(getFirebaseAuth().app);
      if (uid) {
        await deleteDoc(
          doc(db, "rooms", roomCodeFromUrl, "presence", uid)
        ).catch(() => {});
      }
      try {
        sessionStorage.removeItem(roomPasswordInputKey(roomCodeFromUrl));
      } catch {
        /* ignore */
      }
      router.push("/rooms");
    } finally {
      setRoomLeaveBusy(false);
    }
  }, [roomCodeFromUrl, router]);

  useEffect(() => {
    if (!roomCodeFromUrl) {
      setRoomPwUnlocked(true);
      return;
    }
    try {
      const ok =
        sessionStorage.getItem(roomPasswordInputKey(roomCodeFromUrl)) === "1";
      setRoomPwUnlocked(ok);
    } catch {
      setRoomPwUnlocked(false);
    }
  }, [roomCodeFromUrl]);

  useEffect(() => {
    if (!roomCodeFromUrl || !roomDoc) return;
    if (!roomDoc.passwordHash) setRoomPwUnlocked(true);
  }, [roomDoc, roomCodeFromUrl]);

  const moveDeadlineRef = useRef(0);
  const deadlineGuessLenRef = useRef(0);

  const guessesRef = useRef(guesses);
  guessesRef.current = guesses;
  const finishedRef = useRef(false);

  const syncUserProfile = useCallback(async () => {
    try {
      await ensureAnonymousSession();
      const auth = getFirebaseAuth();
      const uid = auth.currentUser?.uid;
      if (!uid) {
        setTotalGold(0);
        setSeasonRatingForRank(null);
        setUserProfileLoading(false);
        return;
      }
      const db = getFirestore(auth.app);
      const snap = await getDoc(doc(db, "users", uid));
      if (!snap.exists()) {
        setTotalGold(0);
        setSeasonRatingForRank(DEFAULT_INITIAL_RATING);
        setUserProfileLoading(false);
        return;
      }
      const d = snap.data();
      const g =
        typeof d?.gold === "number" && Number.isFinite(d.gold) ? d.gold : 0;
      const season =
        typeof d?.current_rate === "number" && Number.isFinite(d.current_rate)
          ? d.current_rate
          : typeof d?.rating === "number" && Number.isFinite(d.rating)
            ? d.rating
            : DEFAULT_INITIAL_RATING;
      setTotalGold(g);
      setSeasonRatingForRank(season);
    } catch {
      setTotalGold(0);
      setSeasonRatingForRank(DEFAULT_INITIAL_RATING);
    } finally {
      setUserProfileLoading(false);
    }
  }, []);

  const draftPreview = useMemo(
    () =>
      validateDisplayName(nameDraft, {
        ignoreBadSubstrings: isAdminUid(viewerUid),
      }),
    [nameDraft, viewerUid]
  );

  useEffect(() => {
    void ensureAnonymousSession().catch(() => {
      /* 送信時に再試行 */
    });
  }, []);

  useEffect(() => {
    const auth = getFirebaseAuth();
    setViewerUid(auth.currentUser?.uid ?? null);
    const unsub = onAuthStateChanged(auth, (u) => {
      setViewerUid(u?.uid ?? null);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    void syncUserProfile();
  }, [syncUserProfile]);

  useEffect(() => {
    if (ratingStats == null) return;
    void syncUserProfile();
  }, [ratingStats, syncUserProfile]);

  useEffect(() => {
    const onDebugUser = () => void syncUserProfile();
    window.addEventListener(DEBUG_USER_UPDATED_EVENT, onDebugUser);
    return () => window.removeEventListener(DEBUG_USER_UPDATED_EVENT, onDebugUser);
  }, [syncUserProfile]);

  useEffect(() => {
    try {
      const s = localStorage.getItem(PLAYER_NAME_STORAGE_KEY);
      if (s) setPlayerName(s);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      const v = localStorage.getItem(BATTLE_MODE_KEY);
      if (v === "solo") setBattleModeVs(false);
      else if (v === "vs") setBattleModeVs(true);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(BATTLE_MODE_KEY, battleModeVs ? "vs" : "solo");
    } catch {
      /* ignore */
    }
  }, [battleModeVs]);

  useEffect(() => {
    setGhost(null);
    ghostToastShownRef.current = false;
    if (!battleModeVs) {
      return;
    }
    // リアルタイムルームでは他プレイヤーと同じお題を共有するためゴーストは使わない
    if (roomCodeFromUrl) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/get-ghost?characterName=${encodeURIComponent(target.name)}`
        );
        const json = (await res.json()) as {
          ok?: boolean;
          ghost?: GhostInfo | null;
        };
        if (cancelled) return;
        if (json?.ok && json.ghost) {
          setGhost(json.ghost);
        } else {
          setGhost(null);
        }
      } catch {
        if (!cancelled) setGhost(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [target.name, roundId, battleModeVs, roomCodeFromUrl]);

  useEffect(() => {
    if (!ghost) return;
    if (guesses.length !== ghost.handCount) return;
    if (ghostToastShownRef.current) return;
    ghostToastShownRef.current = true;
    setGhostEcho(`${ghost.displayName}さんが正解しました！`);
  }, [ghost, guesses.length]);

  useEffect(() => {
    if (!ghostEcho) return;
    const t = window.setTimeout(() => setGhostEcho(null), 4500);
    return () => window.clearTimeout(t);
  }, [ghostEcho]);

  useEffect(() => {
    try {
      localStorage.setItem(PLAYER_NAME_STORAGE_KEY, playerName);
    } catch {
      /* ignore */
    }
  }, [playerName]);

  useEffect(() => {
    if (!roomJoinToast) return;
    const t = window.setTimeout(() => setRoomJoinToast(null), 4500);
    return () => clearTimeout(t);
  }, [roomJoinToast]);

  useEffect(() => {
    if (!nameModalOpen) return;
    setNameDraft(playerName);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNameModalOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nameModalOpen, playerName]);

  useEffect(() => {
    if (!goldHintOpen) return;
    const onDown = (e: MouseEvent) => {
      const el = goldBarRef.current;
      if (el && !el.contains(e.target as Node)) {
        setGoldHintOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [goldHintOpen]);

  const won = guesses.some((g) => g.name === target.name);
  const lostToGhost =
    battleModeVs &&
    ghost !== null &&
    !won &&
    guesses.length > ghost.handCount;
  const finished =
    surrendered ||
    won ||
    guesses.length >= maxGuessesThisRound ||
    lostToGhost;

  const roomPlayable =
    !roomCodeFromUrl ||
    (!roomDocLoading &&
      !roomMissing &&
      roomDoc != null &&
      roomPwUnlocked &&
      roomDoc.matchStarted !== false);

  useEffect(() => {
    finishedRef.current = finished;
  }, [finished]);

  useEffect(() => {
    if (
      !roomCodeFromUrl ||
      !roomDoc ||
      !roomPwUnlocked ||
      roomMissing ||
      finished ||
      roomInLobby
    ) {
      setMoveSecondsLeft(null);
      return;
    }
    moveDeadlineRef.current = Date.now() + moveTimeoutSec * 1000;
    deadlineGuessLenRef.current = guesses.length;
  }, [
    guesses.length,
    roundId,
    roomCodeFromUrl,
    roomDoc,
    roomPwUnlocked,
    roomMissing,
    finished,
    moveTimeoutSec,
    roomInLobby,
  ]);

  useEffect(() => {
    if (
      !roomCodeFromUrl ||
      !roomDoc ||
      !roomPwUnlocked ||
      roomMissing ||
      finished ||
      roomInLobby
    ) {
      return;
    }
    const tick = () => {
      const ms = moveDeadlineRef.current - Date.now();
      setMoveSecondsLeft(Math.max(0, Math.ceil(ms / 1000)));
      if (
        ms > 0 ||
        finishedRef.current ||
        guessesRef.current.length !== deadlineGuessLenRef.current
      ) {
        return;
      }
      const g = guessesRef.current;
      const wrong = list.find(
        (c) => c.name !== target.name && !g.some((x) => x.name === c.name)
      );
      if (!wrong) return;
      deadlineGuessLenRef.current = -1;
      setMessage("時間切れ（ミス1回・1手消費）");
      setGuesses((prev) => [wrong, ...prev]);
      setQuery("");
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => clearInterval(id);
  }, [
    roomCodeFromUrl,
    roomDoc,
    roomPwUnlocked,
    roomMissing,
    finished,
    list,
    target.name,
    guesses.length,
    roundId,
    moveTimeoutSec,
    roomInLobby,
  ]);

  const suggestions = useMemo(() => {
    const qRaw = query.trim();
    if (!qRaw) return [] as Character[];
    const q = normalizeForSearch(qRaw);
    return list.filter((c) => {
      const nameNorm = normalizeForSearch(c.name);
      const anyC = c as unknown as { nameHira?: string };
      const nameHiraNorm = normalizeForSearch(anyC.nameHira ?? "");
      return (
        (nameNorm.includes(q) || nameHiraNorm.includes(q)) &&
        !guesses.some((g) => g.name === c.name)
      );
    });
  }, [query, guesses, list]);

  const submitGuess = useCallback(
    (c: Character) => {
      if (finished) return;
      if (!roomPlayable) {
        setMessage("ルームの準備ができていません");
        return;
      }
      if (guesses.some((g) => g.name === c.name)) {
        setMessage("すでに試したキャラです");
        return;
      }
      setMessage(null);
      setGuesses((g) => [c, ...g]);
      setQuery("");
    },
    [finished, guesses, roomPlayable]
  );

  const canResign = guesses.length >= MIN_GUESSES_TO_RESIGN;

  const resign = useCallback(() => {
    if (finished) return;
    if (!canResign) {
      setMessage("4回予想してから諦められます");
      return;
    }
    setMessage("諦めました");
    setSurrendered(true);
    setQuery("");
  }, [finished, canResign]);

  useEffect(() => {
    if (!finished) {
      return;
    }
    if (submitDoneRoundRef.current === roundId) {
      return;
    }

    const guessCount = guesses.length;
    const handCount = won ? guessCount : 7;
    let cancelled = false;

    const run = async () => {
      await ensureAnonymousSession();

      const authForName = getFirebaseAuth();
      const nameCheck = validateDisplayName(playerName, {
        ignoreBadSubstrings: isAdminUid(
          authForName.currentUser?.uid ?? null
        ),
      });
      if (!nameCheck.ok) {
        if (!cancelled) {
          setSubmitError(nameCheck.error);
          setRatingStats(null);
          setSubmitLoading(false);
        }
        return;
      }

      if (!cancelled) {
        setSubmitError(null);
        setSubmitLoading(true);
      }

      try {
        const auth = getFirebaseAuth();
        const idToken = await auth.currentUser!.getIdToken();

        const res = await fetch("/api/submit-result", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idToken,
            characterName: target.name,
            roundId,
            handCount,
            guessCount,
            won,
            displayName: nameCheck.name,
            surrendered,
            ...(!battleModeVs ? { personalMode: true } : {}),
            ...(battleModeVs && ghost ? { ghostRunId: ghost.ghostRunId } : {}),
            ...(battleModeVs && lostToGhost ? { lostToGhost: true } : {}),
            ...(roomCodeFromUrl && roomDoc
              ? { maxGuessCap: maxGuessesThisRound }
              : {}),
          }),
        });

        const json = (await res.json()) as {
          ok?: boolean;
          error?: string;
          alreadySubmitted?: boolean;
          ratingDelta?: number;
          playerRatingBefore?: number;
          playerRatingAfter?: number;
          characterAverageHands?: number;
          goldEarned?: number;
          goldTotal?: number;
          seasonTierPromoted?: boolean;
          promotedToRankLabel?: string;
          ratingDoubledApplied?: boolean;
        };

        if (cancelled) return;

        if (!json?.ok) {
          throw new Error(json?.error ?? "submit failed");
        }

        submitDoneRoundRef.current = roundId;

        if (typeof json.goldTotal === "number" && Number.isFinite(json.goldTotal)) {
          setTotalGold(json.goldTotal);
        }

        const before = json.playerRatingBefore ?? 0;
        const after = json.playerRatingAfter ?? before;
        const delta =
          typeof json.ratingDelta === "number"
            ? json.ratingDelta
            : after - before;

        setRatingStats({
          before,
          after,
          delta,
          alreadySubmitted: Boolean(json.alreadySubmitted),
          characterAverageHands:
            typeof json.characterAverageHands === "number"
              ? json.characterAverageHands
              : undefined,
          goldEarned:
            typeof json.goldEarned === "number" ? json.goldEarned : undefined,
          goldTotal:
            typeof json.goldTotal === "number" ? json.goldTotal : undefined,
          seasonTierPromoted: Boolean(json.seasonTierPromoted),
          promotedToRankLabel:
            typeof json.promotedToRankLabel === "string"
              ? json.promotedToRankLabel
              : undefined,
          ratingDoubledApplied: Boolean(json.ratingDoubledApplied),
        });
      } catch (e: unknown) {
        if (!cancelled) {
          setSubmitError(e instanceof Error ? e.message : String(e));
          setRatingStats(null);
        }
      } finally {
        if (!cancelled) setSubmitLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [
    finished,
    won,
    guesses.length,
    surrendered,
    playerName,
    roundId,
    target.name,
    submitRetryKey,
    ghost,
    lostToGhost,
    battleModeVs,
    roomCodeFromUrl,
    roomDoc,
    maxGuessesThisRound,
  ]);

  const goNextRound = useCallback(() => {
    submitDoneRoundRef.current = null;
    setTarget(pickRandomTarget(list));
    setRoundId(
      typeof crypto !== "undefined" ? crypto.randomUUID() : String(Date.now())
    );
    setGuesses([]);
    setSurrendered(false);
    setMessage(null);
    setQuery("");
    setRatingStats(null);
    setSubmitError(null);
    setSubmitLoading(false);
    setDebugRevealAnswer(false);
    setGhostEcho(null);
    ghostToastShownRef.current = false;
  }, [list]);

  const saveNameFromModal = useCallback(() => {
    setNameFieldTouched(true);
    const v = validateDisplayName(nameDraft, {
      ignoreBadSubstrings: isAdminUid(viewerUid),
    });
    if (!v.ok) return;
    setPlayerName(v.name);
    setNameModalOpen(false);
  }, [nameDraft, viewerUid]);

  const nameHintModal =
    nameFieldTouched && !draftPreview.ok ? draftPreview.error : null;

  const showSuggest =
    query.trim().length > 0 && suggestions.length > 0 && !finished;

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-[#0a0f1e] text-white">
      {ghostEcho && (
        <div
          className="fixed left-1/2 top-[4.25rem] z-[95] max-w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-emerald-500/40 bg-emerald-950/90 px-4 py-2.5 text-center text-sm font-medium text-emerald-100 shadow-lg shadow-black/40"
          role="status"
        >
          {ghostEcho}
        </div>
      )}
      {roomJoinToast && (
        <div
          className="fixed left-1/2 top-[7.5rem] z-[95] max-w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-sky-500/45 bg-sky-950/90 px-4 py-2.5 text-center text-sm font-medium text-sky-100 shadow-lg shadow-black/40"
          role="status"
        >
          {roomJoinToast}
        </div>
      )}
      <header className="relative z-10 w-full shrink-0 border-b border-[#ece5d8]/10 bg-[#0a0f1e]/92 px-3 py-2 backdrop-blur-sm sm:px-6">
        <nav
          className="mx-auto flex w-full max-w-4xl flex-wrap items-center gap-x-2 gap-y-2 sm:gap-x-3"
          aria-label="メインナビゲーション"
        >
          <div ref={goldBarRef} className="relative flex shrink-0">
            <button
              type="button"
              onClick={() => setGoldHintOpen((o) => !o)}
              className="flex items-center gap-1.5 rounded-full border border-amber-400/35 bg-[#12182a]/95 px-2.5 py-1.5 text-xs font-medium tabular-nums text-amber-100/95 shadow-sm backdrop-blur-sm transition hover:border-amber-400/55 sm:px-3 sm:py-2 sm:text-sm"
              aria-expanded={goldHintOpen}
              aria-label="ゴールド（説明を表示）"
            >
              <GoldCoinIcon title="ゴールド" />
              {totalGold === null
                ? "…"
                : Math.round(totalGold).toLocaleString("ja-JP")}
            </button>
            {goldHintOpen && (
              <div
                className="absolute left-0 top-full z-20 mt-1 max-w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-amber-400/35 bg-[#12182a]/98 px-3 py-2.5 text-left text-xs leading-relaxed text-amber-100/95 shadow-xl shadow-black/40"
                role="tooltip"
              >
                ゴールドはショップでアイコンを囲むフレームやアイコンの購入などに使えます（準備中）。
              </div>
            )}
          </div>

          <Link
            href="/shop"
            prefetch={false}
            className="inline-flex shrink-0 items-center justify-center rounded-full border border-amber-500/35 bg-[#12182a]/95 px-2.5 py-1.5 text-xs font-medium text-amber-100/90 shadow-sm backdrop-blur-sm transition hover:border-amber-400/55 sm:px-3 sm:py-2 sm:text-sm"
          >
            ショップ
          </Link>

          <MyRankStatus
            seasonRating={seasonRatingForRank}
            loading={userProfileLoading}
          />

          <Link
            href="/ranking"
            prefetch={false}
            className="inline-flex shrink-0 items-center justify-center rounded-full border border-[#ece5d8]/25 bg-[#12182a]/95 px-2.5 py-1.5 text-xs font-medium text-[#ece5d8] shadow-sm backdrop-blur-sm transition hover:border-[#ece5d8]/45 sm:px-3 sm:py-2 sm:text-sm"
          >
            ランキング
          </Link>

          <button
            type="button"
            onClick={() => {
              setNameFieldTouched(false);
              setNameModalOpen(true);
            }}
            className="shrink-0 rounded-full border border-[#ece5d8]/25 bg-[#12182a]/95 px-2.5 py-1.5 text-xs font-medium text-[#ece5d8] shadow-sm backdrop-blur-sm transition hover:border-[#ece5d8]/45 sm:px-3 sm:py-2 sm:text-sm"
          >
            名前変更
          </button>
        </nav>
      </header>

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pb-16 pt-4 text-white sm:gap-7 sm:pt-5">
        {roomCodeFromUrl && (
          <div className="rounded-2xl border border-sky-500/30 bg-[#0d1324]/90 px-4 py-3 text-left text-sm shadow-lg shadow-black/30">
            {roomDocLoading && (
              <p className="text-sky-200/90">ルーム情報を読み込み中…</p>
            )}
            {roomMissing && !roomDocLoading && (
              <p className="text-rose-300/90">
                部屋番号「{roomCodeFromUrl}
                」のルームが見つかりません。
                <Link
                  href="/rooms"
                  prefetch={false}
                  className="ml-1 font-medium text-sky-300 underline-offset-2 hover:underline"
                >
                  ルーム一覧へ
                </Link>
              </p>
            )}
            {roomDoc && !roomMissing && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium text-[#ece5d8]">
                    ルーム: {roomDoc.name}
                  </p>
                  <p className="font-mono text-xs tabular-nums text-white/60">
                    {roomCodeFromUrl}
                  </p>
                </div>
                <p className="text-xs text-white/55">
                  手数:{" "}
                  {roomDoc.maxHandsLimited ? (
                    <span className="text-[#ece5d8]">7手まで</span>
                  ) : (
                    <span className="text-sky-200/95">無制限（♾️）</span>
                  )}
                  {" · "}
                  1手 {moveTimeoutSec} 秒（時間切れはミス扱い）
                </p>
                {roomInLobby && roomPwUnlocked && (
                  <div className="rounded-xl border border-amber-400/35 bg-amber-950/25 px-3 py-3">
                    <p className="text-sm font-medium text-amber-100/95">
                      ロビー（参加 {roomPresenceCount} 人）
                    </p>
                    {!validateDisplayName(playerName, {
                      ignoreBadSubstrings: isAdminUid(viewerUid),
                    }).ok ? (
                      <p className="mt-2 text-xs font-medium text-amber-200/95">
                        ルームに表示されるには、上部の「名前変更」から 2〜12
                        文字の表示名を設定してください。
                      </p>
                    ) : null}
                    <p className="mt-1 text-xs leading-relaxed text-white/55">
                      2人以上集まったらホストが開始します。表示名がプレイヤー一覧に並びます。
                    </p>
                    {roomPresencePlayers.length > 0 ? (
                      <ul className="mt-3 space-y-1.5 rounded-lg border border-amber-500/20 bg-[#0a0f1e]/60 px-2.5 py-2">
                        {roomPresencePlayers.map((p) => (
                          <li
                            key={p.uid}
                            className="flex items-center justify-between gap-2 text-sm text-[#ece5d8]/95"
                          >
                            <span className="min-w-0 truncate">
                              {p.displayName}
                              {viewerUid === p.uid ? (
                                <span className="ml-1.5 text-[0.65rem] text-white/45">
                                  （あなた）
                                </span>
                              ) : null}
                            </span>
                            {roomDoc.hostUid === p.uid ? (
                              <span className="shrink-0 rounded border border-amber-400/35 bg-amber-950/50 px-1.5 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide text-amber-100/90">
                                ホスト
                              </span>
                            ) : (
                              <span className="shrink-0 text-[0.65rem] text-white/40">
                                参加者
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {viewerUid === roomDoc.hostUid ? (
                      <button
                        type="button"
                        disabled={roomPresenceCount < 2 || roomStartBusy}
                        onClick={() => void handleRoomStartMatch()}
                        className="mt-3 w-full rounded-xl border border-amber-400/50 bg-amber-900/40 px-3 py-2.5 text-sm font-semibold text-amber-50 transition hover:border-amber-300/60 disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        {roomStartBusy ? "開始処理中…" : "ゲームを開始"}
                      </button>
                    ) : (
                      <p className="mt-2 text-xs text-sky-200/85">
                        ホストの開始を待っています…
                      </p>
                    )}
                  </div>
                )}
                {moveSecondsLeft != null &&
                  roomPwUnlocked &&
                  !finished &&
                  !roomDocLoading &&
                  !roomInLobby && (
                    <p
                      className="text-base font-semibold tabular-nums text-amber-200/95"
                      role="timer"
                      aria-live="polite"
                    >
                      この手の残り {moveSecondsLeft} 秒
                    </p>
                  )}
                {viewerUid &&
                  roomDoc.hostUid === viewerUid &&
                  !finished && (
                    <div className="flex flex-wrap gap-2 border-t border-[#ece5d8]/10 pt-2">
                      <span className="w-full text-[0.65rem] font-medium uppercase tracking-wide text-[#ece5d8]/55">
                        ホスト: ルール
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          void (async () => {
                            try {
                              await ensureAnonymousSession();
                              const db = getFirestore(getFirebaseAuth().app);
                              await updateDoc(
                                doc(db, "rooms", roomCodeFromUrl),
                                {
                                  maxHandsLimited: true,
                                  lastActivityAt: serverTimestamp(),
                                  updatedAt: serverTimestamp(),
                                }
                              );
                            } catch {
                              /* ignore */
                            }
                          })();
                        }}
                        className={`rounded-full px-3 py-1 text-xs font-medium ${
                          roomDoc.maxHandsLimited
                            ? "border border-emerald-500/50 bg-emerald-950/50 text-emerald-100"
                            : "border border-[#ece5d8]/20 text-white/65 hover:border-[#ece5d8]/40"
                        }`}
                      >
                        7手まで
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void (async () => {
                            try {
                              await ensureAnonymousSession();
                              const db = getFirestore(getFirebaseAuth().app);
                              await updateDoc(
                                doc(db, "rooms", roomCodeFromUrl),
                                {
                                  maxHandsLimited: false,
                                  lastActivityAt: serverTimestamp(),
                                  updatedAt: serverTimestamp(),
                                }
                              );
                            } catch {
                              /* ignore */
                            }
                          })();
                        }}
                        className={`rounded-full px-3 py-1 text-xs font-medium ${
                          !roomDoc.maxHandsLimited
                            ? "border border-sky-500/50 bg-sky-950/50 text-sky-100"
                            : "border border-[#ece5d8]/20 text-white/65 hover:border-[#ece5d8]/40"
                        }`}
                      >
                        無制限（♾️）
                      </button>
                    </div>
                  )}
                {!roomDocLoading && roomPwUnlocked && viewerUid ? (
                  <div className="mt-3 border-t border-[#ece5d8]/12 pt-3">
                    <p className="text-[0.65rem] font-medium uppercase tracking-wide text-[#ece5d8]/50">
                      ルーム操作
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={roomLeaveBusy || roomDissolveBusy}
                        onClick={() => void handleRoomLeave()}
                        className="rounded-lg border border-[#ece5d8]/30 bg-[#12182a]/80 px-3 py-2 text-xs font-medium text-[#ece5d8] transition hover:border-[#ece5d8]/50 disabled:opacity-50"
                      >
                        {roomLeaveBusy ? "抜けています…" : "ルームから抜ける"}
                      </button>
                      {roomDoc.hostUid === viewerUid ? (
                        <button
                          type="button"
                          disabled={roomDissolveBusy || roomLeaveBusy}
                          onClick={() => void handleRoomDissolve()}
                          className="rounded-lg border border-rose-500/45 bg-rose-950/35 px-3 py-2 text-xs font-medium text-rose-100 transition hover:border-rose-400/55 disabled:opacity-50"
                        >
                          {roomDissolveBusy ? "解散中…" : "ルームを解散"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        )}

        <header className="text-center">
          <p
            className={`text-xs font-medium uppercase tracking-[0.28em] text-[#ece5d8]/60`}
          >
            GenshinGuesser
          </p>
          <h1
            className={`mt-1.5 text-3xl font-semibold tracking-tight sm:text-4xl ${ACCENT}`}
          >
            GenshinGuesser
          </h1>

          <div className="mx-auto mt-3 max-w-lg text-left sm:mt-4">
            <p className="text-center text-sm font-semibold tracking-wide text-[#ece5d8]">
              【遊び方ガイド】
            </p>
            <ul className="mt-2 space-y-2 text-sm leading-relaxed text-white/72">
              <li className="flex gap-2">
                <span className="shrink-0 select-none text-[#ece5d8]/55" aria-hidden>
                  ・
                </span>
                <span>
                  全
                  {maxGuessesThisRound >= ROOM_UNLIMITED_GUESS_CAP
                    ? "∞"
                    : maxGuessesThisRound}
                  手以内に正解を導き出せ！
                  {roomCodeFromUrl && !roomDoc?.maxHandsLimited && (
                    <span className="text-white/50">（ルーム無制限モード）</span>
                  )}
                </span>
              </li>
              <li className="flex gap-2">
                <span className="shrink-0 select-none text-[#ece5d8]/55" aria-hidden>
                  ・
                </span>
                <span>
                  要素が一致すると
                  <span className="font-bold text-emerald-300">【黄緑色】</span>
                  に発光します。
                </span>
              </li>
              <li className="flex gap-2">
                <span className="shrink-0 select-none text-[#ece5d8]/55" aria-hidden>
                  ・
                </span>
                <span>
                  各行の「予想Ver」は
                  <span className="font-semibold text-[#ece5d8]">その予想キャラ</span>
                  の実装バージョンです。正解より古い／新しい場合は
                  <span className="font-bold text-sky-300">【↑ / ↓】</span>
                  が付きます。
                </span>
              </li>
              <li className="flex gap-2">
                <span className="shrink-0 select-none text-[#ece5d8]/55" aria-hidden>
                  ・
                </span>
                <span>
                  画面上部の
                  <span className="font-semibold text-[#ece5d8]">「名前変更」</span>
                  から名前を登録して、
                  <span className="font-bold text-amber-200/95">世界ランキング</span>
                  に挑もう！
                </span>
              </li>
            </ul>

            <div className="mt-4">
              <Link
                href="/rooms"
                prefetch={false}
                className="flex w-full items-center justify-center rounded-xl border border-sky-500/35 bg-[#0d1324]/85 px-3 py-2.5 text-center text-sm font-semibold text-sky-100/95 shadow-sm transition hover:border-sky-400/55 hover:bg-sky-950/25 sm:px-4 sm:py-3"
              >
                リアルタイム対戦
              </Link>
              <p className="mt-2 text-center text-[0.7rem] leading-relaxed text-white/45">
                野良や友達と盛り上がろう。
              </p>
            </div>

            <p className="mt-3 text-center text-[0.8125rem] font-medium leading-snug text-amber-300/95 sm:text-sm">
              {roomInLobby
                ? "ホストがゲームを開始するまでお待ちください。"
                : "※クイズは既に始まっています。最初の1手を入力してください！"}
            </p>
            {/* QUIZ_LINE_NOTICE: 臨時。消すときは SHOW_PLAY_GUIDE_MAINTENANCE_NOTICE 定数とこのブロックを削除 */}
            {!roomInLobby && SHOW_PLAY_GUIDE_MAINTENANCE_NOTICE ? (
              <p
                className="mt-2 whitespace-pre-line text-center text-[0.68rem] leading-relaxed text-red-400"
                role="status"
              >
                {PLAY_GUIDE_MAINTENANCE_NOTICE_TEXT}
              </p>
            ) : null}
          </div>
        </header>

        <section className="relative z-30 overflow-visible rounded-2xl border border-[#ece5d8]/20 bg-[#0d1324]/90 p-4 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.6)] backdrop-blur-sm sm:p-5">
          <div className="flex flex-col gap-3">
            <div className="relative">
              <label
                htmlFor="guess"
                className="mb-1 block text-xs font-medium text-[#ece5d8]/80"
              >
                キャラ名で検索
              </label>
              <div className="relative">
                <input
                  id="guess"
                  value={query}
                  disabled={finished || !roomPlayable}
                  onChange={(e) => setQuery(e.target.value)}
                  autoComplete="off"
                  placeholder="例: フリーナ"
                  className="w-full rounded-xl border border-[#ece5d8]/20 bg-[#12182a]/90 py-3 pl-4 pr-12 text-sm text-white outline-none ring-0 transition placeholder:text-white/35 focus:border-[#ece5d8]/45 focus:ring-2 focus:ring-[#ece5d8]/15 disabled:cursor-not-allowed disabled:opacity-50"
                />
                {query.length > 0 && !finished && (
                  <button
                    type="button"
                    aria-label="検索をクリア"
                    onClick={() => setQuery("")}
                    className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-lg leading-none text-[#ece5d8]/70 transition hover:bg-white/10 hover:text-white"
                  >
                    ×
                  </button>
                )}
                {showSuggest && (
                  <ul
                    className="absolute left-0 right-0 top-full z-[100] mt-1 max-h-56 overflow-auto rounded-xl border border-[#ece5d8]/20 bg-[#12182a] py-1 shadow-2xl shadow-black/50"
                    role="listbox"
                  >
                    {suggestions.map((c) => (
                      <li key={c.name} role="option">
                        <button
                          type="button"
                          onClick={() => submitGuess(c)}
                          className="flex w-full items-center px-4 py-2.5 text-left text-sm text-white transition hover:bg-white/10"
                        >
                          <span className="font-medium">{c.name}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
          {message && (
            <p className="mt-2 text-sm text-amber-300/95">{message}</p>
          )}

          {showAdminTools && (
            <div className="mt-2 rounded-lg border border-rose-500/35 bg-rose-950/30 px-3 py-2">
              <button
                type="button"
                onClick={() => setDebugRevealAnswer((v) => !v)}
                aria-pressed={debugRevealAnswer}
                className="text-left text-xs font-medium text-rose-100/95 underline decoration-rose-400/50 underline-offset-2 hover:text-rose-50"
              >
                {debugRevealAnswer ? "正解を隠す" : "正解を表示（デバッグ）"}
              </button>
              {debugRevealAnswer && (
                <p className="mt-1.5 font-mono text-sm font-semibold text-rose-50">
                  正解: {target.name}
                </p>
              )}
            </div>
          )}

          {!finished && (
            <div className="mt-3 flex w-full flex-col gap-2">
              {!canResign && (
                <p className="max-w-full text-right text-xs text-white/50 sm:text-left">
                  4回予想してから諦められます
                </p>
              )}
              <div className="flex w-full min-w-0 items-center justify-between gap-2 sm:gap-3">
                <button
                  type="button"
                  onClick={() => setChatOpen(true)}
                  className="shrink-0 rounded-xl border border-sky-400/35 bg-[#12182a]/80 px-3 py-2 text-sm font-medium text-sky-100/95 transition hover:border-sky-400/55 hover:bg-[#1a2238] sm:px-4"
                  aria-haspopup="dialog"
                >
                  チャット
                </button>
                {guesses.length === 0 && (
                  <div
                    className="flex min-w-0 flex-1 justify-center px-1"
                    role="group"
                    aria-label="対戦モードと個人モードの切り替え"
                  >
                    <div className="inline-flex rounded-xl border border-[#ece5d8]/25 bg-[#0a0f1e]/90 p-0.5">
                      <button
                        type="button"
                        onClick={() => setBattleModeVs(true)}
                        className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition sm:px-3 sm:text-sm ${
                          battleModeVs
                            ? "bg-[#ece5d8]/15 text-[#ece5d8]"
                            : "text-white/45 hover:text-white/70"
                        }`}
                      >
                        対戦
                      </button>
                      <button
                        type="button"
                        onClick={() => setBattleModeVs(false)}
                        className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition sm:px-3 sm:text-sm ${
                          !battleModeVs
                            ? "bg-[#ece5d8]/15 text-[#ece5d8]"
                            : "text-white/45 hover:text-white/70"
                        }`}
                      >
                        個人
                      </button>
                    </div>
                  </div>
                )}
                <button
                  type="button"
                  onClick={resign}
                  disabled={!canResign}
                  className="shrink-0 rounded-xl border border-[#ece5d8]/25 bg-[#12182a]/80 px-3 py-2 text-sm font-medium text-[#ece5d8] transition hover:bg-[#1a2238] disabled:cursor-not-allowed disabled:opacity-45 sm:px-4"
                >
                  諦める
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="relative z-0 space-y-4">
          {guesses.length === 0 && (
            <p className="text-center text-sm text-white/55">
              まだ予想がありません。上の欄からキャラを選んでください。
            </p>
          )}
          {guesses.map((g, idx) => (
            <div
              key={`${g.name}-${idx}`}
              className="rounded-2xl border border-[#ece5d8]/15 bg-[#0d1324]/80 p-3 shadow-lg shadow-black/30 sm:p-4"
            >
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 sm:gap-3">
                <Tile
                  label="キャラ名"
                  value={g.name}
                  ok={g.name === target.name}
                  className={matchClass(g.name === target.name)}
                />
                <Tile
                  label="元素"
                  value={g.element}
                  ok={g.element === target.element}
                  className={matchClass(g.element === target.element)}
                />
                <Tile
                  label="武器"
                  value={g.weapon}
                  ok={g.weapon === target.weapon}
                  className={matchClass(g.weapon === target.weapon)}
                />
                <Tile
                  label="地域"
                  value={g.region}
                  ok={g.region === target.region}
                  className={matchClass(g.region === target.region)}
                />
                <Tile
                  label="予想Ver"
                  value={(() => {
                    const gv = getVer(g);
                    const tv = getVer(target);
                    if (gv === null || tv === null) return "—";
                    if (gv === tv) return String(gv);
                    return `${gv} ${gv < tv ? "↑" : "↓"}`;
                  })()}
                  ok={(() => {
                    const gv = getVer(g);
                    const tv = getVer(target);
                    return gv !== null && tv !== null && gv === tv;
                  })()}
                  className={matchClass(
                    (() => {
                      const gv = getVer(g);
                      const tv = getVer(target);
                      return gv !== null && tv !== null && gv === tv;
                    })()
                  )}
                />
              </div>
            </div>
          ))}
        </section>
      </div>

      {chatOpen && (
        <ChatRoomPanel
          playerName={playerName}
          onClose={() => setChatOpen(false)}
        />
      )}

      {roomCodeFromUrl &&
        roomDoc &&
        Boolean(roomDoc.passwordHash) &&
        !roomPwUnlocked && (
          <div
            className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="room-pw-title"
          >
            <div className="w-full max-w-md rounded-2xl border border-sky-500/35 bg-[#12182a] p-6 shadow-2xl">
              <h2
                id="room-pw-title"
                className="text-lg font-semibold text-[#ece5d8]"
              >
                ルームのパスワード
              </h2>
              <p className="mt-2 text-sm text-white/55">
                「{roomDoc.name}」（{roomCodeFromUrl}）に入室するにはパスワードが必要です。
              </p>
              <input
                type="password"
                value={roomPwDraft}
                onChange={(e) => setRoomPwDraft(e.target.value)}
                autoComplete="current-password"
                className="mt-4 w-full rounded-xl border border-[#ece5d8]/20 bg-[#0a0f1e] px-4 py-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-sky-400/45"
                placeholder="パスワード"
              />
              {roomPwError && (
                <p className="mt-2 text-sm text-rose-400">{roomPwError}</p>
              )}
              <div className="mt-6 flex justify-end gap-2">
                <Link
                  href="/rooms"
                  prefetch={false}
                  className="rounded-xl px-4 py-2 text-sm text-white/70 transition hover:bg-white/10"
                >
                  戻る
                </Link>
                <button
                  type="button"
                  disabled={roomPwBusy}
                  onClick={() => {
                    void (async () => {
                      setRoomPwBusy(true);
                      setRoomPwError(null);
                      try {
                        const h = await sha256HexUtf8(
                          `${roomCodeFromUrl}|${roomPwDraft.trim()}`
                        );
                        if (h !== roomDoc.passwordHash) {
                          setRoomPwError("パスワードが違います");
                          return;
                        }
                        sessionStorage.setItem(
                          roomPasswordInputKey(roomCodeFromUrl),
                          "1"
                        );
                        setRoomPwUnlocked(true);
                      } catch (e: unknown) {
                        setRoomPwError(
                          e instanceof Error ? e.message : String(e)
                        );
                      } finally {
                        setRoomPwBusy(false);
                      }
                    })();
                  }}
                  className="rounded-xl border border-sky-500/45 bg-sky-950/50 px-4 py-2 text-sm font-medium text-sky-100 transition hover:border-sky-400/60 disabled:opacity-50"
                >
                  {roomPwBusy ? "確認中…" : "入室する"}
                </button>
              </div>
            </div>
          </div>
        )}

      {nameModalOpen && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="name-modal-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-[#ece5d8]/25 bg-[#12182a] p-6 shadow-2xl">
            <h2
              id="name-modal-title"
              className="text-lg font-semibold text-[#ece5d8]"
            >
              プレイヤー名の変更
            </h2>
            <p className="mt-1 text-sm text-white/55">
              2〜12文字。ランキングに表示されます。
            </p>
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => setNameFieldTouched(true)}
              maxLength={24}
              className="mt-4 w-full rounded-xl border border-[#ece5d8]/20 bg-[#0a0f1e] px-4 py-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-[#ece5d8]/45 focus:ring-2 focus:ring-[#ece5d8]/15"
              placeholder="例: 旅人"
            />
            {nameHintModal && (
              <p className="mt-2 text-xs text-rose-400">{nameHintModal}</p>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setNameModalOpen(false)}
                className="rounded-xl px-4 py-2 text-sm text-white/70 transition hover:bg-white/10"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={saveNameFromModal}
                className="rounded-xl border border-[#ece5d8]/35 bg-[#ece5d8]/10 px-4 py-2 text-sm font-medium text-[#ece5d8] transition hover:bg-[#ece5d8]/20"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {finished && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="result-title"
        >
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-[#ece5d8]/25 bg-[#12182a] p-6 shadow-2xl shadow-black/50">
            <h2
              id="result-title"
              className="text-center text-lg font-semibold text-[#ece5d8]"
            >
              {won ? "正解" : lostToGhost ? "ゴーストに敗北" : "不正解"}
            </h2>
            <p className="mt-1 text-center text-sm text-white/50">答え</p>
            <p className="mt-2 text-center text-3xl font-bold tracking-tight text-white">
              {target.name}
            </p>

            {won &&
              ratingStats?.ratingDoubledApplied &&
              !ratingStats.alreadySubmitted &&
              battleModeVs && (
                <p className="mt-3 text-center text-sm font-medium text-amber-200/95">
                  ショップバフ：レート増分が 2 倍で適用されました
                </p>
              )}

            {ratingStats?.seasonTierPromoted &&
              !ratingStats.alreadySubmitted &&
              ratingStats.promotedToRankLabel && (
                <div
                  className="mt-5 rounded-xl border border-amber-400/45 bg-gradient-to-br from-amber-950/55 via-[#12182a] to-emerald-950/40 px-4 py-4 text-center shadow-[0_0_28px_-8px_rgba(251,191,36,0.35)]"
                  role="status"
                >
                  <p className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-amber-200/95">
                    ティア昇格
                  </p>
                  <p className="mt-2 text-xl font-bold tracking-tight text-[#ece5d8] sm:text-2xl">
                    {ratingStats.promotedToRankLabel}
                  </p>
                  <p className="mt-1.5 text-xs text-white/50">
                    シーズンレートの到達で新しいティア／ランク帯に到達しました
                  </p>
                </div>
              )}

            {ratingStats != null &&
              typeof ratingStats.characterAverageHands === "number" && (
                <p className="mt-3 text-center text-sm leading-relaxed text-sky-200/90">
                  このキャラの平均手数（全プレイヤー・勝敗含む・単純平均）:{" "}
                  <span className="font-semibold tabular-nums text-white">
                    {ratingStats.characterAverageHands.toFixed(2)}
                  </span>{" "}
                  手
                </p>
              )}

            {won && (
              <p className="mt-6 text-center text-sm text-white/65">
                {guesses.length} 回でクリアしました。
              </p>
            )}

            <div className="mt-6 space-y-4">
              {submitLoading && (
                <p className="text-center text-base font-medium text-[#ece5d8]">
                  レートを送信中…
                </p>
              )}

              {!submitLoading && submitError && (
                <div className="space-y-2">
                  <p className="text-center text-sm text-rose-400">
                    {submitError}
                  </p>
                  <div className="flex justify-center">
                    <button
                      type="button"
                      onClick={() => setSubmitRetryKey((k) => k + 1)}
                      className="text-sm font-medium text-[#ece5d8] underline decoration-[#ece5d8]/50 hover:text-white"
                    >
                      再送信
                    </button>
                  </div>
                </div>
              )}

              {!submitLoading && ratingStats && (
                <div
                  className={`rounded-xl border px-4 py-4 text-center ${
                    ratingStats.delta >= 0
                      ? "border-emerald-500/30 bg-emerald-950/40"
                      : "border-rose-500/30 bg-rose-950/35"
                  }`}
                >
                  <p
                    className={`text-xs font-medium uppercase tracking-wider ${
                      ratingStats.delta >= 0
                        ? "text-emerald-300/90"
                        : "text-rose-300/90"
                    }`}
                  >
                    レート変動
                  </p>
                  {ratingStats.alreadySubmitted ? (
                    <p
                      className={`mt-2 text-sm ${
                        ratingStats.delta >= 0
                          ? "text-emerald-200/90"
                          : "text-rose-200/90"
                      }`}
                    >
                      このラウンドはすでに記録済みです
                    </p>
                  ) : (
                    <>
                      <p
                        className={`mt-2 text-2xl font-bold tabular-nums tracking-tight sm:text-3xl ${
                          ratingStats.delta >= 0
                            ? "text-emerald-100"
                            : "text-rose-100"
                        }`}
                      >
                        レート：{Math.round(ratingStats.before)} →{" "}
                        {Math.round(ratingStats.after)}
                        <span className="ml-2 text-xl sm:text-2xl">
                          (
                          {ratingStats.delta >= 0 ? "+" : ""}
                          {Math.round(ratingStats.delta)})
                        </span>
                      </p>
                      {typeof ratingStats.goldEarned === "number" &&
                        ratingStats.goldEarned > 0 && (
                          <p className="mt-3 flex items-center justify-center gap-1.5 text-sm text-amber-200/90">
                            <span>+</span>
                            <GoldCoinIcon className="h-[1.15em] w-[1.15em] shrink-0 align-[-0.12em] text-amber-200/95" />
                            <span className="tabular-nums">
                              {ratingStats.goldEarned.toLocaleString("ja-JP")}
                              （累計{" "}
                              {typeof ratingStats.goldTotal === "number"
                                ? Math.round(
                                    ratingStats.goldTotal
                                  ).toLocaleString("ja-JP")
                                : "—"}
                              ）
                            </span>
                          </p>
                        )}
                    </>
                  )}
                </div>
              )}
            </div>

            {!won && surrendered && (
              <p className="mt-4 text-center text-sm text-white/60">
                諦めたので答えを公開します。
              </p>
            )}

            {!won && lostToGhost && (
              <p className="mt-4 text-center text-sm leading-relaxed text-rose-300/90">
                ゴーストの正解手数を超えたため敗北です。
              </p>
            )}

            {!won && !surrendered && !lostToGhost && (
              <p className="mt-4 text-center text-sm text-white/60">
                手数切れです。
              </p>
            )}

            <div className="mt-8 flex justify-center">
              <button
                type="button"
                onClick={goNextRound}
                className="rounded-full border border-[#ece5d8]/35 bg-gradient-to-r from-amber-900/40 to-amber-800/30 px-8 py-3 text-sm font-semibold text-[#ece5d8] shadow-lg shadow-black/30 transition hover:border-[#ece5d8]/55"
              >
                次の問題へ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#0a0f1e] text-[#ece5d8]">
          読み込み中…
        </div>
      }
    >
      <Home />
    </Suspense>
  );
}

function Tile(props: {
  label: string;
  value: string;
  ok: boolean;
  className: string;
}) {
  return (
    <div
      className={`flex min-h-[4.25rem] flex-col justify-center rounded-xl border px-2 py-2 text-center sm:min-h-[5rem] ${props.className}`}
    >
      <span className="text-[0.65rem] font-medium uppercase tracking-wider text-current/70">
        {props.label}
      </span>
      <span className="mt-1 text-sm font-semibold leading-tight sm:text-base">
        {props.value}
      </span>
    </div>
  );
}
