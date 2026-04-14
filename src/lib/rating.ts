/** シーズンレート帯（ソフトキャップ）: 高帯ほど勝ちにくく・負けやすく */

const BRACKET_LOW_MAX = 1500;
const BRACKET_MID_MAX = 2000;

/** 勝ちの基礎点（キャラ平均・ゴーストボーナスに加算） */
export function bracketWinBase(currentRating: number): number {
  if (currentRating < BRACKET_LOW_MAX) return 15;
  if (currentRating < BRACKET_MID_MAX) return 12;
  return 10;
}

/** 負けの減点（正の数＝減らす量。シーズンレート帯のみで決まり手数は無関係） */
export function bracketLossPoints(currentRating: number): number {
  if (currentRating < BRACKET_LOW_MAX) return 5;
  if (currentRating < BRACKET_MID_MAX) return 8;
  return 12;
}

/**
 * 負け時: 帯別固定減点（Elo 廃止）
 */
export function computeFixedLossRating(currentRating: number) {
  const delta = -bracketLossPoints(currentRating);
  const newRating = clampRating(currentRating + delta);
  return {
    newRating,
    ratingDelta: newRating - currentRating,
  };
}

// Hand数が少ないほどSが大きくなる連続スコア（レガシー／他用途）
// S = Mavg / (My + Mavg)
export function handScoreFromAvg(myHandCount: number, mAvgHandCount: number) {
  if (myHandCount < 0) return 0;
  if (mAvgHandCount <= 0) return 0;
  const s = mAvgHandCount / (myHandCount + mAvgHandCount);
  return Math.max(0, Math.min(1, s));
}

/** プレイヤーレートの下限（負けでもこれ未満にならない。シーズン初期値も同じ 1500） */
export const MIN_RATING = 1500;
/** シーズンの current_rate・rating の上限 */
export const MAX_RATING = 100000;

export function clampRating(rating: number) {
  return Math.max(MIN_RATING, Math.min(MAX_RATING, rating));
}

/**
 * Firestore / API JSON 由来の1フィールドをシーズンレートに（数値・数字文字列）。
 */
export function parseSeasonRateField(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clampRating(value);
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.trim());
    if (Number.isFinite(n)) return clampRating(n);
  }
  return null;
}

/** `/api/submit-result` など JSON の数値フィールド用 */
export function parseJsonFiniteNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.trim());
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

/** 新規ユーザー・シーズン期間リセット時の基準 */
export const DEFAULT_INITIAL_RATING = 1500;

const WIN_SPEED_MULTIPLIER = 2;

export type ApplyWinRatingBonusOptions = {
  /**
   * 擬似対戦のゴーストの正解手数。指定時は (ゴースト手数 − 自分の手数)×係数 を追加（負け越しは呼び出し側で負け処理に回すこと）。
   */
  ghostHandCount?: number;
};

/**
 * 正解時: 帯別の基礎点に、(キャラ平均 − 自分の手数)×2 とゴースト差を加算。
 */
export function applyWinRatingBonus(
  currentRating: number,
  averageHandCount: number,
  myHandCount: number,
  options?: ApplyWinRatingBonusOptions
) {
  const baseBonus = bracketWinBase(currentRating);
  const speedBonus =
    Math.max(0, averageHandCount - myHandCount) * WIN_SPEED_MULTIPLIER;
  const ghostBeatBonus =
    options?.ghostHandCount !== undefined
      ? Math.max(0, options.ghostHandCount - myHandCount) * WIN_SPEED_MULTIPLIER
      : 0;
  const ratingDelta = baseBonus + speedBonus + ghostBeatBonus;
  const newRating = clampRating(currentRating + ratingDelta);
  return {
    newRating,
    ratingDelta,
    baseBonus,
    speedBonus,
    ghostBeatBonus,
  };
}
