"use client";

import { useCallback, useEffect, useState } from "react";
import {
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { clampRating, DEFAULT_INITIAL_RATING } from "@/lib/elo";
import { DEBUG_USER_UPDATED_EVENT } from "@/lib/debugUserEvents";
import {
  ensureAnonymousSession,
  getFirebaseAuth,
} from "@/lib/firebaseClient";

function isDevLocalhostHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

export function DebugUserTools() {
  const [showUi, setShowUi] = useState(false);
  const [open, setOpen] = useState(false);
  const [ratingDraft, setRatingDraft] = useState("");
  const [goldDraft, setGoldDraft] = useState("");
  const [peakDraft, setPeakDraft] = useState("");
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setShowUi(isDevLocalhostHost(window.location.hostname));
  }, []);

  const loadCurrent = useCallback(async () => {
    setError(null);
    setMessage(null);
    setLoadingDoc(true);
    try {
      await ensureAnonymousSession();
      const auth = getFirebaseAuth();
      const uid = auth.currentUser?.uid;
      if (!uid) {
        setError("未ログインです");
        return;
      }
      const db = getFirestore(auth.app);
      const snap = await getDoc(doc(db, "users", uid));
      if (!snap.exists()) {
        setRatingDraft(String(DEFAULT_INITIAL_RATING));
        setGoldDraft("0");
        setPeakDraft("");
        return;
      }
      const d = snap.data();
      const r =
        typeof d?.rating === "number" && Number.isFinite(d.rating)
          ? d.rating
          : DEFAULT_INITIAL_RATING;
      const g =
        typeof d?.gold === "number" && Number.isFinite(d.gold) ? d.gold : 0;
      const p =
        typeof d?.peakRating === "number" && Number.isFinite(d.peakRating)
          ? d.peakRating
          : r;
      setRatingDraft(String(Math.round(r)));
      setGoldDraft(String(Math.round(g)));
      setPeakDraft(String(Math.round(p)));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingDoc(false);
    }
  }, []);

  useEffect(() => {
    if (!open || !showUi) return;
    void loadCurrent();
  }, [open, showUi, loadCurrent]);

  const apply = useCallback(async () => {
    setError(null);
    setMessage(null);
    setSaving(true);
    try {
      await ensureAnonymousSession();
      const auth = getFirebaseAuth();
      const uid = auth.currentUser?.uid;
      if (!uid) {
        setError("未ログインです");
        return;
      }
      const r = Number(ratingDraft);
      const g = Number(goldDraft);
      if (!Number.isFinite(r) || !Number.isFinite(g)) {
        setError("数値が不正です");
        return;
      }
      let peak: number;
      if (peakDraft.trim() === "") {
        peak = r;
      } else {
        const p = Number(peakDraft);
        if (!Number.isFinite(p)) {
          setError("到達peakの数値が不正です");
          return;
        }
        peak = p;
      }
      const db = getFirestore(auth.app);
      await setDoc(
        doc(db, "users", uid),
        {
          rating: clampRating(r),
          gold: Math.max(0, g),
          peakRating: clampRating(peak),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      setMessage("Firestore に反映しました。");
      window.dispatchEvent(new Event(DEBUG_USER_UPDATED_EVENT));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [ratingDraft, goldDraft, peakDraft]);

  if (!showUi) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 left-4 z-[200] rounded-lg border border-rose-500/50 bg-rose-950/95 px-2.5 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wide text-rose-100 shadow-lg shadow-black/40 backdrop-blur-sm hover:border-rose-400/70 hover:bg-rose-900/95"
        title="localhost のみ表示（デバッグ）"
      >
        DBG
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[210] flex items-end justify-center bg-black/55 p-4 pb-8 backdrop-blur-[2px] sm:items-center sm:pb-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="debug-user-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="w-full max-w-sm rounded-2xl border border-rose-500/35 bg-[#1a0a0f] p-5 shadow-2xl shadow-black/60">
            <div className="flex items-start justify-between gap-2">
              <h2
                id="debug-user-title"
                className="text-sm font-semibold text-rose-100"
              >
                デバッグ（localhost のみ）
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded px-2 py-0.5 text-lg leading-none text-white/50 hover:bg-white/10 hover:text-white"
                aria-label="閉じる"
              >
                ×
              </button>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-rose-200/70">
              自分の Firestore ユーザーを直接書き換えます。本番では表示されません。
            </p>

            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="text-xs text-white/60">今週のレート</span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={ratingDraft}
                  onChange={(e) => setRatingDraft(e.target.value)}
                  disabled={loadingDoc}
                  className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm tabular-nums text-white outline-none focus:border-rose-400/50"
                />
              </label>
              <label className="block">
                <span className="text-xs text-white/60">ゴールド</span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={goldDraft}
                  onChange={(e) => setGoldDraft(e.target.value)}
                  disabled={loadingDoc}
                  className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm tabular-nums text-white outline-none focus:border-rose-400/50"
                />
              </label>
              <label className="block">
                <span className="text-xs text-white/60">
                  到達 peak（永続ランク用・空欄で今週レートと同じ）
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={peakDraft}
                  onChange={(e) => setPeakDraft(e.target.value)}
                  disabled={loadingDoc}
                  placeholder="空欄可"
                  className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm tabular-nums text-white outline-none placeholder:text-white/30 focus:border-rose-400/50"
                />
              </label>
            </div>

            {error && (
              <p className="mt-3 text-xs text-rose-300">{error}</p>
            )}
            {message && (
              <p className="mt-3 text-xs text-emerald-300/95">{message}</p>
            )}

            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => void loadCurrent()}
                disabled={loadingDoc}
                className="rounded-xl border border-white/20 px-4 py-2 text-sm text-white/80 hover:bg-white/10 disabled:opacity-50"
              >
                再読込
              </button>
              <button
                type="button"
                onClick={() => void apply()}
                disabled={saving || loadingDoc}
                className="rounded-xl border border-rose-400/50 bg-rose-600/80 px-4 py-2 text-sm font-medium text-white hover:bg-rose-500/90 disabled:opacity-50"
              >
                {saving ? "保存中…" : "適用"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
