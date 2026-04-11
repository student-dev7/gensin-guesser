"use client";

import Image from "next/image";
import { memo, useState } from "react";
import {
  getRankAccentHex,
  getRankData,
  type RomanTier,
} from "@/lib/rankUtils";

export type RankBadgeProps = {
  rating: number;
  size?: "sm" | "md";
  /** アクセント（枠線など）を付ける */
  showAccentRing?: boolean;
  /** false のとき数値は非表示（一覧でレート列と重複させない） */
  showRatingText?: boolean;
  className?: string;
};

function tierLabel(tier: RomanTier | null): string {
  if (tier == null) return "";
  return ` ${tier}`;
}

function RankBadgeInner(props: RankBadgeProps) {
  const {
    rating,
    size = "sm",
    showAccentRing = true,
    showRatingText = true,
    className = "",
  } = props;
  const data = getRankData(rating);
  const accent = getRankAccentHex(data.rankId);
  const dim = size === "md" ? 40 : 28;
  const [imgOk, setImgOk] = useState(true);

  const title = `${data.rankName}${tierLabel(data.tierRoman)}`;

  return (
    <span
      className={`inline-flex items-center gap-2 ${className}`.trim()}
      title={title}
    >
      <span
        className="relative shrink-0 overflow-hidden rounded-lg"
        style={{
          boxShadow: showAccentRing
            ? `0 0 0 2px ${accent}55, 0 4px 14px -4px ${accent}44`
            : undefined,
        }}
      >
        {imgOk ? (
          <Image
            src={data.imagePath}
            alt=""
            width={dim}
            height={dim}
            className={
              size === "md"
                ? "h-10 w-10 bg-[#12182a]/90 object-contain"
                : "h-7 w-7 bg-[#12182a]/90 object-contain"
            }
            onError={() => setImgOk(false)}
          />
        ) : (
          <span
            className="flex items-center justify-center bg-[#12182a]/95 px-0.5 text-center text-[0.6rem] font-bold leading-none text-white/85"
            style={{ width: dim, height: dim }}
            aria-hidden
          >
            {data.rankName.slice(0, 2)}
          </span>
        )}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold leading-tight text-[#ece5d8] sm:text-sm">
          {data.rankName}
          {data.tierRoman != null && (
            <span className="text-white/75"> {data.tierRoman}</span>
          )}
        </span>
        {showRatingText && (
          <span className="mt-0.5 block text-[0.65rem] tabular-nums text-white/45 sm:text-xs">
            {Math.round(rating)}
          </span>
        )}
      </span>
    </span>
  );
}

export const RankBadge = memo(RankBadgeInner);
