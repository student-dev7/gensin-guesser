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
 * ベイズ風の平均手数: (totalHandCount + 50) / (totalSampleRounds + 10)
 * totalHandCount: 集計に含めた各プレイの手数の合計（勝ち・負けの両方）
 * totalSampleRounds: 上記プレイの回数（Firestore では totalWins フィールド名のまま）
 * データなし (0,0) では (0+50)/(0+10) = 5.0（事前 5 手 × 10 回分）。
 */
export function bayesianMeanHands(
  totalHandCount: number,
  totalSampleRounds: number
): number {
  return (totalHandCount + 50) / (totalSampleRounds + 10);
}

/** 統計に加算する「正解」はこの手数以上。負けは常に対象（実際の予想回数で加算） */
export const MIN_HANDS_FOR_STATS = 2;
