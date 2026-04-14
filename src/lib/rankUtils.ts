import {
  DEFAULT_INITIAL_RATING,
  MAX_RATING,
  MIN_RATING,
} from "./rating";

/**
 * 【ランク表示の基準：シーズンレート（current_rate / rating）】
 */

/** ウォリアー〜ミシックの各ティア（IV→III→II→I）の幅。勝ち1戦 +10〜+20 前後を想定し、ティア1段で約6〜12戦相当。 */
export const RANK_TIER_WIDTH_PT = 125;

/** ウォリアー／エリートなどランク名が変わる帯の幅（各 500pt）。1 ランクダウンはおおよそこの幅。 */
export const RANK_BAND_WIDTH_PT = 500;

/** Gミシック（旧ミシックグローリー帯）の各ティア幅 */
export const G_MYTHIC_TIER_WIDTH_PT = 1375;

/** Gミシックのレート範囲（4500〜9999、IV〜I） */
export const G_MYTHIC_MIN = 4500;
export const G_MYTHIC_MAX = 9999;

/** Iミシック到達レート（10000〜MAX） */
export const I_MYTHIC_MIN = 10000;

/** @deprecated 互換用。G_MYTHIC_MIN と同じ */
export const MYTHIC_GLORY_MIN = G_MYTHIC_MIN;

/** ランク・昇格までの pt 表示に使うレート（シーズンレート） */
export function rateForRankDisplay(
  seasonRate: number | null | undefined
): number {
  if (seasonRate == null || !Number.isFinite(seasonRate)) {
    return DEFAULT_INITIAL_RATING;
  }
  return seasonRate;
}

export type RomanTier = "IV" | "III" | "II" | "I";

export type RankId =
  | "warrior"
  | "elite"
  | "master"
  | "grandmaster"
  | "epic"
  | "legend"
  | "mythic"
  | "mythic-glory"
  | "mythic-i";

export type RankData = {
  rankId: RankId;
  /** 表示名（日本語） */
  rankName: string;
  imagePath: string;
  tierRoman: RomanTier | null;
  /** 現在ランク帯のレート範囲 */
  bracketMin: number;
  bracketMax: number;
};

export type TierProgress = {
  /** 現在ティア内の進捗 0〜100 */
  progressPercent: number;
  /** 次のティア（または次ランク・最終到達）まであと何 pt か（整数に丸め） */
  pointsToNext: number;
  /** これ以上の昇格がない */
  isFinal: boolean;
};

const ROMAN_BY_INDEX: RomanTier[] = ["IV", "III", "II", "I"];

type RankBand = {
  id: Exclude<RankId, "mythic-glory" | "mythic-i">;
  /** 表示名（日本語読み） */
  nameJa: string;
  min: number;
  max: number;
  tierWidth: number;
};

/**
 * 8 段階ランク（ウォリアー〜ミシック）＋ Gミシック ＋ Iミシック。
 * ウォリアー〜ミシック: 各ランク 500pt 幅、内部を IV〜I の 4 ティアに分割（125pt×4）。
 */
export const RANK_BANDS: readonly RankBand[] = [
  { id: "warrior", nameJa: "ウォリアー", min: 1000, max: 1499, tierWidth: RANK_TIER_WIDTH_PT },
  { id: "elite", nameJa: "エリート", min: 1500, max: 1999, tierWidth: RANK_TIER_WIDTH_PT },
  { id: "master", nameJa: "マスター", min: 2000, max: 2499, tierWidth: RANK_TIER_WIDTH_PT },
  { id: "grandmaster", nameJa: "グランドマスター", min: 2500, max: 2999, tierWidth: RANK_TIER_WIDTH_PT },
  { id: "epic", nameJa: "エピック", min: 3000, max: 3499, tierWidth: RANK_TIER_WIDTH_PT },
  { id: "legend", nameJa: "レジェンド", min: 3500, max: 3999, tierWidth: RANK_TIER_WIDTH_PT },
  { id: "mythic", nameJa: "ミシック", min: 4000, max: 4499, tierWidth: RANK_TIER_WIDTH_PT },
] as const;

export function rankImagePath(rankId: RankId): string {
  return `/assets/ranks/${rankId}.png`;
}

