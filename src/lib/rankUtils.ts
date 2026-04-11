import { MIN_RATING } from "./elo";

/** ランク表示・ティア計算に使うレート（週次レートと peak の大きい方） */
export function getDisplayRating(
  currentRating: number,
  peakRating: number | null | undefined
): number {
  const c = Number.isFinite(currentRating) ? currentRating : MIN_RATING;
  if (peakRating == null || !Number.isFinite(peakRating)) return c;
  return Math.max(c, peakRating);
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
  { id: "mythic", nameJa: "ミシック", min: 4020, max: 4419, tierWidth: 100 },
] as const;

export const MYTHIC_GLORY_MIN = 4420;

export function rankImagePath(rankId: RankId): string {
  return `/assets/ranks/${rankId}.png`;
}

/**
 * 同じ枠内での表示倍率（中央・はみ出しは枠でクリップ）。
 * epic は初期の PNG に余白が多く、後からトリミングしてもキャンバス比の癖で小さく見えやすいためだけ強めに拡大。
 */
export function getRankLogoContentScale(rankId: RankId): number {
  if (rankId === "epic") return 1.5;
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
