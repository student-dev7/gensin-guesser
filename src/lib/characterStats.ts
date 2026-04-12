/** character_stats のドキュメントID（キャラ名を安全にキー化） */
export function characterStatsDocId(characterName: string): string {
  return encodeURIComponent(characterName);
}

/**
 * データが無いときの参照用（フォールバック表示・レート計算の平均が未初期のとき）。
 */
export const DEFAULT_AVG_HANDS = 5;

/**
 * キャラ別の平均手数（単純平均）。
 * - totalHandCount: 集計した各プレイの手数の合計（勝ち・負け・降参・ゴースト敗北などすべて）
 * - totalPlays: Firestore では従来どおり `totalWins` フィールド名で保持（「試行回数」）
 */
export function pureMeanHandCount(
  totalHandCount: number,
  totalPlays: number
): number {
  if (
    totalPlays <= 0 ||
    !Number.isFinite(totalHandCount) ||
    !Number.isFinite(totalPlays)
  ) {
    return DEFAULT_AVG_HANDS;
  }
  return totalHandCount / totalPlays;
}
