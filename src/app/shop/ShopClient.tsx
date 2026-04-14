"use client";

import Link from "next/link";
import { doc, getDoc } from "firebase/firestore";
import { useCallback, useEffect, useState } from "react";
import { GoldCoinIcon } from "@/components/GoldCoinIcon";
import {
  ensureAnonymousSession,
  getFirebaseAuth,
  getFirebaseFirestore,
} from "@/lib/firebaseClient";
import { logAnalyticsEvent } from "@/lib/firebaseAnalytics";
import {
  NEXT_WIN_RATING_DOUBLE_COST_GOLD,
  USER_FIELD_NEXT_WIN_RATING_DOUBLE,
} from "@/lib/shop";

export function ShopClient() {
  const [gold, setGold] = useState<number | null>(null);
  const [hasNextWinDouble, setHasNextWinDouble] = useState(false);
  const [loading, setLoading] = useState(true);
  const [purchaseLoading, setPurchaseLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const cost = NEXT_WIN_RATING_DOUBLE_COST_GOLD;

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      await ensureAnonymousSession();
      const auth = getFirebaseAuth();
      const uid = auth.currentUser?.uid;
      if (!uid) {
        setGold(0);
        setHasNextWinDouble(false);
        return;
      }
      const db = getFirebaseFirestore();
      const snap = await getDoc(doc(db, "users", uid));
      if (!snap.exists()) {
        setGold(0);
        setHasNextWinDouble(false);
        return;
      }
      const d = snap.data();
      const g =
        typeof d?.gold === "number" && Number.isFinite(d.gold) ? d.gold : 0;
      setGold(g);
      setHasNextWinDouble(d?.[USER_FIELD_NEXT_WIN_RATING_DOUBLE] === true);
    } catch {
      setGold(0);
      setHasNextWinDouble(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void logAnalyticsEvent("view_shop", { page: "/shop" });
  }, []);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const canAfford = gold !== null && gold >= cost;
  const buyDisabled =
    loading ||
    purchaseLoading ||
    !canAfford ||
    hasNextWinDouble ||
    gold === null;

  return (
    <div className="min-h-screen bg-[#0a0f1e] px-4 py-12 text-white">
      <div className="mx-auto w-full max-w-lg">
        <header className="mb-10 text-center">
          <p className="text-xs font-medium uppercase tracking-[0.35em] text-[#ece5d8]/80">
            GenshinGuesser
          </p>
          <h1 className="mt-3 flex items-center justify-center gap-2 text-3xl font-semibold tracking-tight text-[#ece5d8] sm:text-4xl">
            <GoldCoinIcon className="h-9 w-9 text-amber-300 sm:h-10 sm:w-10" />
            ショップ
          </h1>
          <p className="mx-auto mt-4 flex items-center justify-center gap-2 text-sm text-white/70">
            <span>所持ゴールド</span>
            <GoldCoinIcon className="h-4 w-4 text-amber-200/90" />
            <span className="tabular-nums font-medium text-amber-100/95">
              {loading ? "…" : (gold ?? 0).toLocaleString("ja-JP")}
            </span>
          </p>
          <div className="mt-8">
            <Link
              href="/"
              prefetch={false}
              className="inline-flex items-center justify-center rounded-full border border-[#ece5d8]/35 bg-[#12182a] px-6 py-2.5 text-sm font-medium text-[#ece5d8] shadow-[0_0_24px_-8px_rgba(236,229,216,0.25)] transition hover:border-[#ece5d8]/55 hover:bg-[#1a2238]"
            >
              ← トップへ戻る
            </Link>
          </div>
        </header>

        <div className="space-y-4">
          <div className="rounded-2xl border border-amber-500/25 bg-[#0d1324]/95 px-5 py-5 shadow-[0_20px_50px_-24px_rgba(0,0,0,0.55)]">
            <div className="flex items-start gap-3">
              <GoldCoinIcon className="mt-0.5 h-8 w-8 shrink-0 text-amber-300" />
              <div className="min-w-0 text-left">
                <h2 className="text-base font-semibold text-[#ece5d8]">
                  次回勝利：レート増分 2 倍
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-white/60">
                  対戦モードで次に正解したときだけ、シーズンレートの増分（基礎＋速度＋ゴースト差の合計）が{" "}
                  <span className="font-medium text-amber-200/95">2 倍</span>
                  になります。負けた場合はバフは消えません。
                </p>
                <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-white/55">
                  <span>価格</span>
                  <span className="inline-flex items-center gap-1 tabular-nums text-amber-100/95">
                    <GoldCoinIcon className="h-4 w-4" />
                    {cost.toLocaleString("ja-JP")}
                  </span>
                </p>
                {hasNextWinDouble && (
                  <p className="mt-3 rounded-lg border border-emerald-500/35 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-100/90">
                    購入済みです。次の対戦モード勝利まで有効です。
                  </p>
                )}
                {message && (
                  <p className="mt-3 text-sm text-rose-400">{message}</p>
                )}
                <button
                  type="button"
                  disabled={buyDisabled}
                  onClick={async () => {
                    setMessage(null);
                    setPurchaseLoading(true);
                    try {
                      await ensureAnonymousSession();
                      const auth = getFirebaseAuth();
                      const idToken = await auth.currentUser?.getIdToken();
                      if (!idToken) {
                        setMessage("ログインが必要です");
                        return;
                      }
                      const res = await fetch(
                        "/api/shop/purchase-next-win-rating-double",
                        {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ idToken }),
                        }
                      );
                      const json = (await res.json()) as {
                        ok?: boolean;
                        error?: string;
                        gold?: number;
                      };
                      if (!json?.ok) {
                        setMessage(json?.error ?? "購入に失敗しました");
                        return;
                      }
                      if (typeof json.gold === "number") {
                        setGold(json.gold);
                      }
                      setHasNextWinDouble(true);
                    } catch (e: unknown) {
                      setMessage(
                        e instanceof Error ? e.message : String(e)
                      );
                    } finally {
                      setPurchaseLoading(false);
                    }
                  }}
                  className="mt-4 w-full rounded-xl border border-amber-500/45 bg-gradient-to-r from-amber-950/50 to-amber-900/35 px-4 py-3 text-sm font-semibold text-amber-100 transition hover:border-amber-400/60 hover:from-amber-900/55 hover:to-amber-800/40 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {purchaseLoading
                    ? "処理中…"
                    : hasNextWinDouble
                      ? "所持中"
                      : `購入する（${cost.toLocaleString("ja-JP")} G）`}
                </button>
              </div>
            </div>
          </div>

          <p className="text-center text-xs text-white/35">
            その他のアイテムは準備中です。
          </p>
        </div>
      </div>
    </div>
  );
}
