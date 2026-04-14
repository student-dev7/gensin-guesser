import {
  FieldValue,
  type Firestore,
  type Transaction,
} from "firebase-admin/firestore";
import {
  characterStatsDocId,
  DEFAULT_AVG_HANDS,
  pureMeanHandCount,
} from "@/lib/characterStats";
import {
  applyWinRatingBonus,
  clampRating,
  computeFixedLossRating,
  DEFAULT_INITIAL_RATING,
} from "@/lib/rating";
import { goldEarnedFromRatingDelta } from "@/lib/gold";
import {
  formatRankTierLine,
  getRankData,
  isSeasonTierOrRankPromoted,
} from "@/lib/rankUtils";
import { USER_FIELD_NEXT_WIN_RATING_DOUBLE } from "@/lib/shop";
import {
  effectiveSeasonRateFromUserData,
  USER_FIELD_LEADERBOARD_RATING,
} from "@/lib/seasonLeaderboard";

export type SubmitTransactionResult = {
  ok: true;
  alreadySubmitted: boolean;
  ratingDelta: number;
  playerRatingAfter: number;
  playerRatingBefore: number;
  eloActualScore: number;
  averageHandCount: number;
  characterAverageHands: number;
  storedHandCount: number;
  guessCount: number;
  characterStatsUpdated: boolean;
  goldEarned: number;
  goldTotal: number;
  seasonTierPromoted: boolean;
  promotedToRankLabel?: string;
  ratingDoubledApplied: boolean;
  winBaseBonus?: number;
  winSpeedBonus?: number;
};

export type SubmitAdminParams = {
  uid: string;
  characterName: string;
  roundId: string;
  /** runs ドキュメント ID 用: encodeURIComponent(roundId)_encodeURIComponent(characterName) */
  runRefId: string;
  displayName: string;
  won: boolean;
  guessCount: number;
  personalMode: boolean;
  ghostHc: number | undefined;
  storedHandCount: number;
  statHandCountForCharacter: number;
  shouldIncrementCharacterStats: boolean;
};

/**
 * Next.js サーバー上のブラウザ用 Firestore SDK は接続が不安定なことがあるため、
 * サービスアカウントがあるときは Admin SDK で同一トランザクションを実行する。
 */
