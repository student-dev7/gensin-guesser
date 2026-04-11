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
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import {
  ensureAnonymousSession,
  getFirebaseAuth,
} from "../lib/firebaseClient";
import { validateDisplayName } from "../lib/validateDisplayName";

const CHAT_COLLECTION = "chat_messages";
const CHAT_MESSAGE_MAX = 80;
/** 無操作でリスナーを外す（分） */
const IDLE_MINUTES = 4;
const IDLE_MS = IDLE_MINUTES * 60 * 1000;
const PAGE_SIZE = 50;

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

  const unsubRef = useRef<(() => void) | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bumpActivityRef = useRef<() => void>(() => {});
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const displayNameForSend = useMemo(() => {
    const v = validateDisplayName(props.playerName);
    return v.ok ? v.name : "旅人";
  }, [props.playerName]);

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
        const db = getFirestore(auth.app);
        const q = query(
          collection(db, CHAT_COLLECTION),
          orderBy("createdAt", "desc"),
          limit(PAGE_SIZE)
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
                <span className="font-medium text-[#ece5d8]/95">
                  {m.displayName}
                </span>
                <span className="text-[0.65rem] tabular-nums text-white/40">
                  {formatChatSentAt(m.createdAt)}
                </span>
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
            {CHAT_MESSAGE_MAX}文字。
          </p>
        </div>
      </div>
    </div>
  );
}
