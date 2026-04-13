"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getFirestore,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import {
  generateRoomCode,
  normalizeRoomCode,
  ROOM_MOVE_TIMEOUT_SEC_DEFAULT,
  type RoomDocument,
} from "@/lib/roomTypes";
import { roomPasswordInputKey, sha256HexUtf8 } from "@/lib/roomHash";
import {
  ensureAnonymousSession,
  getFirebaseAuth,
} from "@/lib/firebaseClient";

function firestoreDb() {
  return getFirestore(getFirebaseAuth().app);
}

export function RoomsLobby() {
  const router = useRouter();
  const [createName, setCreateName] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createPublic, setCreatePublic] = useState(true);
  const [maxHandsLimited, setMaxHandsLimited] = useState(true);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [joinCode, setJoinCode] = useState("");
  const [joinPassword, setJoinPassword] = useState("");
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const [publicRooms, setPublicRooms] = useState<RoomDocument[]>([]);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [joinModalOpen, setJoinModalOpen] = useState(false);

  useEffect(() => {
    void ensureAnonymousSession().catch(() => {});
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

  useEffect(() => {
    const db = firestoreDb();
    const q = query(
      collection(db, "rooms"),
      where("isPublic", "==", true),
      limit(40)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: RoomDocument[] = [];
        snap.forEach((d) => rows.push(d.data() as RoomDocument));
        rows.sort((a, b) => {
          const ta = (a.createdAt as { seconds?: number })?.seconds ?? 0;
          const tb = (b.createdAt as { seconds?: number })?.seconds ?? 0;
          return tb - ta;
        });
        setPublicRooms(rows);
      },
      () => setPublicRooms([])
    );
    return () => unsub();
  }, []);

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
    setCreateBusy(true);
    try {
      await ensureAnonymousSession();
      const auth = getFirebaseAuth();
      const uid = auth.currentUser?.uid;
      if (!uid) {
        setCreateError("ログインに失敗しました");
        return;
      }
      const db = firestoreDb();
      let code = "";
      for (let attempt = 0; attempt < 12; attempt++) {
        code = generateRoomCode();
        const ref = doc(db, "rooms", code);
        const exists = await getDoc(ref);
        if (!exists.exists()) {
          const pw = createPassword.trim();
          const passwordHash =
            pw.length > 0 ? await sha256HexUtf8(`${code}|${pw}`) : "";
          const payload: Record<string, unknown> = {
            code,
            name,
            hostUid: uid,
            isPublic: createPublic,
            maxHandsLimited,
            moveTimeoutSec: ROOM_MOVE_TIMEOUT_SEC_DEFAULT,
            passwordHash,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          await setDoc(ref, payload);
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
  }, [normalizedJoin, joinPassword, router]);

  const enterFromList = useCallback(
    async (code: string, needsPassword: boolean) => {
      setJoinError(null);
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
          <h2 className="text-lg font-semibold text-[#ece5d8]">
            公開ルーム一覧
          </h2>
          {publicRooms.length === 0 ? (
            <p className="mt-3 text-sm text-white/45">
              公開中のルームはまだありません。
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {publicRooms.map((r) => (
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
                      {r.maxHandsLimited ? "7手" : "♾️"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      void enterFromList(r.code, Boolean(r.passwordHash))
                    }
                    className="shrink-0 rounded-lg border border-[#ece5d8]/25 px-3 py-1.5 text-xs font-medium text-[#ece5d8] transition hover:border-[#ece5d8]/45"
                  >
                    入室
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
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