/**
 * 同じ枠内での表示倍率（中央・はみ出しは枠でクリップ）。
 * 全ランク同一倍率（1）。
 */
export function getRankLogoContentScale(rankId: RankId): number {
  void rankId;
  return 1;
}

/** モーダル・一覧用：各ランクの必要レート範囲とティア幅 */
export function getRankRangeTableRows(): {
  rankId: RankId;
  rankName: string;
  rangeLabel: string;
  tierWidthLabel: string;
}[] {
  const rows = RANK_BANDS.map((b) => ({
    rankId: b.id as RankId,
    rankName: b.nameJa,
    rangeLabel: `${b.min} 〜 ${b.max}`,
    tierWidthLabel: `${b.tierWidth} pt（IV〜I の各ティア）`,
  }));
  rows.push({
    rankId: "mythic-glory",
    rankName: "Gミシック",
    rangeLabel: `${G_MYTHIC_MIN} 〜 ${G_MYTHIC_MAX}`,
    tierWidthLabel: `${G_MYTHIC_TIER_WIDTH_PT} pt（IV〜I の各ティア）`,
  });
  rows.push({
    rankId: "mythic-i",
    rankName: "Iミシック",
    rangeLabel: `${I_MYTHIC_MIN} 〜 ${MAX_RATING.toLocaleString("ja-JP")}`,
    tierWidthLabel: "ティアなし（レートのみ上昇）",
  });
  return rows;
}

function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return MIN_RATING;
  return Math.max(MIN_RATING, Math.min(MAX_RATING, rate));
}

function tierBoundsInBand(
  band: RankBand,
  tierRoman: RomanTier
): { low: number; high: number } {
  const idx = ROMAN_BY_INDEX.indexOf(tierRoman);
  const w = band.tierWidth;
  const low = band.min + idx * w;
  const high = Math.min(band.max, low + w - 1);
  return { low, high };
}

function gMythicTierBounds(tierRoman: RomanTier): { low: number; high: number } {
  const idx = ROMAN_BY_INDEX.indexOf(tierRoman);
  const w = G_MYTHIC_TIER_WIDTH_PT;
  const low = G_MYTHIC_MIN + idx * w;
  const high = Math.min(G_MYTHIC_MAX, low + w - 1);
  return { low, high };
}

/**
 * レートからランク名・画像・ローマ字ティアを返す（シーズンレート基準）。
 */
export function getRankData(rate: number): RankData {
  const r = clampRate(rate);

  if (r >= I_MYTHIC_MIN) {
    return {
      rankId: "mythic-i",
      rankName: "Iミシック",
      imagePath: rankImagePath("mythic-i"),
      tierRoman: null,
      bracketMin: I_MYTHIC_MIN,
      bracketMax: MAX_RATING,
    };
  }

  if (r >= G_MYTHIC_MIN && r <= G_MYTHIC_MAX) {
    const w = G_MYTHIC_TIER_WIDTH_PT;
    const idx = Math.min(3, Math.max(0, Math.floor((r - G_MYTHIC_MIN) / w)));
    const tierRoman = ROMAN_BY_INDEX[idx]!;
    const { low, high } = gMythicTierBounds(tierRoman);
    return {
      rankId: "mythic-glory",
      rankName: "Gミシック",
      imagePath: rankImagePath("mythic-glory"),
      tierRoman,
      bracketMin: low,
      bracketMax: high,
    };
  }

  const band =
    RANK_BANDS.find((b) => r >= b.min && r <= b.max) ?? RANK_BANDS[0]!;
  const w = band.tierWidth;
  const idx = Math.min(3, Math.max(0, Math.floor((r - band.min) / w)));
  const tierRoman = ROMAN_BY_INDEX[idx]!;
  const { low, high } = tierBoundsInBand(band, tierRoman);

  return {
    rankId: band.id,
    rankName: band.nameJa,
    imagePath: rankImagePath(band.id),
    tierRoman,
    bracketMin: low,
    bracketMax: high,
  };
}

/** 下位→高位 */
const LADDER_RANK_ORDER: readonly RankId[] = [
  "warrior",
  "elite",
  "master",
  "grandmaster",
  "epic",
  "legend",
  "mythic",
  "mythic-glory",
  "mythic-i",
] as const;

