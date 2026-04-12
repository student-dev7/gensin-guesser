import { NextResponse } from "next/server";
import { getPublicFirestore } from "@/lib/firebasePublicFirestore";
import { fetchSeasonLeaderboard } from "@/lib/seasonLeaderboard";

/** 任意クライアント向け: ランキング（Firestore ルールで users の read が許可されていること） */
export async function GET(req: Request) {
  const db = getPublicFirestore();
  const url = new URL(req.url);
  const limitRaw = url.searchParams.get("limit");
  const lim = Math.max(
    1,
    Math.min(100, Number(limitRaw ?? "50") || 50)
  );

  const rows = await fetchSeasonLeaderboard(db, lim);

  const players = rows.map((r) => ({
    playerId: r.uid,
    displayName: r.displayName,
    rating: r.rating,
    games: r.games,
    updatedAt: r.updatedAt ?? null,
  }));

  return NextResponse.json({ ok: true, players });
}
