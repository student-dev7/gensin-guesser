/** character_stats のドキュメントID（キャラ名を安全にキー化） */
export function characterStatsDocId(characterName: string): string {
  return encodeURIComponent(characterName);
}

/**
 * データが無いときの参照用（フォールバック表示など）。
 * レート計算の平均は bayesianMeanHands を使用（事前分布 5.0×10 相当）。
 */
export const DEFAULT_AVG_HANDS = 5;

/**
 * ベイズ風の平均手数: (totalHandCount + 50) / (totalWins + 10)
 * データなし (0,0) では (0+50)/(0+10) = 5.0（事前 5 手 × 10 勝分）。
 */
export function bayesianMeanHands(
  totalHandCount: number,
  totalWins: number
): number {
  return (totalHandCount + 50) / (totalWins + 10);
}

/** 統計に加算する「正解」は 2 手以上に限定 */
export const MIN_HANDS_FOR_STATS = 2;
