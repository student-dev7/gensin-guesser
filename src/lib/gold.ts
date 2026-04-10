/** レート増分 1 につき付与するゴールド（将来ショップと連動） */
export const GOLD_PER_RATING_POINT = 10;

/**
 * レート増分に応じたゴールド。減少時は 0（マイナスは付与しない）。
 */
export function goldEarnedFromRatingDelta(ratingDelta: number): number {
  if (!Number.isFinite(ratingDelta) || ratingDelta <= 0) return 0;
  return Math.round(ratingDelta * GOLD_PER_RATING_POINT);
}
