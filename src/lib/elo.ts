export function expectedScore(playerRating: number, characterRating: number) {
  return 1 / (1 + Math.pow(10, (characterRating - playerRating) / 400));
}

// Hand数が少ないほどSが大きくなる連続スコア（レガシー／他用途）
// S = Mavg / (My + Mavg)
export function handScoreFromAvg(myHandCount: number, mAvgHandCount: number) {
  if (myHandCount < 0) return 0;
  if (mAvgHandCount <= 0) return 0;
  const s = mAvgHandCount / (myHandCount + mAvgHandCount);
  return Math.max(0, Math.min(1, s));
}

/** プレイヤーレートの下限（週次リセット後の基準は DEFAULT_INITIAL_RATING） */
export const MIN_RATING = 1000;
/** シーズン／週次の current_rate・rating の上限 */
export const MAX_RATING = 5000;
/** Firestore の累計レート lifetime_total_rate の上限 */
export const MAX_LIFETIME_TOTAL_RATE = 9999;

export function clampRating(rating: number) {
  return Math.max(MIN_RATING, Math.min(MAX_RATING, rating));
}

/** 累計レート（ランク表示・昇格の基準）のみ 9999 まで許可 */
export function clampLifetimeTotalRate(rating: number) {
  return Math.max(MIN_RATING, Math.min(MAX_LIFETIME_TOTAL_RATE, rating));
}

/** 新規ユーザー・仮想対戦相手のベースレート・週次リセット時の基準 */
export const DEFAULT_INITIAL_RATING = 1500;
const DEFAULT_OPPONENT_RATING = 1500;
const DEFAULT_K_FACTOR = 32;

export type ComputeRatingOptions = {
  opponentRating?: number;
  kFactor?: number;
};

/**
 * Elo 更新: 実際のスコア S（0〜1）と期待スコア E の差で増減する。
 * - S=1 勝ち, S=0 負け, S=0.5 引き分け想定
 * （負け・降参時のレート減少に使用）
 */
export function computeNewPlayerRating(
  currentRating: number,
  actualScore: number,
  options?: ComputeRatingOptions
) {
  const opponentRating = options?.opponentRating ?? DEFAULT_OPPONENT_RATING;
  const k = options?.kFactor ?? DEFAULT_K_FACTOR;
  const S = Math.max(0, Math.min(1, actualScore));
  const E = expectedScore(currentRating, opponentRating);
  const newRating = clampRating(currentRating + k * (S - E));
  return {
    newRating,
    ratingDelta: newRating - currentRating,
    S,
    E,
  };
}

/** 正解時: 最低 +6 に加え、(平均手数 − 自分の手数)×2 を上乗せ（平均より遅い場合は 0） */
const WIN_BASE_BONUS = 6;
const WIN_SPEED_MULTIPLIER = 2;

export type ApplyWinRatingBonusOptions = {
  /**
   * 擬似対戦のゴーストの正解手数。指定時は (ゴースト手数 − 自分の手数)×係数 を追加（負け越しは呼び出し側で負け処理に回すこと）。
   */
  ghostHandCount?: number;
};

export function applyWinRatingBonus(
  currentRating: number,
  averageHandCount: number,
  myHandCount: number,
  options?: ApplyWinRatingBonusOptions
) {
  const speedBonus =
    Math.max(0, averageHandCount - myHandCount) * WIN_SPEED_MULTIPLIER;
  const ghostBeatBonus =
    options?.ghostHandCount !== undefined
      ? Math.max(0, options.ghostHandCount - myHandCount) * WIN_SPEED_MULTIPLIER
      : 0;
  const ratingDelta = WIN_BASE_BONUS + speedBonus + ghostBeatBonus;
  const newRating = clampRating(currentRating + ratingDelta);
  return {
    newRating,
    ratingDelta,
    baseBonus: WIN_BASE_BONUS,
    speedBonus,
    ghostBeatBonus,
  };
}
