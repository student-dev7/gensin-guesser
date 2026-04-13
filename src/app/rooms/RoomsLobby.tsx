"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import {
  generateRoomCode,
  MAX_PUBLIC_ROOMS,
  normalizeRoomCode,
  ROOM_MAX_PLAYERS_DEFAULT,
  ROOM_MOVE_TIMEOUT_SEC_DEFAULT,
  type RoomDocument,
} from "@/lib/roomTypes";
import { roomPasswordInputKey, sha256HexUtf8 } from "@/lib/roomHash";
import { dissolveRoomClient } from "@/lib/roomDissolve";
import { isAdminUid } from "@/lib/adminUids";
import {
  ensureAnonymousSession,
  getFirebaseAuth,
} from "@/lib/firebaseClient";
import { onAuthStateChanged } from "firebase/auth";
import { validateDisplayName } from "@/lib/validateDisplayName";
import {
  readStoredPlayerName,
  writeStoredPlayerName,
} from "@/lib/playerNameStorage";

function firestoreDb() {
  return getFirestore(getFirebaseAuth().app);
}

const IS_NEXT_DEV = process.env.NODE_ENV === "development";

/** onSnapshot はルーム doc のたびの更新（ハートビート等）で読み取りが爆発するため使わない */
const PUBLIC_ROOMS_POLL_MS = 10 * 60 * 1000;

