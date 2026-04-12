import { collection, getDocs, type Firestore } from "firebase/firestore";
import { clampRating, DEFAULT_INITIAL_RATING } from "@/lib/rating";

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
  /** 表示・並び替え用（rating / current_rate の実効値） */
  rating: number;
  games: number;
  updatedAt?: unknown;
};

/**
 * `users` を**全件**読み、実効レートでソートして上位 topN を返す。
 *
 * 以前の「rating 上位 N 件」と「current_rate 上位 N 件」をマージする方式では、
 * どちらのクエリでもトップ枠外になるとマージ集合に含まれず消える（2384→1884 でも消える）問題があった。
 * ユーザー数が数千規模までなら全件取得の方が正確（読み取りはユーザー数に比例）。
 */
export async function fetchSeasonLeaderboard(
  db: Firestore,
  topN: number
): Promise<SeasonLeaderboardRow[]> {
  const snap = await getDocs(collection(db, "users"));

  type Row = {
    uid: string;
    score: number;
    displayName: string;
    games: number;
    updatedAt: unknown;
  };

  const rows: Row[] = [];

  for (const d of snap.docs) {
    const data = d.data() as Record<string, unknown>;
    const score = effectiveSeasonRateFromUserData(data);
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
      score,
      displayName,
      games,
      updatedAt: data.updatedAt ?? null,
    });
  }

  rows.sort((a, b) => b.score - a.score);

  return rows.slice(0, topN).map((r, i) => ({
    uid: r.uid,
    rank: i + 1,
    displayName: r.displayName,
    rating: r.score,
    games: r.games,
    updatedAt: r.updatedAt,
  }));
}
