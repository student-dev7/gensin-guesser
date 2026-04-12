"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  writeBatch,
} from "firebase/firestore";
import {
  ensureAnonymousSession,
  getFirebaseAuth,
} from "../lib/firebaseClient";
import { RankLogoMark } from "./RankLogoMark";
import { DEFAULT_INITIAL_RATING } from "../lib/elo";
import {
  formatRankTierLine,
  getRankData,
  rateForRankDisplay,
} from "../lib/rankUtils";
import { isAdminUid } from "../lib/adminUids";
import { validateDisplayName } from "../lib/validateDisplayName";

const CHAT_COLLECTION = "chat_messages";
const CHAT_MESSAGE_MAX = 80;
/** 保持・表示する最大件数（古いものから削除） */
const MAX_CHAT_MESSAGES = 15;
/** 管理者の一括削除で1回のバッチに載せる最大件数（Firestore 上限 500 未満） */
const ADMIN_PURGE_BATCH = 450;
/** 無操作でリスナーを外す（分） */
const IDLE_MINUTES = 4;
const IDLE_MS = IDLE_MINUTES * 60 * 1000;

export type ChatMessageRow = {
  id: string;
  text: string;
  displayName: string;
  uid: string;
  /** Firestore の Timestamp（スナップショットからそのまま） */
  createdAt?: Timestamp | { seconds?: number; nanoseconds?: number } | null;
};