function rankLadderIndex(rankId: RankId): number {
  return LADDER_RANK_ORDER.indexOf(rankId);
}

const ROMAN_STEP: Record<RomanTier, number> = {
  IV: 0,
  III: 1,
  II: 2,
  I: 3,
};

/** ランク名＋ローマティア（表示用） */
export function formatRankTierLine(data: RankData): string {
  const name =
    typeof data.rankName === "string" && data.rankName.trim().length > 0
      ? data.rankName.trim()
      : "—";
  if (data.tierRoman != null) {
    return `${name} ${data.tierRoman}`;
  }
  return name;
}

/**
 * シーズンレートが before→after で、ランク帯またはティアが一段上がったか。
 */
export function isSeasonTierOrRankPromoted(
  seasonBefore: number,
  seasonAfter: number
): boolean {
  if (
    !Number.isFinite(seasonBefore) ||
    !Number.isFinite(seasonAfter) ||
    seasonAfter <= seasonBefore
  ) {
    return false;
  }
  const before = getRankData(seasonBefore);
  const after = getRankData(seasonAfter);

  const ai = rankLadderIndex(after.rankId);
  const bi = rankLadderIndex(before.rankId);
  if (ai > bi) return true;
  if (ai < bi) return false;

  if (before.tierRoman != null && after.tierRoman != null) {
    return ROMAN_STEP[after.tierRoman] > ROMAN_STEP[before.tierRoman];
  }
  return false;
}

/**
 * 現在ティア内の進捗と、昇格までのポイント（シーズンレート）。
 */
export function getTierProgress(rate: number): TierProgress {
  const r = clampRate(rate);

  if (r >= MAX_RATING) {
    return { progressPercent: 100, pointsToNext: 0, isFinal: true };
  }

  if (r >= I_MYTHIC_MIN) {
    const low = I_MYTHIC_MIN;
    const high = MAX_RATING;
    const denom = high - low;
    const progressPercent =
      denom <= 0
        ? 100
        : Math.max(0, Math.min(100, ((r - low) / denom) * 100));
    const pointsToNext = Math.max(0, Math.ceil(high - r));
    return {
      progressPercent,
      pointsToNext,
      isFinal: false,
    };
  }

  if (r >= G_MYTHIC_MIN && r <= G_MYTHIC_MAX) {
    const w = G_MYTHIC_TIER_WIDTH_PT;
    const idx = Math.min(3, Math.max(0, Math.floor((r - G_MYTHIC_MIN) / w)));
    const tierRoman = ROMAN_BY_INDEX[idx]!;
    const { low, high } = gMythicTierBounds(tierRoman);
    const denom = high - low;
    const progressPercent =
      denom <= 0
        ? 100
        : Math.max(0, Math.min(100, ((r - low) / denom) * 100));

    const isTierI = tierRoman === "I";
    const nextThreshold = isTierI ? I_MYTHIC_MIN : high + 1;
    const pointsToNext = Math.max(0, Math.ceil(nextThreshold - r));

    return {
      progressPercent,
      pointsToNext,
      isFinal: false,
    };
  }

  const band =
    RANK_BANDS.find((b) => r >= b.min && r <= b.max) ?? RANK_BANDS[0]!;
  const w = band.tierWidth;

  const idx = Math.min(3, Math.max(0, Math.floor((r - band.min) / w)));
  const tierRoman = ROMAN_BY_INDEX[idx]!;
  const { low, high } = tierBoundsInBand(band, tierRoman);

  const denom = high - low;
  const progressPercent =
    denom <= 0 ? 100 : Math.max(0, Math.min(100, ((r - low) / denom) * 100));

  const isTierI = tierRoman === "I";
  let nextThreshold: number;
  if (!isTierI) {
    nextThreshold = high + 1;
  } else if (band.id === "mythic") {
    nextThreshold = G_MYTHIC_MIN;
  } else {
    const nextBand = RANK_BANDS[RANK_BANDS.indexOf(band) + 1];
    nextThreshold = nextBand ? nextBand.min : G_MYTHIC_MIN;
  }

  const pointsToNext = Math.max(0, Math.ceil(nextThreshold - r));

  return {
    progressPercent,
    pointsToNext,
    isFinal: false,
  };
}

