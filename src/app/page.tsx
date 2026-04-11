"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CHARACTERS from "../data/characters.json";
import { doc, getDoc, getFirestore } from "firebase/firestore";
import { GoldCoinIcon } from "../components/GoldCoinIcon";
import { MyRankStatus } from "../components/MyRankStatus";
import { DEFAULT_INITIAL_RATING } from "../lib/elo";
import {
  ensureAnonymousSession,
  getFirebaseAuth,
} from "../lib/firebaseClient";
import { DEBUG_USER_UPDATED_EVENT } from "../lib/debugUserEvents";
import { validateDisplayName } from "../lib/validateDisplayName";

type Character = (typeof CHARACTERS)[number];

const MAX_GUESSES = 7;
/** これ未満では降参不可（API の MIN と一致） */
const MIN_GUESSES_TO_RESIGN = 4;
const PLAYER_NAME_KEY = "genshin-guesser-player-name";
const ACCENT = "text-[#ece5d8]";

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

type RatingStats = {
  before: number;
  after: number;
  delta: number;
  alreadySubmitted: boolean;
  weeklyResetApplied?: boolean;
  /** 正解キャラの全プレイヤー記録に基づくベイズ平均手数（勝敗・サーバー算出） */
  characterAverageHands?: number;
  /** このラウンドで獲得したゴールド（レート増分×10、重複送信時は 0） */
  goldEarned?: number;
  /** 反映後の累計ゴールド */
  goldTotal?: number;
};

