import { DEFAULT_INITIAL_RATING, MIN_RATING } from "./elo";

/**
 * 【ランク表示の基準：累計レート（lifetime_total_rate）】
 * - 試合終了時のレート増減は、シーズン用の `current_rate` と、この累計の両方に加算される。
 * - 毎週のリセットでは `current_rate` だけが基準値（例: 1500）に戻り、累計は維持される。
 * - ランク帯・「次のランクまであと◯◯」は累計レートのみから算出する（シーズンレートは使わない）。
 */

/** ランク・昇格までの pt 表示に使う累計レート（未設定時は初期値） */
export function rateForRankDisplay(
  lifetimeTotalRate: number | null | undefined
): number {
  if (lifetimeTotalRate == null || !Number.isFinite(lifetimeTotalRate)) {
    return DEFAULT_INITIAL_RATING;
  }
  return lifetimeTotalRate;
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
  | "mythic-glory";

export type RankData = {
  rankId: RankId;
  /** 表示名（日本語） */
  rankName: string;
  imagePath: string;
  tierRoman: RomanTier | null;
  /** 現在ランク帯のレート範囲（Mythic Glory は max を大きな値で表す） */
  bracketMin: number;
  bracketMax: number;
};

export type TierProgress = {
  /** 現在ティア内の進捗 0〜100 */
  progressPercent: number;
  /** 次のティア（または次ランク）まであと何 pt か（整数に丸め） */
  pointsToNext: number;
  /** Mythic Glory など、これ以上の昇格がない */
  isFinal: boolean;
};

const ROMAN_BY_INDEX: RomanTier[] = ["IV", "III", "II", "I"];

type RankBand = {
  id: Exclude<RankId, "mythic-glory">;
  /** 表示名（日本語読み） */
  nameJa: string;
  min: number;
  max: number;
  tierWidth: number;
};

/**
 * ランク帯（ティア幅は帯内で4分割）。
 * シルバー廃止後: エリートが旧シルバー下限〜旧エリート上限をまとめて担当（1620〜2099、幅120×4）。
 * マスター以降の境界は従来どおり。
 */
export const RANK_BANDS: readonly RankBand[] = [
  { id: "warrior", nameJa: "ウォリアー", min: 1500, max: 1619, tierWidth: 30 },
  { id: "elite", nameJa: "エリート", min: 1620, max: 2099, tierWidth: 120 },
  { id: "master", nameJa: "マスター", min: 2100, max: 2459, tierWidth: 90 },
  { id: "grandmaster", nameJa: "グランドマスター", min: 2460, max: 2899, tierWidth: 110 },
  { id: "epic", nameJa: "エピック", min: 2900, max: 3419, tierWidth: 130 },
  { id: "legend", nameJa: "レジェンド", min: 3420, max: 4019, tierWidth: 150 },
  {
    id: "mythic",
    nameJa: "ミシック",
    min: 4020,
    max: 7499,
    /** 4020〜7499 を IV〜I に4分割（7500 からミシックグローリー） */
    tierWidth: 870,
  },
] as const;

export const MYTHIC_GLORY_MIN = 7500;

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

/** モーダル用：各ランクの必要レート範囲一覧（ロゴ用 rankId 付き） */
export function getRankRangeTableRows(): {
  rankId: RankId;
  rankName: string;
  rangeLabel: string;
}[] {
  const rows = RANK_BANDS.map((b) => ({
    rankId: b.id as RankId,
    rankName: b.nameJa,
    rangeLabel: `${b.min} 〜 ${b.max}`,
  }));
  rows.push({
    rankId: "mythic-glory",
    rankName: "ミシックグローリー",
    rangeLabel: `${MYTHIC_GLORY_MIN} 〜`,
  });
  return rows;
}

function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return MIN_RATING;
  return rate;
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

/**
 * レートからランク名・画像・ローマ字ティアを返す。
 * 1500 未満は Warrior IV 固定。
 */
export function getRankData(rate: number): RankData {
  const r = clampRate(rate);

  if (r >= MYTHIC_GLORY_MIN) {
    return {
      rankId: "mythic-glory",
      rankName: "ミシックグローリー",
      imagePath: rankImagePath("mythic-glory"),
      tierRoman: null,
      bracketMin: MYTHIC_GLORY_MIN,
      bracketMax: 99999,
    };
  }

  if (r < 1500) {
    const warrior = RANK_BANDS[0]!;
    const { low, high } = tierBoundsInBand(warrior, "IV");
    return {
      rankId: "warrior",
      rankName: warrior.nameJa,
      imagePath: rankImagePath("warrior"),
      tierRoman: "IV",
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

/** 下位→高位（ミシックグローリーが最終） */
const LADDER_RANK_ORDER: readonly RankId[] = [
  "warrior",
  "elite",
  "master",
  "grandmaster",
  "epic",
  "legend",
  "mythic",
  "mythic-glory",
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

/** ランク名＋ローマティア（累計レート表示用） */
export function formatRankTierLine(data: RankData): string {
  return data.tierRoman != null
    ? `${data.rankName} ${data.tierRoman}`
    : data.rankName;
}

/**
 * 累計レートが before→after で、ランク帯またはティアが一段上がったか。
 * 同じティア内の数値上昇のみでは false。
 */
export function isLifetimeTierOrRankPromoted(
  lifetimeBefore: number,
  lifetimeAfter: number
): boolean {
  if (
    !Number.isFinite(lifetimeBefore) ||
    !Number.isFinite(lifetimeAfter) ||
    lifetimeAfter <= lifetimeBefore
  ) {
    return false;
  }
  const before = getRankData(lifetimeBefore);
  const after = getRankData(lifetimeAfter);

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
 * 現在ティア内の進捗と、昇格までのポイント。
 * 1500 未満は Warrior IV として Warrior IV 内の進捗（IV→III へは 1530 未満の差分）。
 */
export function getTierProgress(rate: number): TierProgress {
  const r = clampRate(rate);

  if (r >= MYTHIC_GLORY_MIN) {
    return { progressPercent: 100, pointsToNext: 0, isFinal: true };
  }

  const band =
    RANK_BANDS.find((b) => r >= b.min && r <= b.max) ?? RANK_BANDS[0]!;
  const w = band.tierWidth;

  /** 1500 未満：Warrior IV として扱う */
  if (r < 1500) {
    const warrior = RANK_BANDS[0]!;
    const { low, high } = tierBoundsInBand(warrior, "IV");
    const nextStart = high + 1;
    const denom = high - low;
    const progressPercent =
      denom <= 0 ? 0 : Math.max(0, Math.min(100, ((r - low) / denom) * 100));
    const pointsToNext = Math.max(0, Math.ceil(nextStart - r));
    return {
      progressPercent,
      pointsToNext,
      isFinal: false,
    };
  }

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
    nextThreshold = MYTHIC_GLORY_MIN;
  } else {
    const nextBand = RANK_BANDS[RANK_BANDS.indexOf(band) + 1];
    nextThreshold = nextBand ? nextBand.min : MYTHIC_GLORY_MIN;
  }

  const pointsToNext = Math.max(0, Math.ceil(nextThreshold - r));

  return {
    progressPercent,
    pointsToNext,
    isFinal: false,
  };
}

/** 累計レートからティア内バー表示用（例: ウォリアーは幅 30 で「14 / 30」） */
export type TierBarFromRate = {
  /** 現在ティアの幅（RANK_BANDS の tierWidth。ウォリアーなら 30） */
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
 * 累計レートを基準に、現在ティア内の進捗（分母はその帯の tierWidth）と昇格までの pt を返す。
 */
export function getTierBarFromLifetimeRate(lifetimeRate: number): TierBarFromRate {
  const r = clampRate(lifetimeRate);

  if (r >= MYTHIC_GLORY_MIN) {
    return {
      tierSpan: 0,
      progressInTier: 0,
      fillRatio: 1,
      pointsToNext: 0,
      isFinal: true,
    };
  }

  let band: RankBand;
  let low: number;
  let high: number;
  let w: number;

  if (r < 1500) {
    band = RANK_BANDS[0]!;
    w = band.tierWidth;
    ({ low, high } = tierBoundsInBand(band, "IV"));
  } else {
    band =
      RANK_BANDS.find((b) => r >= b.min && r <= b.max) ?? RANK_BANDS[0]!;
    w = band.tierWidth;
    const idx = Math.min(3, Math.max(0, Math.floor((r - band.min) / w)));
    const tierRoman = ROMAN_BY_INDEX[idx]!;
    ({ low, high } = tierBoundsInBand(band, tierRoman));
  }

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

  const tp = getTierProgress(lifetimeRate);

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
};

export function getRankAccentHex(rankId: RankId): string {
  return ACCENT_HEX[rankId] ?? "#94a3b8";
}
