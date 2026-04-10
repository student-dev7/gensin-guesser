import type { Metadata } from "next";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { getPublicFirestore } from "@/lib/firebasePublicFirestore";
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
  const q = query(
    collection(db, "users"),
    orderBy("rating", "desc"),
    limit(50)
  );
  const snap = await getDocs(q);

  return snap.docs.map((d, i) => {
    const data = d.data() as {
      rating?: unknown;
      games?: unknown;
      displayName?: unknown;
    };
    const rating =
      typeof data.rating === "number" && Number.isFinite(data.rating)
        ? data.rating
        : 0;
    const games =
      typeof data.games === "number" && Number.isFinite(data.games)
        ? data.games
        : 0;
    const displayName =
      typeof data.displayName === "string" && data.displayName.trim()
        ? data.displayName
        : `GenshinUser_${d.id.slice(0, 8)}`;

    return {
      uid: d.id,
      rank: i + 1,
      displayName,
      rating,
      games,
    };
  });
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
