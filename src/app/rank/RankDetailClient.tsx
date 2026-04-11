"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { doc, getDoc, getFirestore } from "firebase/firestore";
import { RankDetailView } from "@/components/RankDetailView";
import { DEFAULT_INITIAL_RATING } from "@/lib/elo";
import { logAnalyticsEvent } from "@/lib/firebaseAnalytics";
import {
  ensureAnonymousSession,
  getFirebaseAuth,
} from "@/lib/firebaseClient";
import { rateForRankDisplay } from "@/lib/rankUtils";

export function RankDetailClient() {
  const [seasonRating, setSeasonRating] = useState<number | null>(null);
  const [lifetimeTotalRate, setLifetimeTotalRate] = useState<number | null>(
    null
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void logAnalyticsEvent("view_rank_detail", { page: "/rank" });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        await ensureAnonymousSession();
        const auth = getFirebaseAuth();
        const uid = auth.currentUser?.uid;
        if (!uid) {
          if (!cancelled) {
            setSeasonRating(DEFAULT_INITIAL_RATING);
            setLifetimeTotalRate(DEFAULT_INITIAL_RATING);
            setLoading(false);
          }
          return;
        }
        const db = getFirestore(auth.app);
        const snap = await getDoc(doc(db, "users", uid));
        if (!snap.exists()) {
          if (!cancelled) {
            setSeasonRating(DEFAULT_INITIAL_RATING);
            setLifetimeTotalRate(DEFAULT_INITIAL_RATING);
            setLoading(false);
          }
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
        if (!cancelled) {
          setSeasonRating(season);
          setLifetimeTotalRate(lifetime);
        }
      } catch {
        if (!cancelled) {
          setSeasonRating(DEFAULT_INITIAL_RATING);
          setLifetimeTotalRate(DEFAULT_INITIAL_RATING);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const rankRate = rateForRankDisplay(lifetimeTotalRate);

  return (
    <div className="min-h-screen bg-[#0a0f1e] px-4 py-8 text-white sm:py-12">
      <div className="mx-auto w-full max-w-lg pb-16">
        <header className="mb-10 text-center">
          <p className="text-xs font-medium uppercase tracking-[0.35em] text-[#ece5d8]/80">
            GenshinGuesser
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[#ece5d8] sm:text-4xl">
            ランク詳細
          </h1>
          <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-white/55">
            累計レートに基づくランク・ティア・昇格までのポイントを表示します。
          </p>
          <div className="mt-8">
            <Link
              href="/"
              className="inline-flex items-center justify-center rounded-full border border-[#ece5d8]/35 bg-[#12182a] px-6 py-2.5 text-sm font-medium text-[#ece5d8] shadow-[0_0_24px_-8px_rgba(236,229,216,0.25)] transition hover:border-[#ece5d8]/55 hover:bg-[#1a2238]"
            >
              ← トップへ戻る
            </Link>
          </div>
        </header>

        {loading ? (
          <div className="rounded-2xl border border-[#ece5d8]/15 bg-[#0d1324]/80 px-6 py-16 text-center text-sm text-white/45">
            読み込み中…
          </div>
        ) : (
          <div className="rounded-2xl border border-[#ece5d8]/20 bg-[#0d1324]/90 px-5 py-8 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.5)] sm:px-8 sm:py-10">
            <RankDetailView
              rankDisplayRating={rankRate}
              seasonRating={seasonRating}
            />
          </div>
        )}
      </div>
    </div>
  );
}