export default function Home() {
  const list = CHARACTERS as Character[];

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
  const [weeklyRating, setWeeklyRating] = useState<number | null>(null);
  const [peakRating, setPeakRating] = useState<number | null>(null);
  const [userProfileLoading, setUserProfileLoading] = useState(true);
  const [goldHintOpen, setGoldHintOpen] = useState(false);
  const goldBarRef = useRef<HTMLDivElement | null>(null);

  const syncUserProfile = useCallback(async () => {
    try {
      await ensureAnonymousSession();
      const auth = getFirebaseAuth();
      const uid = auth.currentUser?.uid;
      if (!uid) {
        setTotalGold(0);
        setWeeklyRating(null);
        setPeakRating(null);
        setUserProfileLoading(false);
        return;
      }
      const db = getFirestore(auth.app);
      const snap = await getDoc(doc(db, "users", uid));
      if (!snap.exists()) {
        setTotalGold(0);
        setWeeklyRating(DEFAULT_INITIAL_RATING);
        setPeakRating(null);
        setUserProfileLoading(false);
        return;
      }
      const d = snap.data();
      const g =
        typeof d?.gold === "number" && Number.isFinite(d.gold) ? d.gold : 0;
      const r =
        typeof d?.rating === "number" && Number.isFinite(d.rating)
          ? d.rating
          : DEFAULT_INITIAL_RATING;
      const p =
        typeof d?.peakRating === "number" && Number.isFinite(d.peakRating)
          ? d.peakRating
          : null;
      setTotalGold(g);
      setWeeklyRating(r);
      setPeakRating(p);
    } catch {
      setTotalGold(0);
      setWeeklyRating(DEFAULT_INITIAL_RATING);
      setPeakRating(null);
    } finally {
      setUserProfileLoading(false);
    }
  }, []);

  const draftPreview = useMemo(
    () => validateDisplayName(nameDraft),
    [nameDraft]
  );

  useEffect(() => {
    void ensureAnonymousSession().catch(() => {
      /* 送信時に再試行 */
    });
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
      const s = localStorage.getItem(PLAYER_NAME_KEY);
      if (s) setPlayerName(s);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(PLAYER_NAME_KEY, playerName);
    } catch {
      /* ignore */
    }
  }, [playerName]);

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
  const finished =
    surrendered || won || guesses.length >= MAX_GUESSES;

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
      if (guesses.some((g) => g.name === c.name)) {
        setMessage("すでに試したキャラです");
        return;
      }
      setMessage(null);
      setGuesses((g) => [c, ...g]);
      setQuery("");
    },
    [finished, guesses]
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

      const nameCheck = validateDisplayName(playerName);
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
          }),
        });

        const json = (await res.json()) as {
          ok?: boolean;
          error?: string;
          alreadySubmitted?: boolean;
          ratingDelta?: number;
          playerRatingBefore?: number;
          playerRatingAfter?: number;
          weeklyResetApplied?: boolean;
          characterAverageHands?: number;
          goldEarned?: number;
          goldTotal?: number;
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
          weeklyResetApplied: Boolean(json.weeklyResetApplied),
          characterAverageHands:
            typeof json.characterAverageHands === "number"
              ? json.characterAverageHands
              : undefined,
          goldEarned:
            typeof json.goldEarned === "number" ? json.goldEarned : undefined,
          goldTotal:
            typeof json.goldTotal === "number" ? json.goldTotal : undefined,
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
  }, [list]);

  const saveNameFromModal = useCallback(() => {
    setNameFieldTouched(true);
    const v = validateDisplayName(nameDraft);
    if (!v.ok) return;
    setPlayerName(v.name);
    setNameModalOpen(false);
  }, [nameDraft]);

  const nameHintModal =
    nameFieldTouched && !draftPreview.ok ? draftPreview.error : null;

  const showSuggest =
    query.trim().length > 0 && suggestions.length > 0 && !finished;

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-[#0a0f1e] text-white">
      <header className="relative z-10 w-full shrink-0 border-b border-[#ece5d8]/10 bg-[#0a0f1e]/92 px-3 py-2 backdrop-blur-sm sm:px-6">
        <nav
          className="mx-auto flex w-full max-w-4xl flex-wrap items-center gap-x-2 gap-y-2 sm:gap-x-3"
          aria-label="メインナビゲーション"
        >
          <div
            ref={goldBarRef}
            className="relative flex shrink-0 flex-col items-start gap-1.5"
          >
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
            className="inline-flex shrink-0 items-center justify-center rounded-full border border-amber-500/35 bg-[#12182a]/95 px-2.5 py-1.5 text-xs font-medium text-amber-100/90 shadow-sm backdrop-blur-sm transition hover:border-amber-400/55 sm:px-3 sm:py-2 sm:text-sm"
          >
            ショップ
          </Link>

          <MyRankStatus
            weeklyRating={weeklyRating}
            peakRating={peakRating}
            loading={userProfileLoading}
          />

          <Link
            href="/ranking"
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
                  全{MAX_GUESSES}手以内に正解を導き出せ！
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
            <p className="mt-3 text-center text-[0.8125rem] font-medium leading-snug text-amber-300/95 sm:text-sm">
              ※クイズは既に始まっています。最初の1手を入力してください！
            </p>
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
                  disabled={finished}
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

          {!finished && (
            <div className="mt-3 flex flex-col items-end gap-2 sm:flex-row sm:items-center sm:justify-end">
              {!canResign && (
                <p className="order-2 max-w-full text-right text-xs text-white/50 sm:order-1 sm:mr-auto sm:text-left">
                  4回予想してから諦められます
                </p>
              )}
              <button
                type="button"
                onClick={resign}
                disabled={!canResign}
                className="order-1 rounded-xl border border-[#ece5d8]/25 bg-[#12182a]/80 px-4 py-2 text-sm font-medium text-[#ece5d8] transition hover:bg-[#1a2238] disabled:cursor-not-allowed disabled:opacity-45 sm:order-2"
              >
                諦める
              </button>
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
              {won ? "正解" : "不正解"}
            </h2>
            <p className="mt-1 text-center text-sm text-white/50">答え</p>
            <p className="mt-2 text-center text-3xl font-bold tracking-tight text-white">
              {target.name}
            </p>
            {ratingStats != null &&
              typeof ratingStats.characterAverageHands === "number" && (
                <p className="mt-3 text-center text-sm leading-relaxed text-sky-200/90">
                  このキャラの平均手数（全プレイヤー・勝敗含む・ベイズ推定）:{" "}
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
                  {ratingStats.weeklyResetApplied && (
                    <p className="mt-2 text-xs text-amber-200/85">
                      週が切り替わったため、レートを1500から再計算しました。
                    </p>
                  )}
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

            {!won && !surrendered && (
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
