import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  type Firestore,
} from "firebase/firestore";
import { DEFAULT_INITIAL_RATING, parseSeasonRateField } from "@/lib/rating";

/** `/ranking` ページと `/api/rankings` の既定の上位件数 */
export const DEFAULT_LEADERBOARD_TOP_N = 30;

/**
 * Firestore `users` 上の並び替え用フィールド（実効シーズンレートと同じ数値を書き込む）。
 * `orderBy(leaderboard_rating).limit(N)` で全件スキャン不要。
 */
export const USER_FIELD_LEADERBOARD_RATING = "leaderboard_rating" as const;

/**
 * `rating` / `current_rate` / `leaderboard_rating` の欠損や食い違いに耐える実効シーズンレート。
 * 複数あるときは大きい方（文字列の数値・片方のみでも評価できる）。
 */
export function effectiveSeasonRateFromUserData(
  data: Record<string, unknown>
): number {
  const a = parseSeasonRateField(data.rating);
  const b = parseSeasonRateField(data.current_rate);
  const c = parseSeasonRateField(data[USER_FIELD_LEADERBOARD_RATING]);
  const parts = [a, b, c].filter((n): n is number => n != null);
  if (parts.length === 0) return DEFAULT_INITIAL_RATING;
  return Math.max(...parts);
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
    const rating = effectiveSeasonRateFromUserData(data);
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
