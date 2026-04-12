import type { Metadata } from "next";
import { getPublicFirestore } from "@/lib/firebasePublicFirestore";
import { fetchSeasonLeaderboard } from "@/lib/seasonLeaderboard";
import { RankingTable, type RankRow } from "./RankingTable";

export const metadata: Metadata = {
  title: "レーティングランキング",
  description:
    "原神ゲッサーのレーティングランキング。プレイヤー順位と対戦数を表示します。",
  alternates: {
    canonical: "/ranking",
  },
};

export const dynamic = "force-dynamic";

async function loadRanking(): Promise<RankRow[]> {
  const db = getPublicFirestore();
  const rows = await fetchSeasonLeaderboard(db, 50);
  return rows.map((r) => ({
    uid: r.uid,
    rank: r.rank,
    displayName: r.displayName,
    rating: r.rating,
    games: r.games,
  }));
}

export default async function RankingPage() {
  let rows: RankRow[] = [];
  let error: string | null = null;

  try {
    rows = await loadRanking();
  } catch (e: unknown) {
    error = e instanceof Error ? e.message : String(e);
  }

  return <RankingTable rows={rows} error={error} />;
}