export function RoomsLobby() {
  const router = useRouter();
  const [createName, setCreateName] = useState("");
  const [createPlayerName, setCreatePlayerName] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createPublic, setCreatePublic] = useState(true);
  const [maxHandsLimited, setMaxHandsLimited] = useState(true);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [joinCode, setJoinCode] = useState("");
  const [joinPlayerName, setJoinPlayerName] = useState("");
  const [joinPassword, setJoinPassword] = useState("");
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const [publicRooms, setPublicRooms] = useState<RoomDocument[]>([]);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [joinModalOpen, setJoinModalOpen] = useState(false);
  const [viewerUid, setViewerUid] = useState<string | null>(null);
  const [adminDeleteCode, setAdminDeleteCode] = useState<string | null>(null);
  const [devForceDeleteCode, setDevForceDeleteCode] = useState("");
  const [devForceDeleteBusy, setDevForceDeleteBusy] = useState(false);
  const [devForceDeleteMsg, setDevForceDeleteMsg] = useState<string | null>(
    null
  );
  const [publicRoomsLoading, setPublicRoomsLoading] = useState(false);

  useEffect(() => {
    void ensureAnonymousSession().catch(() => {});
  }, []);

  useEffect(() => {
    const s = readStoredPlayerName();
    if (s) {
      setCreatePlayerName(s);
      setJoinPlayerName(s);
    }
  }, []);

  useEffect(() => {
    const auth = getFirebaseAuth();
    setViewerUid(auth.currentUser?.uid ?? null);
    const unsub = onAuthStateChanged(auth, (u) =>
      setViewerUid(u?.uid ?? null)
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!createModalOpen && !joinModalOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [createModalOpen, joinModalOpen]);

  useEffect(() => {
    if (!createModalOpen && !joinModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setCreateModalOpen(false);
        setJoinModalOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [createModalOpen, joinModalOpen]);

  const loadPublicRooms = useCallback(async () => {
    const db = firestoreDb();
    const q = query(
      collection(db, "rooms"),
      where("isPublic", "==", true),
      limit(MAX_PUBLIC_ROOMS)
    );
    setPublicRoomsLoading(true);
    try {
      const snap = await getDocs(q);
      const rows: RoomDocument[] = [];
      snap.forEach((d) => rows.push(d.data() as RoomDocument));
      rows.sort((a, b) => {
        const ta = (a.createdAt as { seconds?: number })?.seconds ?? 0;
        const tb = (b.createdAt as { seconds?: number })?.seconds ?? 0;
        return tb - ta;
      });
      setPublicRooms(rows);
    } catch (e) {
      console.warn("[public rooms] getDocs error", e);
      setPublicRooms([]);
    } finally {
      setPublicRoomsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPublicRooms();
    const id = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      void loadPublicRooms();
    }, PUBLIC_ROOMS_POLL_MS);
    return () => window.clearInterval(id);
  }, [loadPublicRooms]);

  const normalizedJoin = useMemo(
    () => normalizeRoomCode(joinCode),
    [joinCode]
  );

  const tryCreate = useCallback(async () => {
    setCreateError(null);
    const name = createName.trim();
    if (name.length < 1 || name.length > 40) {
      setCreateError("ルーム名は 1〜40 文字で入力してください");
      return;
    }
    const playerV = validateDisplayName(createPlayerName);
    if (!playerV.ok) {
      setCreateError(playerV.error);
      return;
    }
    setCreateBusy(true);
    try {
      await ensureAnonymousSession();
      const auth = getFirebaseAuth();
      const uid = auth.currentUser?.uid;
      if (!uid) {
        setCreateError("ログインに失敗しました");
        return;
      }
      // 匿名セッションをルール評価まで確実に反映させる
      await auth.currentUser.getIdToken();
      const db = firestoreDb();
      if (createPublic) {
        const slotQ = query(
          collection(db, "rooms"),
          where("isPublic", "==", true),
          limit(MAX_PUBLIC_ROOMS + 1)
        );
        const slotSnap = await getDocs(slotQ);
        if (slotSnap.size >= MAX_PUBLIC_ROOMS) {
          setCreateError(
            `公開ルームは同時に最大${MAX_PUBLIC_ROOMS}件までです。しばらく待つか、非公開で作成してください。`
          );
          return;
        }
      }
      let code = "";
      for (let attempt = 0; attempt < 12; attempt++) {
        code = generateRoomCode();
        const ref = doc(db, "rooms", code);
        const exists = await getDoc(ref);
        if (!exists.exists()) {
          const pw = createPassword.trim();
          const passwordHash =
            pw.length > 0 ? await sha256HexUtf8(`${code}|${pw}`) : "";
          // 同一の serverTimestamp を使う（複数 sentinel を別々に request.time と照合するとルールが拒否することがある）
          const ts = serverTimestamp();
          const payload: Record<string, unknown> = {
            code,
            name,
            hostUid: uid,
            isPublic: createPublic,
            maxHandsLimited,
            moveTimeoutSec: ROOM_MOVE_TIMEOUT_SEC_DEFAULT,
            maxPlayers: ROOM_MAX_PLAYERS_DEFAULT,
            passwordHash,
            matchStarted: false,
            lastActivityAt: ts,
            createdAt: ts,
            updatedAt: ts,
          };
          await setDoc(ref, payload);
          writeStoredPlayerName(playerV.name);
          router.push(`/?room=${encodeURIComponent(code)}`);
          return;
        }
      }
      setCreateError("部屋番号の生成に失敗しました。もう一度お試しください。");
    } catch (e: unknown) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreateBusy(false);
    }
  }, [
    createName,
    createPlayerName,
    createPassword,
    createPublic,
    maxHandsLimited,
    router,
  ]);

  const tryJoin = useCallback(async () => {
    setJoinError(null);
    const code = normalizedJoin;
    if (!code) {
      setJoinError("5桁の部屋番号を入力してください（例: XJ79L）");
      return;
    }
    const playerV = validateDisplayName(joinPlayerName);
    if (!playerV.ok) {
      setJoinError(playerV.error);
      return;
    }
    writeStoredPlayerName(playerV.name);
    setJoinBusy(true);
    try {
      await ensureAnonymousSession();
      const db = firestoreDb();
      const ref = doc(db, "rooms", code);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        setJoinError("その番号のルームは見つかりません");
        return;
      }
      const data = snap.data() as RoomDocument;
      if (data.passwordHash) {
        const pw = joinPassword.trim();
        const h = await sha256HexUtf8(`${code}|${pw}`);
        if (h !== data.passwordHash) {
          setJoinError("パスワードが違います");
          return;
        }
      }
      try {
        sessionStorage.setItem(roomPasswordInputKey(code), "1");
      } catch {
        /* ignore */
      }
      router.push(`/?room=${encodeURIComponent(code)}`);
    } catch (e: unknown) {
      setJoinError(e instanceof Error ? e.message : String(e));
    } finally {
      setJoinBusy(false);
    }
  }, [normalizedJoin, joinPlayerName, joinPassword, router]);

  const deletePublicRoomAsAdmin = useCallback(
    async (code: string) => {
      if (!isAdminUid(viewerUid)) return;
      if (
        !window.confirm(
          `公開ルーム「${code}」を削除しますか？（presence も削除されます）`
        )
      ) {
        return;
      }
      setAdminDeleteCode(code);
      try {
        await ensureAnonymousSession();
        await dissolveRoomClient(firestoreDb(), code);
      } catch (e: unknown) {
        window.alert(e instanceof Error ? e.message : String(e));
      } finally {
        setAdminDeleteCode(null);
      }
    },
    [viewerUid]
  );

  const dissolveRoomAsHost = useCallback(
    async (code: string) => {
      if (
        !window.confirm(
          `ルーム「${code}」を解散しますか？（全員がこの部屋から外れます）`
        )
      ) {
        return;
      }
      setAdminDeleteCode(code);
      try {
        await ensureAnonymousSession();
        await dissolveRoomClient(firestoreDb(), code);
      } catch (e: unknown) {
        window.alert(e instanceof Error ? e.message : String(e));
      } finally {
        setAdminDeleteCode(null);
      }
    },
    []
  );

  const enterFromList = useCallback(
    async (code: string, needsPassword: boolean) => {
      setJoinError(null);
      const playerV = validateDisplayName(readStoredPlayerName());
      if (!playerV.ok) {
        setCreateModalOpen(false);
        setJoinCode(code);
        setJoinPlayerName(readStoredPlayerName());
        setJoinError(
          needsPassword
            ? "パスワードと、あなたの表示名（2〜12文字）を入力してください"
            : "入室するには「あなたの表示名」（2〜12文字）を入力してください"
        );
        setJoinModalOpen(true);
        return;
      }
      if (needsPassword) {
        setCreateModalOpen(false);
        setJoinCode(code);
        setJoinError("パスワードを入力して入室してください");
        setJoinModalOpen(true);
        return;
      }
      try {
        sessionStorage.setItem(roomPasswordInputKey(code), "1");
      } catch {
        /* ignore */
      }
      router.push(`/?room=${encodeURIComponent(code)}`);
    },
    [router]
  );

  const forceDeleteRoomDev = useCallback(async () => {
    const code = normalizeRoomCode(devForceDeleteCode);
    if (!code) {
      setDevForceDeleteMsg("5桁の部屋番号を入力してください");
      return;
    }
    setDevForceDeleteBusy(true);
    setDevForceDeleteMsg(null);
    try {
      const res = await fetch("/api/dev/force-delete-room", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId: code }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) {
        throw new Error(j.error || res.statusText);
      }
      setDevForceDeleteMsg(`削除しました（${code}）`);
      setDevForceDeleteCode("");
    } catch (e: unknown) {
      setDevForceDeleteMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setDevForceDeleteBusy(false);
    }
  }, [devForceDeleteCode]);

  const createForm = (
    <div className="space-y-3">
      <label className="block text-xs font-medium text-[#ece5d8]/75">
        ルーム名
        <input
          value={createName}
          onChange={(e) => setCreateName(e.target.value)}
          maxLength={40}
          placeholder="自由に決められます"
          className="mt-1 w-full rounded-xl border border-[#ece5d8]/20 bg-[#0a0f1e] px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/35 focus:border-emerald-400/40"
        />
      </label>
      <label className="block text-xs font-medium text-[#ece5d8]/75">
        あなたの表示名（2〜12 文字・ルーム内で共有）
        <input
          value={createPlayerName}
          onChange={(e) => setCreatePlayerName(e.target.value)}
          maxLength={12}
          autoComplete="nickname"
          placeholder="例: 旅人"
          className="mt-1 w-full rounded-xl border border-[#ece5d8]/20 bg-[#0a0f1e] px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/35 focus:border-emerald-400/40"
        />
      </label>
      <label className="block text-xs font-medium text-[#ece5d8]/75">
        パスワード（任意・空なら不要）
        <input
          type="password"
          value={createPassword}
          onChange={(e) => setCreatePassword(e.target.value)}
          autoComplete="new-password"
          className="mt-1 w-full rounded-xl border border-[#ece5d8]/20 bg-[#0a0f1e] px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/35 focus:border-emerald-400/40"
        />
      </label>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-white/80">
        <input
          type="checkbox"
          checked={createPublic}
          onChange={(e) => setCreatePublic(e.target.checked)}
          className="rounded border-[#ece5d8]/40"
        />
        公開ルーム一覧に載せる
      </label>
      <div className="rounded-xl border border-[#ece5d8]/10 bg-[#0a0f1e]/80 px-3 py-3">
        <p className="text-xs font-medium text-[#ece5d8]/65">
          ゲームルール（作成後もホストが対戦画面で変更可）
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setMaxHandsLimited(true)}
            className={`rounded-full px-4 py-1.5 text-xs font-medium transition ${
              maxHandsLimited
                ? "border border-emerald-500/50 bg-emerald-950/50 text-emerald-100"
                : "border border-[#ece5d8]/20 bg-transparent text-white/65 hover:border-[#ece5d8]/35"
            }`}
          >
            7手まで
          </button>
          <button
            type="button"
            onClick={() => setMaxHandsLimited(false)}
            className={`rounded-full px-4 py-1.5 text-xs font-medium transition ${
              !maxHandsLimited
                ? "border border-sky-500/50 bg-sky-950/50 text-sky-100"
                : "border border-[#ece5d8]/20 bg-transparent text-white/65 hover:border-[#ece5d8]/35"
            }`}
          >
            無制限（♾️）
          </button>
        </div>
        <p className="mt-2 text-[0.7rem] leading-relaxed text-white/45">
          制限: 1手につき {ROOM_MOVE_TIMEOUT_SEC_DEFAULT}
          秒。時間切れはミス1回（1手消費）です。
        </p>
      </div>
      {createError && <p className="text-sm text-rose-400">{createError}</p>}
      <button
        type="button"
        disabled={createBusy}
        onClick={() => void tryCreate()}
        className="w-full rounded-xl border border-emerald-500/45 bg-emerald-950/40 py-3 text-sm font-semibold text-emerald-100 transition hover:border-emerald-400/60 disabled:opacity-50"
      >
        {createBusy ? "作成中…" : "部屋番号を発行して入室"}
      </button>
    </div>
  );

  const joinForm = (
    <div className="space-y-3">
      <label className="block text-xs font-medium text-[#ece5d8]/75">
        あなたの表示名（2〜12 文字）
        <input
          value={joinPlayerName}
          onChange={(e) => setJoinPlayerName(e.target.value)}
          maxLength={12}
          autoComplete="nickname"
          placeholder="例: 旅人"
          className="mt-1 w-full rounded-xl border border-[#ece5d8]/20 bg-[#0a0f1e] px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/35 focus:border-sky-400/40"
        />
      </label>
      <label className="block text-xs font-medium text-[#ece5d8]/75">
        5桁の部屋番号
        <input
          value={joinCode}
          onChange={(e) =>
            setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))
          }
          maxLength={5}
          inputMode="text"
          autoCapitalize="characters"
          placeholder="XJ79L"
          className="mt-1 w-full rounded-xl border border-[#ece5d8]/20 bg-[#0a0f1e] px-3 py-2.5 font-mono text-sm tracking-widest text-white outline-none placeholder:text-white/35 focus:border-sky-400/40"
        />
      </label>
      <label className="block text-xs font-medium text-[#ece5d8]/75">
        パスワード（設定されている場合）
        <input
          type="password"
          value={joinPassword}
          onChange={(e) => setJoinPassword(e.target.value)}
          className="mt-1 w-full rounded-xl border border-[#ece5d8]/20 bg-[#0a0f1e] px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/35 focus:border-sky-400/40"
        />
      </label>
      {joinError && <p className="text-sm text-rose-400">{joinError}</p>}
      <button
        type="button"
        disabled={joinBusy}
        onClick={() => void tryJoin()}
        className="w-full rounded-xl border border-sky-500/45 bg-sky-950/40 py-3 text-sm font-semibold text-sky-100 transition hover:border-sky-400/60 disabled:opacity-50"
      >
        {joinBusy ? "確認中…" : "この番号で入室"}
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0a0f1e] px-4 py-10 text-white">
      <div className="mx-auto w-full max-w-lg space-y-8">
        <div className="flex justify-start">
          <Link
            href="/"
            className="text-sm font-medium text-[#ece5d8]/85 underline-offset-4 transition hover:text-[#ece5d8] hover:underline"
          >
            ← トップに戻る
          </Link>
        </div>

        <header className="text-center">
          <p className="text-xs font-medium uppercase tracking-[0.35em] text-[#ece5d8]/70">
            GenshinGuesser
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-[#ece5d8] sm:text-3xl">
            リアルタイム対戦
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-white/55">
            野良や友達と盛り上がろう。
          </p>
        </header>

        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => {
              setCreateError(null);
              setJoinModalOpen(false);
              setCreateModalOpen(true);
            }}
            className="rounded-2xl border border-emerald-500/40 bg-[#12182a]/90 px-4 py-4 text-center text-sm font-semibold text-emerald-100 shadow-lg transition hover:border-emerald-400/55 hover:bg-emerald-950/20"
          >
            ルームを作成
          </button>
          <button
            type="button"
            onClick={() => {
              setJoinError(null);
              setCreateModalOpen(false);
              setJoinModalOpen(true);
            }}
            className="rounded-2xl border border-sky-500/40 bg-[#12182a]/90 px-4 py-4 text-center text-sm font-semibold text-sky-100 shadow-lg transition hover:border-sky-400/55 hover:bg-sky-950/20"
          >
            部屋番号で入室
          </button>
        </div>

        <section className="rounded-2xl border border-[#ece5d8]/15 bg-[#12182a]/90 p-5 shadow-lg">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h2 className="text-lg font-semibold text-[#ece5d8]">
              公開ルーム一覧
            </h2>
            <button
              type="button"
              disabled={publicRoomsLoading}
              onClick={() => void loadPublicRooms()}
              className="shrink-0 rounded-lg border border-[#ece5d8]/30 px-2.5 py-1 text-xs font-medium text-[#ece5d8] transition hover:border-[#ece5d8]/50 disabled:opacity-50"
            >
              {publicRoomsLoading ? "更新中…" : "一覧を更新"}
            </button>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-white/45">
            自分がホストの公開ルームは、入室の横の「解散」でいつでも閉じられます（ゲーム画面と同じ）。
            公開枠は同時{MAX_PUBLIC_ROOMS}件まで。一覧は約10分ごと（タブが表示中のとき）に自動取得します。
          </p>
          {publicRooms.length === 0 ? (
            <p className="mt-3 text-sm text-white/45">
              公開中のルームはまだありません。
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {publicRooms.map((r) => {
                const cap =
                  typeof r.maxPlayers === "number" &&
                  r.maxPlayers >= 2 &&
                  r.maxPlayers <= 99
                    ? r.maxPlayers
                    : ROOM_MAX_PLAYERS_DEFAULT;
                return (
                  <li
                    key={r.code}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#ece5d8]/10 bg-[#0a0f1e]/80 px-3 py-2.5"
                  >
                    <div>
                      <p className="font-medium text-[#ece5d8]">{r.name}</p>
                      <p className="font-mono text-xs tabular-nums text-white/50">
                        {r.code}{" "}
                        {r.passwordHash ? (
                          <span className="text-amber-200/80">🔒</span>
                        ) : null}
                        {" · "}
                        定員 {cap} 名まで
                        {" · "}
                        {r.maxHandsLimited ? "7手" : "♾️"}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          void enterFromList(r.code, Boolean(r.passwordHash))
                        }
                        className="rounded-lg border border-[#ece5d8]/25 px-3 py-1.5 text-xs font-medium text-[#ece5d8] transition hover:border-[#ece5d8]/45"
                      >
                        入室
                      </button>
                      {viewerUid && r.hostUid === viewerUid ? (
                        <button
                          type="button"
                          disabled={adminDeleteCode === r.code}
                          onClick={() => void dissolveRoomAsHost(r.code)}
                          className="rounded-lg border border-orange-500/45 bg-orange-950/35 px-2.5 py-1.5 text-xs font-medium text-orange-100 transition hover:border-orange-400/55 disabled:opacity-50"
                        >
                          {adminDeleteCode === r.code ? "解散中…" : "解散"}
                        </button>
                      ) : null}
                      {isAdminUid(viewerUid) ? (
                        <button
                          type="button"
                          disabled={adminDeleteCode === r.code}
                          onClick={() => void deletePublicRoomAsAdmin(r.code)}
                          className="rounded-lg border border-rose-500/45 bg-rose-950/35 px-2.5 py-1.5 text-xs font-medium text-rose-100 transition hover:border-rose-400/55 disabled:opacity-50"
                        >
                          {adminDeleteCode === r.code ? "削除中…" : "削除"}
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {IS_NEXT_DEV ? (
          <section className="rounded-2xl border border-dashed border-amber-500/40 bg-[#0a0f1e]/90 p-4 text-sm shadow-inner">
            <p className="text-xs font-semibold text-amber-200/95">
              開発環境のみ：ルーム強制削除
            </p>
            <p className="mt-1 text-[0.7rem] leading-relaxed text-white/45">
              <code className="text-white/55">next dev</code>{" "}
              かつ .env.local に{" "}
              <code className="text-white/55">FIREBASE_SERVICE_ACCOUNT_JSON</code>{" "}
              があるとき Firestore から該当ルームを消せます（ホスト不要）。
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="flex min-w-[9rem] flex-1 flex-col text-[0.65rem] text-white/55">
                部屋番号（5桁）
                <input
                  value={devForceDeleteCode}
                  onChange={(e) =>
                    setDevForceDeleteCode(
                      e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "")
                    )
                  }
                  maxLength={5}
                  className="mt-1 rounded-lg border border-white/15 bg-black/35 px-2 py-2 font-mono text-sm text-white outline-none focus:border-amber-400/40"
                  placeholder="CF4GM"
                />
              </label>
              <button
                type="button"
                disabled={devForceDeleteBusy}
                onClick={() => void forceDeleteRoomDev()}
                className="rounded-lg border border-rose-500/45 bg-rose-950/40 px-3 py-2 text-xs font-medium text-rose-100 transition hover:border-rose-400/55 disabled:opacity-50"
              >
                {devForceDeleteBusy ? "削除中…" : "強制削除"}
              </button>
            </div>
            {devForceDeleteMsg ? (
              <p className="mt-2 text-xs text-[#ece5d8]/80">{devForceDeleteMsg}</p>
            ) : null}
          </section>
        ) : null}
      </div>

      {createModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 p-0 sm:items-center sm:p-4"
          role="presentation"
          onClick={() => setCreateModalOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-room-title"
            className="max-h-[min(90vh,720px)] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-[#ece5d8]/20 bg-[#12182a] shadow-2xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[#ece5d8]/15 bg-[#12182a]/95 px-5 py-3 backdrop-blur-sm">
              <h2
                id="create-room-title"
                className="text-lg font-semibold text-[#ece5d8]"
              >
                ルームを作成
              </h2>
              <button
                type="button"
                className="rounded-lg px-2 py-1 text-sm text-[#ece5d8]/75 transition hover:bg-white/10 hover:text-white"
                onClick={() => setCreateModalOpen(false)}
              >
                閉じる
              </button>
            </div>
            <div className="p-5">{createForm}</div>
          </div>
        </div>
      ) : null}

      {joinModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 p-0 sm:items-center sm:p-4"
          role="presentation"
          onClick={() => setJoinModalOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="join-room-title"
            className="max-h-[min(90vh,560px)] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-[#ece5d8]/20 bg-[#12182a] shadow-2xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[#ece5d8]/15 bg-[#12182a]/95 px-5 py-3 backdrop-blur-sm">
              <h2
                id="join-room-title"
                className="text-lg font-semibold text-[#ece5d8]"
              >
                部屋番号で入室
              </h2>
              <button
                type="button"
                className="rounded-lg px-2 py-1 text-sm text-[#ece5d8]/75 transition hover:bg-white/10 hover:text-white"
                onClick={() => setJoinModalOpen(false)}
              >
                閉じる
              </button>
            </div>
            <div className="p-5">{joinForm}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