export async function executeSubmitWithAdmin(
  db: Firestore,
  p: SubmitAdminParams
): Promise<SubmitTransactionResult> {
  const userRef = db.collection("users").doc(p.uid);
  const runRef = db.collection("runs").doc(`${p.uid}_${p.runRefId}`);
  const charStatsRef = db
    .collection("character_stats")
    .doc(characterStatsDocId(p.characterName));

  return db.runTransaction(async (tx: Transaction) => {
    const existingRun = await tx.get(runRef);
    if (existingRun.exists) {
      const userSnapDup = await tx.get(userRef);
      const goldTotalDup =
        userSnapDup.exists &&
        typeof userSnapDup.data()?.gold === "number" &&
        Number.isFinite(userSnapDup.data()?.gold as number)
          ? (userSnapDup.data()?.gold as number)
          : 0;

      const charStatsSnapDup = await tx.get(charStatsRef);
      const thDup = charStatsSnapDup.exists
        ? (charStatsSnapDup.data()?.totalHandCount as number | undefined) ?? 0
        : 0;
      const twDup = charStatsSnapDup.exists
        ? (charStatsSnapDup.data()?.totalWins as number | undefined) ?? 0
        : 0;
      const characterAverageHands = pureMeanHandCount(thDup, twDup);

      const data = existingRun.data() as {
        playerRatingAfter?: number;
        playerRatingBefore?: number;
        averageHandCount?: number;
        averageHandCountUsed?: number;
        storedHandCount?: number;
      };
      const usedForAverage =
        typeof data.averageHandCountUsed === "number"
          ? data.averageHandCountUsed
          : typeof data.averageHandCount === "number"
            ? data.averageHandCount
            : DEFAULT_AVG_HANDS;
      return {
        ok: true as const,
        alreadySubmitted: true,
        ratingDelta:
          (data.playerRatingAfter ?? 0) - (data.playerRatingBefore ?? 0),
        playerRatingAfter: data.playerRatingAfter ?? DEFAULT_INITIAL_RATING,
        playerRatingBefore: data.playerRatingBefore ?? DEFAULT_INITIAL_RATING,
        eloActualScore: 0,
        averageHandCount: usedForAverage,
        characterAverageHands,
        storedHandCount:
          typeof data.storedHandCount === "number"
            ? data.storedHandCount
            : p.storedHandCount,
        guessCount: p.guessCount,
        characterStatsUpdated: false,
        goldEarned: 0,
        goldTotal: goldTotalDup,
        seasonTierPromoted: false,
        ratingDoubledApplied: false,
      };
    }

    const userSnap = await tx.get(userRef);
    const charStatsSnap = await tx.get(charStatsRef);

    const totalHandCount = charStatsSnap.exists
      ? (charStatsSnap.data()?.totalHandCount as number | undefined) ?? 0
      : 0;
    const totalWins = charStatsSnap.exists
      ? (charStatsSnap.data()?.totalWins as number | undefined) ?? 0
      : 0;

    const averageHandCount = pureMeanHandCount(totalHandCount, totalWins);

    const userData = userSnap.exists
      ? (userSnap.data() as Record<string, unknown>)
      : undefined;

    const Rp = userData
      ? effectiveSeasonRateFromUserData(userData)
      : DEFAULT_INITIAL_RATING;

    const gamesBefore = userSnap.exists
      ? (userSnap.data()?.games as number | undefined) ?? 0
      : 0;

    const goldBefore =
      userSnap.exists &&
      typeof userSnap.data()?.gold === "number" &&
      Number.isFinite(userSnap.data()?.gold as number)
        ? (userSnap.data()?.gold as number)
        : 0;

    let newRating: number;
    let ratingDelta: number;
    let ratingDoubledApplied = false;
    let eloActualScore: number;
    let eloExpected: number;
    let winBaseBonus: number | undefined;
    let winSpeedBonus: number | undefined;
    let ghostBeatBonus: number | undefined;

    if (p.personalMode) {
      newRating = Rp;
      ratingDelta = 0;
      eloActualScore = 0;
      eloExpected = 0;
      winBaseBonus = undefined;
      winSpeedBonus = undefined;
      ghostBeatBonus = undefined;
    } else if (p.won) {
      const win = applyWinRatingBonus(
        Rp,
        averageHandCount,
        p.storedHandCount,
        p.ghostHc !== undefined ? { ghostHandCount: p.ghostHc } : undefined
      );
      const nextWinDouble =
        userData?.[USER_FIELD_NEXT_WIN_RATING_DOUBLE] === true;
      if (nextWinDouble) {
        ratingDoubledApplied = true;
        ratingDelta = win.ratingDelta * 2;
        newRating = clampRating(Rp + ratingDelta);
        winBaseBonus = win.baseBonus * 2;
        winSpeedBonus = win.speedBonus * 2;
        ghostBeatBonus = win.ghostBeatBonus * 2;
      } else {
        newRating = win.newRating;
        ratingDelta = win.ratingDelta;
        winBaseBonus = win.baseBonus;
        winSpeedBonus = win.speedBonus;
        ghostBeatBonus = win.ghostBeatBonus;
      }
      eloActualScore = 1;
      eloExpected = 0;
    } else {
      const loss = computeFixedLossRating(Rp);
      newRating = loss.newRating;
      ratingDelta = loss.ratingDelta;
      eloActualScore = 0;
      eloExpected = 0;
    }

    const gamesAfter = gamesBefore + 1;

    const goldEarned = p.personalMode ? 0 : goldEarnedFromRatingDelta(ratingDelta);
    const goldTotal = goldBefore + goldEarned;

    const seasonTierPromoted =
      !p.personalMode && isSeasonTierOrRankPromoted(Rp, newRating);
    const promotedToRankLabel = seasonTierPromoted
      ? formatRankTierLine(getRankData(newRating))
      : undefined;

    if (p.personalMode) {
      tx.set(
        userRef,
        {
          displayName: p.displayName,
          games: gamesAfter,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    } else {
      const consumedNextWinDouble =
        p.won && userData?.[USER_FIELD_NEXT_WIN_RATING_DOUBLE] === true;
      tx.set(
        userRef,
        {
          current_rate: newRating,
          rating: newRating,
          [USER_FIELD_LEADERBOARD_RATING]: newRating,
          games: gamesAfter,
          displayName: p.displayName,
          updatedAt: FieldValue.serverTimestamp(),
          ...(goldEarned > 0 ? { gold: FieldValue.increment(goldEarned) } : {}),
          ...(consumedNextWinDouble
            ? { [USER_FIELD_NEXT_WIN_RATING_DOUBLE]: false }
            : {}),
        },
        { merge: true }
      );
    }

    tx.set(
      runRef,
      {
        uid: p.uid,
        roundId: p.roundId,
        characterName: p.characterName,
        won: p.won,
        handCount: p.storedHandCount,
        guessCount: p.guessCount,
        averageHandCountUsed: averageHandCount,
        eloActualScore,
        eloExpected,
        playerRatingBefore: Rp,
        playerRatingAfter: newRating,
        characterStatsUpdated: p.shouldIncrementCharacterStats,
        goldEarned,
        goldTotalAfter: goldTotal,
        personalMode: p.personalMode,
        ...(p.won && !p.personalMode
          ? {
              winBaseBonus: winBaseBonus ?? 0,
              winSpeedBonus: winSpeedBonus ?? 0,
              ghostBeatBonus: ghostBeatBonus ?? 0,
            }
          : {}),
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    {
      const charStatsPayload: Record<string, unknown> = {
        characterName: p.characterName,
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (p.shouldIncrementCharacterStats) {
        charStatsPayload.totalHandCount = FieldValue.increment(
          p.statHandCountForCharacter
        );
        charStatsPayload.totalWins = FieldValue.increment(1);
      }
      tx.set(charStatsRef, charStatsPayload, { merge: true });
    }

    const newTotalHandCount =
      totalHandCount +
      (p.shouldIncrementCharacterStats ? p.statHandCountForCharacter : 0);
    const newTotalWins =
      totalWins + (p.shouldIncrementCharacterStats ? 1 : 0);
    const characterAverageHands = pureMeanHandCount(
      newTotalHandCount,
      newTotalWins
    );

    return {
      ok: true as const,
      alreadySubmitted: false,
      playerRatingAfter: newRating,
      playerRatingBefore: Rp,
      ratingDelta,
      eloActualScore,
      averageHandCount,
      characterAverageHands,
      storedHandCount: p.storedHandCount,
      guessCount: p.guessCount,
      characterStatsUpdated: p.shouldIncrementCharacterStats,
      winBaseBonus,
      winSpeedBonus,
      goldEarned,
      goldTotal,
      seasonTierPromoted,
      promotedToRankLabel,
      ratingDoubledApplied,
    };
  });
}