export type TierBarFromRate = {
  /** 現在ティアの幅（RANK_BANDS の tierWidth。Iミシックは帯全体幅） */
  tierSpan: number;
  /**
   * ティア下限からのオフセット（0 〜 tierSpan-1）。ティア下限で 0、上限付近で最大。
   */
  progressInTier: number;
  /** バー塗りつぶし 0〜1 */
  fillRatio: number;
  pointsToNext: number;
  isFinal: boolean;
};

/**
 * シーズンレートを基準に、現在ティア内の進捗と昇格までの pt を返す。
 */
export function getTierBarFromSeasonRate(seasonRate: number): TierBarFromRate {
  const r = clampRate(seasonRate);

  if (r >= MAX_RATING) {
    return {
      tierSpan: 0,
      progressInTier: 0,
      fillRatio: 1,
      pointsToNext: 0,
      isFinal: true,
    };
  }

  if (r >= I_MYTHIC_MIN) {
    const low = I_MYTHIC_MIN;
    const high = MAX_RATING;
    const w = high - low + 1;
    const rInt = Math.floor(r);
    const offsetFromLow = Math.min(w - 1, Math.max(0, rInt - low));
    const fillRatio =
      w <= 1 ? 1 : Math.min(1, Math.max(0, (rInt - low) / (high - low)));
    const tp = getTierProgress(seasonRate);
    return {
      tierSpan: w,
      progressInTier: offsetFromLow,
      fillRatio,
      pointsToNext: tp.pointsToNext,
      isFinal: false,
    };
  }

  if (r >= G_MYTHIC_MIN && r <= G_MYTHIC_MAX) {
    const w = G_MYTHIC_TIER_WIDTH_PT;
    const idx = Math.min(3, Math.max(0, Math.floor((r - G_MYTHIC_MIN) / w)));
    const tierRoman = ROMAN_BY_INDEX[idx]!;
    const { low, high } = gMythicTierBounds(tierRoman);

    const rInt = Math.floor(r);
    const offsetFromLow =
      rInt < low ? 0 : Math.min(w - 1, Math.max(0, rInt - low));
    const progressInTier = w <= 1 ? 0 : offsetFromLow;
    const fillRatio =
      w <= 1
        ? rInt >= low && rInt <= high
          ? 1
          : 0
        : Math.min(1, Math.max(0, (rInt - low) / (w - 1)));

    const tp = getTierProgress(seasonRate);

    return {
      tierSpan: w,
      progressInTier,
      fillRatio,
      pointsToNext: tp.pointsToNext,
      isFinal: tp.isFinal,
    };
  }

  const band =
    RANK_BANDS.find((b) => r >= b.min && r <= b.max) ?? RANK_BANDS[0]!;
  const w = band.tierWidth;
  const idx = Math.min(3, Math.max(0, Math.floor((r - band.min) / w)));
  const tierRoman = ROMAN_BY_INDEX[idx]!;
  const { low, high } = tierBoundsInBand(band, tierRoman);

  const rInt = Math.floor(r);
  const offsetFromLow =
    rInt < low ? 0 : Math.min(w - 1, Math.max(0, rInt - low));
  const progressInTier = w <= 1 ? 0 : offsetFromLow;
  const fillRatio =
    w <= 1
      ? rInt >= low && rInt <= high
        ? 1
        : 0
      : Math.min(1, Math.max(0, (rInt - low) / (w - 1)));

  const tp = getTierProgress(seasonRate);

  return {
    tierSpan: w,
    progressInTier,
    fillRatio,
    pointsToNext: tp.pointsToNext,
    isFinal: tp.isFinal,
  };
}

const ACCENT_HEX: Record<RankId, string> = {
  warrior: "#94a3b8",
  elite: "#4ade80",
  master: "#38bdf8",
  grandmaster: "#a78bfa",
  epic: "#f472b6",
  legend: "#fbbf24",
  mythic: "#f87171",
  "mythic-glory": "#fde047",
  "mythic-i": "#fff7c2",
};

export function getRankAccentHex(rankId: RankId): string {
  return ACCENT_HEX[rankId] ?? "#94a3b8";
}
