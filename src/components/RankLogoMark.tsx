"use client";

import Image from "next/image";
import { memo, useState } from "react";
import {
  getRankAccentHex,
  getRankData,
  getRankLogoContentScale,
  rankImagePath,
  type RankId,
} from "@/lib/rankUtils";

export type RankLogoMarkProps = {
  rating: number;
  /** 一辺のピクセル（正方形） */
  sizePx: number;
  className?: string;
};

function RankLogoMarkInner(props: RankLogoMarkProps) {
  const { rating, sizePx, className = "" } = props;
  const data = getRankData(rating);
  const accent = getRankAccentHex(data.rankId);
  const contentScale = getRankLogoContentScale(data.rankId);
  const [imgOk, setImgOk] = useState(true);

  return (
    <span
      className={`relative inline-block shrink-0 overflow-hidden rounded-xl bg-[#0a0f1e] ${className}`.trim()}
      style={{
        width: sizePx,
        height: sizePx,
        boxShadow: `0 0 0 2px ${accent}50, 0 6px 20px -8px ${accent}55`,
      }}
      title={`${data.rankName}${data.tierRoman != null ? ` ${data.tierRoman}` : ""}`}
    >
      {imgOk ? (
        <span
          className="flex h-full w-full items-center justify-center"
          style={{
            transform: `scale(${contentScale})`,
            transformOrigin: "center center",
          }}
        >
          <Image
            src={data.imagePath}
            alt=""
            width={sizePx}
            height={sizePx}
            className="object-contain p-[3px]"
            onError={() => setImgOk(false)}
          />
        </span>
      ) : (
        <span className="flex h-full w-full items-center justify-center text-center text-[0.55rem] font-bold leading-none text-white/75">
          {data.rankName.slice(0, 1)}
        </span>
      )}
    </span>
  );
}

export const RankLogoMark = memo(RankLogoMarkInner);

export type RankEmblemByRankIdProps = {
  rankId: RankId;
  sizePx: number;
  label: string;
  className?: string;
};

/** レートなしで rankId のみからロゴ表示（一覧表など） */
function RankEmblemByRankIdInner(props: RankEmblemByRankIdProps) {
  const { rankId, sizePx, label, className = "" } = props;
  const accent = getRankAccentHex(rankId);
  const path = rankImagePath(rankId);
  const contentScale = getRankLogoContentScale(rankId);
  const [imgOk, setImgOk] = useState(true);

  return (
    <span
      className={`relative inline-block shrink-0 overflow-hidden rounded-xl bg-[#0a0f1e] ${className}`.trim()}
      style={{
        width: sizePx,
        height: sizePx,
        boxShadow: `0 0 0 2px ${accent}45, 0 4px 16px -6px ${accent}50`,
      }}
      title={label}
    >
      {imgOk ? (
        <span
          className="flex h-full w-full items-center justify-center"
          style={{
            transform: `scale(${contentScale})`,
            transformOrigin: "center center",
          }}
        >
          <Image
            src={path}
            alt=""
            width={sizePx}
            height={sizePx}
            className="object-contain p-[3px]"
            onError={() => setImgOk(false)}
          />
        </span>
      ) : (
        <span className="flex h-full w-full items-center justify-center text-center text-[0.5rem] font-bold leading-none text-white/70">
          {label.slice(0, 1)}
        </span>
      )}
    </span>
  );
}

export const RankEmblemByRankId = memo(RankEmblemByRankIdInner);
