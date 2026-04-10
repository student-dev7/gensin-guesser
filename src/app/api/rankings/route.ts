import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { NextResponse } from "next/server";
import { getPublicFirestore } from "@/lib/firebasePublicFirestore";

/** 任意クライアント向け: ランキング（Firestore ルールで users の read が許可されていること） */
export async function GET(req: Request) {
  const db = getPublicFirestore();
  const url = new URL(req.url);
  const limitRaw = url.searchParams.get("limit");
  const lim = Math.max(
    1,
    Math.min(100, Number(limitRaw ?? "50") || 50)
  );

  const q = query(
    collection(db, "users"),
    orderBy("rating", "desc"),
    limit(lim)
  );
  const snap = await getDocs(q);

  const players = snap.docs.map((d) => {
    const data = d.data() as {
      rating?: unknown;
      games?: unknown;
      displayName?: unknown;
      updatedAt?: unknown;
    };
    return {
      playerId: d.id,
      displayName:
        typeof data.displayName === "string" && data.displayName.trim()
          ? data.displayName
          : `GenshinUser_${d.id.slice(0, 8)}`,
      rating: typeof data.rating === "number" ? data.rating : 0,
      games: typeof data.games === "number" ? data.games : 0,
      updatedAt: data.updatedAt ?? null,
    };
  });

  return NextResponse.json({ ok: true, players });
}
