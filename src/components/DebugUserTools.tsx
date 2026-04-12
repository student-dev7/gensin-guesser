"use client";

import { useCallback, useEffect, useState } from "react";
import {
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import {
  clampLifetimeTotalRate,
  clampRating,
  DEFAULT_INITIAL_RATING,
} from "@/lib/elo";
import { DEBUG_USER_UPDATED_EVENT } from "@/lib/debugUserEvents";
import {
  ensureAnonymousSession,
  getFirebaseAuth,
} from "@/lib/firebaseClient";
import { useAdminMode } from "@/components/AdminModeProvider";

export function DebugUserTools() {
  const { showAdminTools } = useAdminMode();
  const [open, setOpen] = useState(false);
  const [seasonDraft, setSeasonDraft] = useState("");
  const [lifetimeDraft, setLifetimeDraft] = useState("");
  const [goldDraft, setGoldDraft] = useState("");
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        setSeasonDraft(String(DEFAULT_INITIAL_RATING));
        setLifetimeDraft(String(DEFAULT_INITIAL_RATING));
        setGoldDraft("0");
        return;
      }
      const d = snap.data();
      const season =
        typeof d?.current_rate === "number" && Number.isFinite(d.current_rate)
          ? d.current_rate
          : typeof d?.rating === "number" && Number.isFinite(d.rating)
            ? d.rating
            : DEFAULT_INITIAL_RATING;
      const lifetime =
        typeof d?.lifetime_total_rate === "number" &&
        Number.isFinite(d.lifetime_total_rate)
          ? d.lifetime_total_rate
          : typeof d?.rating === "number" && Number.isFinite(d.rating)
            ? d.rating
            : DEFAULT_INITIAL_RATING;
      const g =
        typeof d?.gold === "number" && Number.isFinite(d.gold) ? d.gold : 0;
      setSeasonDraft(String(Math.round(season)));
      setLifetimeDraft(String(Math.round(lifetime)));
      setGoldDraft(String(Math.round(g)));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingDoc(false);
    }
  }, []);

  useEffect(() => {
    if (!open || !showAdminTools) return;
    void loadCurrent();
  }, [open, showAdminTools, loadCurrent]);

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
      const season = Number(seasonDraft);
      const lifetime = Number(lifetimeDraft);
      const g = Number(goldDraft);
      if (
        !Number.isFinite(season) ||
        !Number.isFinite(lifetime) ||
        !Number.isFinite(g)
      ) {
        setError("数値が不正です");
        return;
      }
      const cr = clampRating(season);
      const lt = clampLifetimeTotalRate(lifetime);
      const db = getFirestore(auth.app);
      await setDoc(
        doc(db, "users", uid),
        {
          current_rate: cr,
          lifetime_total_rate: lt,
          rating: cr,
          gold: Math.max(0, g),
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
  }, [seasonDraft, lifetimeDraft, goldDraft]);

  if (!showAdminTools) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 left-4 z-[200] rounded-lg border border-rose-500/50 bg-rose-950/95 px-2.5 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wide text-rose-100 shadow-lg shadow-black/40 backdrop-blur-sm hover:border-rose-400/70 hover:bg-rose-900/95"
        title="管理者モード有効時のみ表示（DBG）"
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
                デバッグ（管理者モード）
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
              自分の Firestore ユーザーを直接書き換えます。管理者モードと
              localhost で表示されます。
            </p>

            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="text-xs text-white/60">
                  シーズンレート（current_rate）
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={seasonDraft}
                  onChange={(e) => setSeasonDraft(e.target.value)}
                  disabled={loadingDoc}
                  className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm tabular-nums text-white outline-none focus:border-rose-400/50"
                />
              </label>
              <label className="block">
                <span className="text-xs text-white/60">
                  累計レート（lifetime_total_rate）
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={lifetimeDraft}
                  onChange={(e) => setLifetimeDraft(e.target.value)}
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
