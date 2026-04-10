"use client";

import Link from "next/link";
import { useEffect } from "react";
import { GoldCoinIcon } from "@/components/GoldCoinIcon";
import { logAnalyticsEvent } from "@/lib/firebaseAnalytics";

export function ShopClient() {
  useEffect(() => {
    void logAnalyticsEvent("view_shop", { page: "/shop" });
  }, []);

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
          <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-white/55">
            ゴールドでアイコン枠やアイコンなどを購入できる予定です。現在は準備中です。
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

        <div className="rounded-2xl border border-[#ece5d8]/20 bg-[#0d1324]/95 px-6 py-10 text-center text-sm text-white/50">
          Coming soon
        </div>
      </div>
    </div>
  );
}
