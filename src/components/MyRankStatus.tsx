"use client";

import Image from "next/image";
import { useState } from "react";
import { RankDetailModal } from "@/components/RankDetailModal";
import { DEFAULT_INITIAL_RATING } from "@/lib/elo";
import {
  getDisplayRating,
  getRankAccentHex,
  getRankData,
  getRankLogoContentScale,
} from "@/lib/rankUtils";

type Props = {
  /** 今週のレート（Firestore） */
  weeklyRating: number | null;
  /** 到達済み最高レート（未設定時は null） */
  peakRating: number | null;
  loading: boolean;
};

export function MyRankStatus(props: Props) {
  const { weeklyRating, peakRating, loading } = props;
  const [modalOpen, setModalOpen] = useState(false);
  const [logoOk, setLogoOk] = useState(true);

  const displayRate =
    weeklyRating == null
      ? DEFAULT_INITIAL_RATING
      : getDisplayRating(weeklyRating, peakRating);

  const data = getRankData(displayRate);
  const accent = getRankAccentHex(data.rankId);
  const logoScale = getRankLogoContentScale(data.rankId);

  const tierLine =
    data.tierRoman != null
      ? `${data.rankName} ${data.tierRoman}`
      : data.rankName;

  return (
    <>
      <section className="flex shrink-0 flex-col items-center" aria-label="マイランク">
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="group flex shrink-0 flex-col items-center gap-1 rounded-xl border border-transparent bg-transparent py-0.5 outline-none transition hover:border-[#ece5d8]/20 focus-visible:ring-2 focus-visible:ring-[#ece5d8]/40"
          aria-haspopup="dialog"
          aria-expanded={modalOpen}
          aria-label={
            loading
              ? "ランク読み込み中（タップで詳細）"
              : `ランク詳細を開く（${tierLine}）`
          }
        >
          <div
            className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-[#ece5d8]/25 bg-[#12182a]/90 shadow-md shadow-black/30 transition group-hover:border-[#ece5d8]/45 group-hover:shadow-lg sm:h-14 sm:w-14"
            style={{ boxShadow: `inset 0 0 0 1px ${accent}40` }}
          >
            {loading ? (
              <div className="h-full w-full animate-pulse bg-[#1a2238]" />
            ) : logoOk ? (
              <span
                className="absolute inset-0 flex items-center justify-center"
                style={{
                  transform: `scale(${logoScale})`,
                  transformOrigin: "center center",
                }}
              >
                <Image
                  src={data.imagePath}
                  alt=""
                  fill
                  className="object-contain p-0.5"
                  onError={() => setLogoOk(false)}
                />
              </span>
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[0.55rem] font-bold leading-none text-white/70">
                {data.rankName.slice(0, 1)}
              </div>
            )}
          </div>
          <span className="select-none text-[0.62rem] font-medium tracking-wide text-[#ece5d8]/65 sm:text-[0.65rem]">
            ランク
          </span>
        </button>
      </section>

      <RankDetailModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        displayRating={displayRate}
        weeklyRating={weeklyRating}
      />
    </>
  );
}
