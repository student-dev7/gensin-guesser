import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  type Firestore,
} from "firebase/firestore";
import { clampRating, DEFAULT_INITIAL_RATING } from "@/lib/rating";

/** `/ranking` ページと `/api/rankings` の既定の上位件数 */
export const DEFAULT_LEADERBOARD_TOP_N = 30;

/**
 * Firestore `users` 上の並び替え用フィールド（実効シーズンレートと同じ数値を書き込む）。
 * `orderBy(leaderboard_rating).limit(N)` で全件スキャン不要。
 */
export const USER_FIELD_LEADERBOARD_RATING = "leaderboard_rating" as const;

/**
 * `rating` / `current_rate` の欠損や食い違いに耐える実効シーズンレート。
 * 両方あるときは大きい方（どちらか片方だけ欠けていても他方で評価できる）。
 */
export function effectiveSeasonRateFromUserData(
  data: Record<string, unknown>
): number {
  const r = data.rating;
  const cr = data.current_rate;
  const a =
    typeof r === "number" && Number.isFinite(r) ? clampRating(r) : null;
  const b =
    typeof cr === "number" && Number.isFinite(cr) ? clampRating(cr) : null;
  if (a != null && b != null) return Math.max(a, b);
  if (a != null) return a;
  if (b != null) return b;
  return DEFAULT_INITIAL_RATING;
}

export type SeasonLeaderboardRow = {
  uid: string;
  rank: number;
  displayName: string;
  /** 表示・並び替え用（`leaderboard_rating` と一致） */
  rating: number;
  games: number;
  updatedAt?: unknown;
};

/**
 * `leaderboard_rating` 降順で上位 topN 件のみ取得（読み取り ≒ topN）。
 * 既存ユーザーには一度 `scripts/backfill-leaderboard-rating.mjs` が必要。
 */
export async function fetchSeasonLeaderboard(
  db: Firestore,
  topN: number
): Promise<SeasonLeaderboardRow[]> {
  const capped = Math.max(1, Math.min(100, Math.floor(topN)));
  const q = query(
    collection(db, "users"),
    orderBy(USER_FIELD_LEADERBOARD_RATING, "desc"),
    limit(capped)
  );
  const snap = await getDocs(q);

  let rank = 1;
  const rows: SeasonLeaderboardRow[] = [];

  for (const d of snap.docs) {
    const data = d.data() as Record<string, unknown>;
    const raw = data[USER_FIELD_LEADERBOARD_RATING];
    const rating =
      typeof raw === "number" && Number.isFinite(raw)
        ? clampRating(raw)
        : effectiveSeasonRateFromUserData(data);
    const games =
      typeof data.games === "number" && Number.isFinite(data.games)
        ? data.games
        : 0;
    const displayName =
      typeof data.displayName === "string" && data.displayName.trim()
        ? data.displayName
        : `GenshinUser_${d.id.slice(0, 8)}`;
    rows.push({
      uid: d.id,
      rank: rank++,
      displayName,
      rating,
      games,
      updatedAt: data.updatedAt ?? null,
    });
  }

  return rows;
}
