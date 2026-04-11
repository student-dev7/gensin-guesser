"use client";

import Image from "next/image";
import { useState } from "react";
import { RankEmblemByRankId } from "@/components/RankLogoMark";
import {
  getRankAccentHex,
  getRankData,
  getRankLogoContentScale,
  getRankRangeTableRows,
  getTierBarFromLifetimeRate,
} from "@/lib/rankUtils";

type Props = {
  rankDisplayRating: number;
  seasonRating: number | null;
};

/**
 * ランク詳細の本文（全画面ページ用）。累計レート・シーズンレートは呼び出し元で用意する。
 */
export function RankDetailView(props: Props) {
  const { rankDisplayRating, seasonRating } = props;
  const [logoOk, setLogoOk] = useState(true);

  const data = getRankData(rankDisplayRating);
  const tierBar = getTierBarFromLifetimeRate(rankDisplayRating);
  const accent = getRankAccentHex(data.rankId);
  const logoContentScale = getRankLogoContentScale(data.rankId);
  const rows = getRankRangeTableRows();

  return (
    <div className="space-y-8 text-left">
      <section>
        <p className="text-[0.7rem] font-medium tracking-wide text-white/45">
          現在のランク
        </p>
        <p className="mt-1.5 text-lg font-medium leading-snug tracking-tight text-[#ece5d8] sm:text-xl">
          {data.rankName}
        </p>
      </section>

      {data.tierRoman != null && (
        <section>
          <p className="text-[0.7rem] font-medium tracking-wide text-white/45">
            現在のティア
          </p>
          <p className="mt-1.5 font-mono text-2xl font-medium tabular-nums tracking-tight text-white/90 sm:text-[1.65rem]">
            {data.tierRoman}
          </p>
        </section>
      )}

      <section className="space-y-4">
        <p className="text-[0.7rem] font-medium tracking-wide text-white/45">
          ポイント状況
        </p>

        {tierBar.isFinal ? (
          <p className="text-sm leading-relaxed text-white/65">
            最終ランクのため、これ以上の昇格はありません。
          </p>
        ) : (
          <>
            <p className="text-base leading-relaxed text-white/90 sm:text-lg">
              昇格まであと{" "}
              <span className="font-semibold tabular-nums text-[#ece5d8]">
                {tierBar.pointsToNext}
              </span>{" "}
              ポイント（累計レートベース）
            </p>

            <div className="rounded-xl border border-[#ece5d8]/12 bg-[#0d1324]/80 px-3.5 py-3 sm:px-4">
              <div className="flex items-center justify-between gap-3 text-xs sm:text-sm">
                <span className="font-medium text-[#ece5d8]/75">
                  現在のティア内の進捗
                </span>
                <span className="shrink-0 tabular-nums font-semibold text-[#ece5d8]">
                  {tierBar.progressInTier} / {tierBar.tierSpan}
                </span>
              </div>
              <div
                className="mt-2.5 h-2.5 w-full overflow-hidden rounded-full bg-[#0a0f1e] shadow-inner shadow-black/40 ring-1 ring-[#ece5d8]/12"
                role="progressbar"
                aria-valuenow={tierBar.progressInTier}
                aria-valuemin={0}
                aria-valuemax={tierBar.tierSpan}
                aria-label="ティア内の進捗"
              >
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-600/90 via-emerald-500/85 to-amber-400/80 shadow-[0_0_12px_-2px_rgba(52,211,153,0.45)] transition-[width] duration-300"
                  style={{
                    width: `${Math.round(tierBar.fillRatio * 100)}%`,
                    boxShadow: `inset 0 0 0 1px ${accent}44`,
                  }}
                />
              </div>
            </div>
          </>
        )}
      </section>

      <div className="flex flex-col items-center gap-3 border-y border-[#ece5d8]/10 py-8 text-center">
        <div
          className="relative h-20 w-20 overflow-hidden rounded-2xl sm:h-24 sm:w-24"
          style={{
            boxShadow: `0 0 0 2px ${accent}55, 0 12px 40px -16px ${accent}66`,
          }}
        >
          {logoOk ? (
            <span
              className="absolute inset-0 flex items-center justify-center"
              style={{
                transform: `scale(${logoContentScale})`,
                transformOrigin: "center center",
              }}
            >
              <Image
                src={data.imagePath}
                alt=""
                fill
                className="object-contain p-1"
                onError={() => setLogoOk(false)}
              />
            </span>
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-[#0a0f1e] text-xs font-bold text-white/70">
              {data.rankName}
            </div>
          )}
        </div>
        <div className="w-full">
          <p className="text-sm tabular-nums text-[#ece5d8]/90">
            累計レート: {Math.round(rankDisplayRating)}
          </p>
          {seasonRating != null && (
            <p className="mt-1 text-xs tabular-nums text-white/45">
              シーズンレート: {Math.round(seasonRating)}
            </p>
          )}
        </div>
      </div>

      <section>
        <p className="text-[0.7rem] font-medium tracking-wide text-[#ece5d8]/70">
          ランクルール
        </p>
        <ul className="mt-2.5 list-disc space-y-1.5 pl-4 text-[0.8125rem] leading-relaxed text-white/65 marker:text-white/35">
          <li>
            <span className="font-medium text-white/80">累計レート</span>
            （試合の増減を積み上げた値）でランク帯が決まります。各帯内は{" "}
            <span className="tabular-nums text-white/80">IV→III→II→I</span>{" "}
            の順で上のティアへ昇格します。
          </li>
          <li>
            シーズン用のレートは毎週リセットされますが、累計レートは{" "}
            <span className="text-amber-200/90">リセットされません</span>。
          </li>
          <li>
            「あと◯ポイント」は累計レートから算出します。シーズンレートは対戦計算用で、ランク表示には使いません。
          </li>
          <li>
            ティア内の進捗は累計レートのみから計算します（ウォリアーは 1
            ティアあたり幅 30）。ランク帯ごとに幅は異なります。
          </li>
        </ul>
      </section>

      <section>
        <p className="text-xs font-semibold uppercase tracking-wider text-[#ece5d8]/75">
          全ランク一覧
        </p>
        <div className="mt-3 overflow-hidden rounded-xl border border-[#ece5d8]/15">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[#ece5d8]/10 bg-[#0d1324]/90 text-xs text-[#ece5d8]/80">
                <th className="px-3 py-2 font-semibold sm:px-4">ランク</th>
                <th className="px-3 py-2 text-right font-semibold sm:px-4">
                  必要レート
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#ece5d8]/10">
              {rows.map((r) => (
                <tr key={r.rankId} className="hover:bg-white/[0.03]">
                  <td className="px-3 py-3 sm:px-4">
                    <div className="flex items-center gap-3">
                      <RankEmblemByRankId
                        rankId={r.rankId}
                        sizePx={70}
                        label={r.rankName}
                      />
                      <span className="font-medium text-white/90">
                        {r.rankName}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-white/60 sm:px-4">
                    {r.rangeLabel}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="rounded-xl border border-amber-400/25 bg-amber-950/25 px-3 py-2.5 text-xs leading-relaxed text-amber-100/85">
        累計レートが下がればランク表示も下がり得ます。週次リセットで下がるのはシーズンレートだけです。
      </p>
    </div>
  );
}
