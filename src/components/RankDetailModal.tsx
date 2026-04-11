"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { RankEmblemByRankId } from "@/components/RankLogoMark";
import {
  getRankAccentHex,
  getRankData,
  getRankLogoContentScale,
  getRankRangeTableRows,
  getTierProgress,
} from "@/lib/rankUtils";

type Props = {
  open: boolean;
  onClose: () => void;
  /** 永続表示用レート（週次と peak の高い方） */
  displayRating: number;
  /** 今週のレート */
  weeklyRating: number | null;
};

export function RankDetailModal(props: Props) {
  const { open, onClose, displayRating, weeklyRating } = props;
  const [logoOk, setLogoOk] = useState(true);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const data = getRankData(displayRating);
  const tier = getTierProgress(displayRating);
  const accent = getRankAccentHex(data.rankId);
  const logoContentScale = getRankLogoContentScale(data.rankId);
  const rows = getRankRangeTableRows();

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rank-modal-heading"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[min(90vh,720px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[#ece5d8]/25 bg-[#12182a] shadow-2xl shadow-black/50">
        <div className="relative z-30 flex shrink-0 items-center justify-between gap-3 border-b border-[#ece5d8]/10 bg-[#12182a] px-4 py-3 sm:px-6">
          <h2
            id="rank-modal-heading"
            className="text-lg font-semibold text-[#ece5d8]"
          >
            ランク詳細
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-xl leading-none text-[#ece5d8]/90 transition hover:bg-white/10 hover:text-white"
            aria-label="閉じる"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4 pt-4 sm:px-6">
          <div className="space-y-6 text-left">
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

            <section>
              <p className="text-[0.7rem] font-medium tracking-wide text-white/45">
                ポイント状況
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-white/80">
                {tier.isFinal ? (
                  <span className="text-white/65">
                    最終ランクのため、これ以上の昇格はありません。
                  </span>
                ) : (
                  <>
                    昇格まであと{" "}
                    <span className="font-semibold tabular-nums text-[#ece5d8]">
                      {tier.pointsToNext}
                    </span>{" "}
                    ポイント
                  </>
                )}
              </p>
            </section>

            <div className="flex flex-col items-center gap-3 border-y border-[#ece5d8]/10 py-6 text-center">
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
                  表示レート: {Math.round(displayRating)}
                </p>
                {weeklyRating != null && (
                  <p className="mt-1 text-xs tabular-nums text-white/45">
                    今週のレート: {Math.round(weeklyRating)}
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
                  レート帯ごとにランクがあり、各ランク内は{" "}
                  <span className="tabular-nums text-white/80">IV→III→II→I</span>{" "}
                  の順で上のティアへ昇格します。
                </li>
                <li>
                  レートが次のティア（または次のランク帯）の下限に達すると、表示がひとつ上の段階に進みます。
                </li>
                <li>
                  到達した最高ランクは、週次でレートが下がっても{" "}
                  <span className="text-amber-200/90">表示上は降格しません</span>
                  （永続ランク）。
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
              このランクは永続です。一度到達したランクから降格することはありません。
            </p>
          </div>
        </div>

        <div className="shrink-0 border-t border-[#ece5d8]/10 bg-[#0f1528]/95 px-5 py-4 sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl border border-[#ece5d8]/35 bg-[#ece5d8]/10 py-3 text-sm font-semibold text-[#ece5d8] transition hover:border-[#ece5d8]/50 hover:bg-[#ece5d8]/16"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
