"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { RankingAvatar } from "@/components/RankingAvatar";
import { RankLogoMark } from "@/components/RankLogoMark";
import {
  ensureAnonymousSession,
  getFirebaseAuth,
} from "@/lib/firebaseClient";

export type RankRow = {
  uid: string;
  rank: number;
  displayName: string;
  rating: number;
  games: number;
};

type Props = {
  rows: RankRow[];
  error: string | null;
};

export function RankingTable({ rows, error }: Props) {
  const [myUid, setMyUid] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await ensureAnonymousSession();
        const uid = getFirebaseAuth().currentUser?.uid ?? null;
        if (!cancelled) setMyUid(uid);
      } catch {
        if (!cancelled) setMyUid(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0f1e] px-4 py-12 text-white">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-10 text-center">
          <p className="text-xs font-medium uppercase tracking-[0.35em] text-[#ece5d8]/80">
            GenshinGuesser
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[#ece5d8] sm:text-4xl">
            レートランキング
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-white/55">
            Firestore のユーザー別レート上位 50 名です。
          </p>
          <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-white/40">
            レートは日本時間で週が切り替わるたび（月曜始まり）に 1500
            へリセットされ、以降の対戦から再計算されます。
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

        <div className="overflow-hidden rounded-2xl border border-[#ece5d8]/20 bg-[#0d1324]/95 shadow-[0_25px_60px_-20px_rgba(0,0,0,0.65)] backdrop-blur-sm">
          <div className="border-b border-[#ece5d8]/15 bg-gradient-to-r from-[#0f1528] via-[#121a30] to-[#0f1528] px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium tracking-wide text-[#ece5d8]/95">
                トップ 50
              </span>
              <span className="text-xs text-white/40">rating desc</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[320px] border-collapse text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wider text-[#ece5d8]/75">
                  <th className="px-4 py-3 font-semibold sm:px-6">順位</th>
                  <th className="px-4 py-3 font-semibold sm:px-6">ユーザー</th>
                  <th className="px-4 py-3 text-right font-semibold sm:px-6">
                    レート
                  </th>
                  <th className="px-4 py-3 text-right font-semibold sm:px-6">
                    プレイ回数
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#ece5d8]/10">
                {error && (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-5 py-10 text-center text-[#ece5d8]/90 sm:px-8"
                    >
                      {error}
                    </td>
                  </tr>
                )}

                {!error && rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-5 py-12 text-center text-white/45 sm:px-8"
                    >
                      まだランキングがありません
                    </td>
                  </tr>
                )}

                {!error &&
                  rows.map((row) => {
                    const isMe =
                      typeof myUid === "string" && row.uid === myUid;
                    return (
                      <tr
                        key={row.uid}
                        className={`transition hover:bg-white/[0.04] ${
                          isMe
                            ? "bg-amber-500/10 ring-1 ring-inset ring-amber-400/25"
                            : ""
                        }`}
                      >
                        <td className="whitespace-nowrap px-4 py-3.5 font-mono sm:px-6">
                          <span
                            className={
                              row.rank === 1
                                ? "bg-gradient-to-br from-amber-200 via-yellow-300 to-amber-500 bg-clip-text text-lg font-bold text-transparent drop-shadow-[0_0_12px_rgba(251,191,36,0.35)]"
                                : row.rank === 2
                                  ? "bg-gradient-to-br from-slate-100 via-slate-200 to-slate-400 bg-clip-text text-lg font-bold text-transparent"
                                  : row.rank === 3
                                    ? "bg-gradient-to-br from-orange-300 via-amber-700 to-orange-900 bg-clip-text text-lg font-bold text-transparent"
                                    : "text-white/45"
                            }
                          >
                            {row.rank}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 sm:px-6">
                          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                            <RankingAvatar
                              uid={row.uid}
                              displayName={row.displayName}
                              size="md"
                            />
                            {row.rank <= 10 && (
                              <RankLogoMark
                                rating={row.rating}
                                sizePx={44}
                                className="shrink-0"
                              />
                            )}
                            <span className="min-w-0 font-medium text-white">
                              {row.displayName}
                              {isMe && (
                                <span className="ml-2 text-xs font-normal text-[#ece5d8]/80">
                                  （あなた）
                                </span>
                              )}
                            </span>
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3.5 text-right font-semibold tabular-nums text-[#ece5d8] sm:px-6">
                          {Math.round(row.rating)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3.5 text-right tabular-nums text-white/45 sm:px-6">
                          {row.games}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