/** 送信時刻を日本時間で「12:34」形式（serverTimestamp 由来の Timestamp を想定） */
function formatChatSentAt(createdAt: ChatMessageRow["createdAt"]): string {
  let date: Date | null = null;
  if (createdAt instanceof Timestamp) {
    date = createdAt.toDate();
  } else if (
    createdAt &&
    typeof createdAt === "object" &&
    typeof createdAt.seconds === "number"
  ) {
    date = new Date(createdAt.seconds * 1000);
  }
  if (!date || Number.isNaN(date.getTime())) return "";

  return date.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function ChatRoomPanel(props: {
  onClose: () => void;
  playerName: string;
}) {
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [listenIdle, setListenIdle] = useState(false);
  const [reconnectKey, setReconnectKey] = useState(0);
  const [myUid, setMyUid] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [clearingAll, setClearingAll] = useState(false);
  /** uid → 累計レート由来のランク表示ラベル（再レンダー用に tick と併用） */
  const rankLabelRef = useRef<Record<string, string>>({});
  /** ランクロゴ用（rateForRankDisplay 済みの累計レート） */
  const rankDisplayRatingRef = useRef<Record<string, number | undefined>>({});
  const [rankLabelsTick, setRankLabelsTick] = useState(0);

  const unsubRef = useRef<(() => void) | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bumpActivityRef = useRef<() => void>(() => {});
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const displayNameForSend = useMemo(() => {
    const v = validateDisplayName(props.playerName, {
      ignoreBadSubstrings: myUid != null && isAdminUid(myUid),
    });
    return v.ok ? v.name : "旅人";
  }, [props.playerName, myUid]);

  const bumpActivity = useCallback(() => {
    bumpActivityRef.current();
  }, []);

  useEffect(() => {
    let cancelled = false;

    const clearIdle = () => {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    };

    const bump = () => {
      if (!unsubRef.current) return;
      clearIdle();
      idleTimerRef.current = setTimeout(() => {
        unsubRef.current?.();
        unsubRef.current = null;
        setConnected(false);
        setListenIdle(true);
        clearIdle();
      }, IDLE_MS);
    };
    bumpActivityRef.current = bump;

    setError(null);
    setListenIdle(false);

    const run = async () => {
      try {
        await ensureAnonymousSession();
        if (cancelled) return;
        const auth = getFirebaseAuth();
        setMyUid(auth.currentUser?.uid ?? null);
        const db = getFirestore(auth.app);
        const q = query(
          collection(db, CHAT_COLLECTION),
          orderBy("createdAt", "desc"),
          limit(MAX_CHAT_MESSAGES)
        );
        const unsub = onSnapshot(
          q,
          (snap) => {
            const rows: ChatMessageRow[] = snap.docs.map((d) => {
              const data = d.data();
              return {
                id: d.id,
                text: typeof data.text === "string" ? data.text : "",
                displayName:
                  typeof data.displayName === "string"
                    ? data.displayName
                    : "?",
                uid: typeof data.uid === "string" ? data.uid : "",
                createdAt: data.createdAt ?? null,
              };
            });
            setMessages(rows.reverse());
            requestAnimationFrame(() => {
              const el = scrollRef.current;
              if (el) el.scrollTop = el.scrollHeight;
            });
          },
          (err) => setError(err.message)
        );
        unsubRef.current = unsub;
        setConnected(true);
        bump();
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      unsubRef.current?.();
      unsubRef.current = null;
      clearIdle();
      setConnected(false);
    };
  }, [reconnectKey]);

  useEffect(() => {
    const uids = [
      ...new Set(messages.map((m) => m.uid).filter((u) => u.length > 0)),
    ];
    const missing = uids.filter((uid) => rankLabelRef.current[uid] === undefined);
    if (missing.length === 0) return;

    let cancelled = false;
    void (async () => {
      try {
        const auth = getFirebaseAuth();
        const db = getFirestore(auth.app);
        await Promise.all(
          missing.map(async (uid) => {
            try {
              const snap = await getDoc(doc(db, "users", uid));
              let lt = DEFAULT_INITIAL_RATING;
              if (snap.exists()) {
                const d = snap.data() as {
                  lifetime_total_rate?: unknown;
                  rating?: unknown;
                };
                if (
                  typeof d.lifetime_total_rate === "number" &&
                  Number.isFinite(d.lifetime_total_rate)
                ) {
                  lt = d.lifetime_total_rate;
                } else if (
                  typeof d.rating === "number" &&
                  Number.isFinite(d.rating)
                ) {
                  lt = d.rating;
                }
              }
              const displayRate = rateForRankDisplay(lt);
              rankDisplayRatingRef.current[uid] = displayRate;
              rankLabelRef.current[uid] = formatRankTierLine(
                getRankData(displayRate)
              );
            } catch {
              rankLabelRef.current[uid] = "—";
              rankDisplayRatingRef.current[uid] = undefined;
            }
          })
        );
        if (!cancelled) setRankLabelsTick((t) => t + 1);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [messages]);

  const send = useCallback(async () => {
    const raw = input.trim();
    if (!raw || sending) return;
    if (raw.length > CHAT_MESSAGE_MAX) {
      setError(`${CHAT_MESSAGE_MAX}文字以内で入力してください`);
      return;
    }
    if (!connected || !unsubRef.current) {
      setError("接続が切れています。再接続してください。");
      return;
    }

    setSending(true);
    setError(null);
    try {
      await ensureAnonymousSession();
      const auth = getFirebaseAuth();
      const uid = auth.currentUser?.uid;
      if (!uid) {
        setError("ログインできませんでした");
        return;
      }
      const db = getFirestore(auth.app);
      await addDoc(collection(db, CHAT_COLLECTION), {
        text: raw,
        displayName: displayNameForSend,
        uid,
        // サーバー時刻（クライアント時計に依存しない）
        createdAt: serverTimestamp(),
      });
      setInput("");
      bumpActivity();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }, [
    input,
    sending,
    connected,
    displayNameForSend,
    bumpActivity,
  ]);

  const reconnect = useCallback(() => {
    setReconnectKey((k) => k + 1);
  }, []);

  const isModerator = myUid != null && isAdminUid(myUid);

  const deleteMessage = useCallback(
    async (messageId: string, authorUid: string) => {
      if (!messageId || deletingId) return;
      if (!myUid) return;
      if (authorUid !== myUid && !isAdminUid(myUid)) return;
      setDeletingId(messageId);
      setError(null);
      try {
        await ensureAnonymousSession();
        const auth = getFirebaseAuth();
        const uid = auth.currentUser?.uid;
        if (!uid || (uid !== authorUid && !isAdminUid(uid))) {
          setError("削除できませんでした");
          return;
        }
        const db = getFirestore(auth.app);
        await deleteDoc(doc(db, CHAT_COLLECTION, messageId));
        bumpActivity();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setDeletingId(null);
      }
    },
    [myUid, deletingId, bumpActivity]
  );

  const deleteAllMessages = useCallback(async () => {
    if (!myUid || !isAdminUid(myUid) || clearingAll) return;
    if (
      !window.confirm(
        "チャットのメッセージをすべて削除しますか？（取り消せません）"
      )
    ) {
      return;
    }
    setClearingAll(true);
    setError(null);
    try {
      await ensureAnonymousSession();
      const auth = getFirebaseAuth();
      const uid = auth.currentUser?.uid;
      if (!uid || !isAdminUid(uid)) {
        setError("管理者のみ実行できます");
        return;
      }
      const db = getFirestore(auth.app);
      for (;;) {
        const snap = await getDocs(
          query(collection(db, CHAT_COLLECTION), limit(ADMIN_PURGE_BATCH))
        );
        if (snap.empty) break;
        const batch = writeBatch(db);
        for (const d of snap.docs) {
          batch.delete(d.ref);
        }
        await batch.commit();
        if (snap.docs.length < ADMIN_PURGE_BATCH) break;
      }
      bumpActivity();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setClearingAll(false);
    }
  }, [myUid, clearingAll, bumpActivity]);

  void rankLabelsTick;

  return (
    <div
      className="fixed inset-0 z-[115] flex items-end justify-center bg-black/55 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-[2px] sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="chat-room-title"
    >
      <div className="flex max-h-[min(32rem,calc(100vh-2rem))] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-[#ece5d8]/25 bg-[#12182a] shadow-2xl shadow-black/50">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[#ece5d8]/15 px-4 py-3">
          <h2
            id="chat-room-title"
            className="text-sm font-semibold text-[#ece5d8]"
          >
            チャット
          </h2>
          <div className="flex items-center gap-2">
            {isModerator && (
              <button
                type="button"
                onClick={() => void deleteAllMessages()}
                disabled={clearingAll}
                className="rounded-lg border border-rose-500/40 px-2 py-1 text-xs font-medium text-rose-200/95 transition hover:bg-rose-950/50 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {clearingAll ? "削除中…" : "全削除"}
              </button>
            )}
            <span
              className={`text-xs tabular-nums ${
                connected ? "text-emerald-300/90" : "text-amber-200/85"
              }`}
              title={
                connected
                  ? "リアルタイム接続中"
                  : listenIdle
                    ? "放置のため切断しました"
                    : "接続していません"
              }
            >
              {connected ? "接続中" : listenIdle ? "切断（放置）" : "…"}
            </span>
            {!connected && listenIdle && (
              <button
                type="button"
                onClick={reconnect}
                className="rounded-lg border border-[#ece5d8]/30 px-2 py-1 text-xs font-medium text-[#ece5d8] transition hover:bg-white/10"
              >
                再接続
              </button>
            )}
            <button
              type="button"
              onClick={props.onClose}
              className="rounded-lg px-2 py-1 text-sm text-white/70 transition hover:bg-white/10"
              aria-label="閉じる"
            >
              ✕
            </button>
          </div>
        </div>

        {listenIdle && !connected && (
          <p className="shrink-0 border-b border-amber-500/25 bg-amber-950/35 px-4 py-2 text-xs leading-relaxed text-amber-100/90">
            {IDLE_MINUTES}
            分間、入力・スクロールがなかったため接続を切りました。再接続でまた購読します。
          </p>
        )}

        <div
          ref={scrollRef}
          onScroll={bumpActivity}
          className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3"
        >
          {messages.length === 0 && connected && (
            <p className="text-center text-sm text-white/45">
              まだメッセージがありません。
            </p>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              className="rounded-xl border border-[#ece5d8]/10 bg-[#0a0f1e]/90 px-3 py-2 text-sm"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
                  <span className="font-medium text-[#ece5d8]/95">
                    {m.displayName}
                  </span>
                  {rankLabelRef.current[m.uid] && (
                    <span className="flex min-w-0 max-w-[min(100%,13rem)] items-center gap-1">
                      {rankDisplayRatingRef.current[m.uid] != null &&
                        rankLabelRef.current[m.uid] !== "—" && (
                          <RankLogoMark
                            rating={rankDisplayRatingRef.current[m.uid]!}
                            sizePx={15}
                            className="shrink-0"
                          />
                        )}
                      <span
                        className="min-w-0 truncate text-[0.9375rem] font-semibold leading-tight text-amber-200/85"
                        title={rankLabelRef.current[m.uid]}
                      >
                        {rankLabelRef.current[m.uid]}
                      </span>
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-[0.65rem] tabular-nums text-white/40">
                    {formatChatSentAt(m.createdAt)}
                  </span>
                  {myUid != null && (m.uid === myUid || isModerator) && (
                    <button
                      type="button"
                      onClick={() => void deleteMessage(m.id, m.uid)}
                      disabled={deletingId === m.id}
                      className="rounded-md px-1.5 py-0.5 text-[0.65rem] font-medium text-rose-300/90 transition hover:bg-rose-950/60 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {deletingId === m.id ? "…" : "削除"}
                    </button>
                  )}
                </div>
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-white/88">
                {m.text}
              </p>
            </div>
          ))}
        </div>

        {error && (
          <p className="shrink-0 border-t border-rose-500/25 bg-rose-950/30 px-4 py-2 text-xs text-rose-200">
            {error}
          </p>
        )}

        <div className="shrink-0 border-t border-[#ece5d8]/15 p-3">
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                bumpActivity();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
                bumpActivity();
              }}
              disabled={!connected || sending}
              maxLength={CHAT_MESSAGE_MAX}
              placeholder={
                connected ? "メッセージ（Enter で送信）" : "接続を待っています…"
              }
              rows={2}
              className="min-h-[2.75rem] flex-1 resize-none rounded-xl border border-[#ece5d8]/20 bg-[#0a0f1e] px-3 py-2 text-sm text-white outline-none placeholder:text-white/35 focus:border-[#ece5d8]/45 focus:ring-2 focus:ring-[#ece5d8]/15 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={!connected || sending || !input.trim()}
              className="shrink-0 self-end rounded-xl border border-[#ece5d8]/35 bg-[#ece5d8]/10 px-4 py-2 text-sm font-medium text-[#ece5d8] transition hover:bg-[#ece5d8]/20 disabled:cursor-not-allowed disabled:opacity-45"
            >
              送信
            </button>
          </div>
          <p className="mt-1.5 text-[0.65rem] text-white/40">
            表示名は「名前変更」で登録した名前（未登録は「旅人」）。最大
            {CHAT_MESSAGE_MAX}
            文字。表示は直近 {MAX_CHAT_MESSAGES} 件までです。
          </p>
        </div>
      </div>
    </div>
  );
}
