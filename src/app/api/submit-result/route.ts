import { NextResponse } from "next/server";
import {
  doc,
  increment,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import {
  bayesianMeanHands,
  characterStatsDocId,
  DEFAULT_AVG_HANDS,
  MIN_HANDS_FOR_STATS,
} from "@/lib/characterStats";
import {
  applyWinRatingBonus,
  clampRating,
  computeNewPlayerRating,
  DEFAULT_INITIAL_RATING,
  expectedScore,
} from "@/lib/elo";
import { withUserFirestore } from "@/lib/firebaseUserFirestore";
import { getUidFromIdToken } from "@/lib/identityToolkit";
import { getRatingWeekMondayKeyJst } from "@/lib/ratingWeek";
import { goldEarnedFromRatingDelta } from "@/lib/gold";
import {
  formatRankTierLine,
  getRankData,
  isLifetimeTierOrRankPromoted,
} from "@/lib/rankUtils";
import { validateDisplayName } from "@/lib/validateDisplayName";

type SubmitBody = {
  idToken: string;
  won: boolean;
  handCount: number;
  guessCount: number;
  characterName: string;
  roundId: string;
  displayName: string;
};

/** 降参・手数切れなど won:false の runs 記録用ペナルティ手数 */
const LOSS_RECORD_HANDS = 7;
const MAX_GUESSES_ROUND = 7;
const MIN_GUESSES_TO_RESIGN = 4;

function readSeasonRate(data: Record<string, unknown> | undefined): number {
  if (!data) return DEFAULT_INITIAL_RATING;
  const cr = data.current_rate;
  if (typeof cr === "number" && Number.isFinite(cr)) return clampRating(cr);
  const legacy = data.rating;
  if (typeof legacy === "number" && Number.isFinite(legacy)) {
    return clampRating(legacy);
  }
  return DEFAULT_INITIAL_RATING;
}

function readLifetimeTotal(data: Record<string, unknown> | undefined): number {
  if (!data) return DEFAULT_INITIAL_RATING;
  const lt = data.lifetime_total_rate;
  if (typeof lt === "number" && Number.isFinite(lt)) return clampRating(lt);
  const legacy = data.rating;
  if (typeof legacy === "number" && Number.isFinite(legacy)) {
    return clampRating(legacy);
  }
  return DEFAULT_INITIAL_RATING;
}

export async function POST(req: Request) {
  const body = (await req.json()) as SubmitBody;
  const {
    idToken,
    won,
    handCount: rawHandCount,
    guessCount: rawGuessCount,
    characterName,
    roundId,
    displayName: rawDisplayName,
  } = body ?? ({} as SubmitBody);

  if (!idToken || typeof idToken !== "string") {
    return NextResponse.json(
      { ok: false, error: "Missing idToken" },
      { status: 400 }
    );
  }
  if (typeof won !== "boolean") {
    return NextResponse.json(
      { ok: false, error: "Invalid won" },
      { status: 400 }
    );
  }
  if (typeof rawHandCount !== "number" || !Number.isFinite(rawHandCount)) {
    return NextResponse.json(
      { ok: false, error: "Invalid handCount" },
      { status: 400 }
    );
  }
  if (typeof rawGuessCount !== "number" || !Number.isFinite(rawGuessCount)) {
    return NextResponse.json(
      { ok: false, error: "Missing or invalid guessCount" },
      { status: 400 }
    );
  }

  const guessCount = Math.round(rawGuessCount);
  if (guessCount < 0 || guessCount > MAX_GUESSES_ROUND) {
    return NextResponse.json(
      { ok: false, error: "guessCount out of range" },
      { status: 400 }
    );
  }

  if (
    !won &&
    guessCount < MIN_GUESSES_TO_RESIGN &&
    guessCount !== MAX_GUESSES_ROUND
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: "降参は4回以上予想してから可能です（手数切れを除く）",
      },
      { status: 400 }
    );
  }

  if (won && Math.round(rawHandCount) !== guessCount) {
    return NextResponse.json(
      { ok: false, error: "handCount and guessCount must match when won" },
      { status: 400 }
    );
  }

  if (!characterName || typeof characterName !== "string") {
    return NextResponse.json(
      { ok: false, error: "Missing characterName" },
      { status: 400 }
    );
  }
  if (!roundId || typeof roundId !== "string" || roundId.length > 200) {
    return NextResponse.json(
      { ok: false, error: "Invalid roundId" },
      { status: 400 }
    );
  }

  const nameCheck = validateDisplayName(
    typeof rawDisplayName === "string" ? rawDisplayName : ""
  );
  if (!nameCheck.ok) {
    return NextResponse.json(
      { ok: false, error: nameCheck.error },
      { status: 400 }
    );
  }
  const displayName = nameCheck.name;

  const runRefId = `${encodeURIComponent(roundId)}_${encodeURIComponent(
    characterName
  )}`;

  const currentWeekKey = getRatingWeekMondayKeyJst();

  try {
    const uid = await getUidFromIdToken(idToken);
    if (!uid) {
      return NextResponse.json(
        { ok: false, error: "Invalid or expired idToken" },
        { status: 401 }
      );
    }

    const storedHandCount = won ? Math.max(1, rawHandCount) : LOSS_RECORD_HANDS;
    /** キャラ別平均手数用。負けは実際の予想回数、勝ちは 1 手以上 */
    const statHandCountForCharacter = won
      ? Math.max(1, Math.round(rawHandCount))
      : guessCount;
    const shouldIncrementCharacterStats =
      !won || statHandCountForCharacter >= MIN_HANDS_FOR_STATS;

    const result = await withUserFirestore(idToken, async (db) => {
      const userRef = doc(db, "users", uid);
      const runRef = doc(db, "runs", `${uid}_${runRefId}`);
      const charStatsRef = doc(
        db,
        "character_stats",
        characterStatsDocId(characterName)
      );

      return runTransaction(db, async (tx) => {
        const existingRun = await tx.get(runRef);
        if (existingRun.exists()) {
          const userSnapDup = await tx.get(userRef);
          const goldTotalDup =
            userSnapDup.exists() &&
            typeof userSnapDup.data()?.gold === "number" &&
            Number.isFinite(userSnapDup.data()?.gold as number)
              ? (userSnapDup.data()?.gold as number)
              : 0;

          const charStatsSnapDup = await tx.get(charStatsRef);
          const thDup = charStatsSnapDup.exists()
            ? (charStatsSnapDup.data()?.totalHandCount as number | undefined) ??
              0
            : 0;
          const twDup = charStatsSnapDup.exists()
            ? (charStatsSnapDup.data()?.totalWins as number | undefined) ?? 0
            : 0;
          const characterAverageHands = bayesianMeanHands(thDup, twDup);

          const data = existingRun.data() as {
            playerRatingAfter?: number;
            playerRatingBefore?: number;
            averageHandCount?: number;
            averageHandCountUsed?: number;
            storedHandCount?: number;
            weeklyResetApplied?: boolean;
          };
          const usedForElo =
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
            playerRatingBefore:
              data.playerRatingBefore ?? DEFAULT_INITIAL_RATING,
            eloActualScore: 0,
            averageHandCount: usedForElo,
            characterAverageHands,
            storedHandCount:
              typeof data.storedHandCount === "number"
                ? data.storedHandCount
                : storedHandCount,
            weeklyResetApplied: Boolean(data.weeklyResetApplied),
            guessCount,
            characterStatsUpdated: false,
            goldEarned: 0,
            goldTotal: goldTotalDup,
            lifetimeTierPromoted: false,
          };
        }

        const userSnap = await tx.get(userRef);
        const charStatsSnap = await tx.get(charStatsRef);

        const totalHandCount = charStatsSnap.exists()
          ? (charStatsSnap.data()?.totalHandCount as number | undefined) ?? 0
          : 0;
        const totalWins = charStatsSnap.exists()
          ? (charStatsSnap.data()?.totalWins as number | undefined) ?? 0
          : 0;

        const averageHandCount = bayesianMeanHands(totalHandCount, totalWins);

        const userData = userSnap.exists()
          ? (userSnap.data() as Record<string, unknown>)
          : undefined;

        let Rp = readSeasonRate(userData);
        const lifetimeTotal = readLifetimeTotal(userData);

        let weeklyResetApplied = false;
        if (userSnap.exists()) {
          const storedKey = userData?.ratingWeekKey as string | undefined;
          if (storedKey !== undefined && storedKey !== currentWeekKey) {
            Rp = DEFAULT_INITIAL_RATING;
            weeklyResetApplied = true;
          }
        }

        const gamesBefore = userSnap.exists()
          ? (userSnap.data()?.games as number | undefined) ?? 0
          : 0;

        const goldBefore =
          userSnap.exists() &&
          typeof userSnap.data()?.gold === "number" &&
          Number.isFinite(userSnap.data()?.gold as number)
            ? (userSnap.data()?.gold as number)
            : 0;

        let newRating: number;
        let ratingDelta: number;
        let eloActualScore: number;
        let eloExpected: number;
        let winBaseBonus: number | undefined;
        let winSpeedBonus: number | undefined;

        if (won) {
          const win = applyWinRatingBonus(
            Rp,
            averageHandCount,
            storedHandCount
          );
          newRating = win.newRating;
          ratingDelta = win.ratingDelta;
          winBaseBonus = win.baseBonus;
          winSpeedBonus = win.speedBonus;
          eloActualScore = 1;
          eloExpected = expectedScore(Rp, DEFAULT_INITIAL_RATING);
        } else {
          const loss = computeNewPlayerRating(Rp, 0);
          newRating = loss.newRating;
          ratingDelta = loss.ratingDelta;
          eloActualScore = loss.S;
          eloExpected = loss.E;
        }

        const gamesAfter = gamesBefore + 1;

        const goldEarned = goldEarnedFromRatingDelta(ratingDelta);
        const goldTotal = goldBefore + goldEarned;

        const newLifetimeTotal = clampRating(lifetimeTotal + ratingDelta);

        const lifetimeTierPromoted = isLifetimeTierOrRankPromoted(
          lifetimeTotal,
          newLifetimeTotal
        );
        const promotedToRankLabel = lifetimeTierPromoted
          ? formatRankTierLine(getRankData(newLifetimeTotal))
          : undefined;

        tx.set(
          userRef,
          {
            current_rate: newRating,
            lifetime_total_rate: newLifetimeTotal,
            rating: newRating,
            games: gamesAfter,
            displayName,
            ratingWeekKey: currentWeekKey,
            updatedAt: serverTimestamp(),
            ...(goldEarned > 0 ? { gold: increment(goldEarned) } : {}),
          },
          { merge: true }
        );

        tx.set(
          runRef,
          {
            uid,
            roundId,
            characterName,
            won,
            handCount: storedHandCount,
            guessCount,
            averageHandCountUsed: averageHandCount,
            eloActualScore,
            eloExpected,
            playerRatingBefore: Rp,
            playerRatingAfter: newRating,
            weeklyResetApplied,
            characterStatsUpdated: shouldIncrementCharacterStats,
            goldEarned,
            goldTotalAfter: goldTotal,
            ...(won
              ? {
                  winBaseBonus: winBaseBonus ?? 5,
                  winSpeedBonus: winSpeedBonus ?? 0,
                }
              : {}),
            createdAt: serverTimestamp(),
          },
          { merge: true }
        );

        {
          const charStatsPayload: Record<string, unknown> = {
            characterName,
            updatedAt: serverTimestamp(),
          };
          if (shouldIncrementCharacterStats) {
            charStatsPayload.totalHandCount = increment(statHandCountForCharacter);
            charStatsPayload.totalWins = increment(1);
          }
          tx.set(charStatsRef, charStatsPayload, { merge: true });
        }

        const newTotalHandCount =
          totalHandCount +
          (shouldIncrementCharacterStats ? statHandCountForCharacter : 0);
        const newTotalWins =
          totalWins + (shouldIncrementCharacterStats ? 1 : 0);
        const characterAverageHands = bayesianMeanHands(
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
          storedHandCount,
          weeklyResetApplied,
          guessCount,
          characterStatsUpdated: shouldIncrementCharacterStats,
          winBaseBonus,
          winSpeedBonus,
          goldEarned,
          goldTotal,
          lifetimeTierPromoted,
          promotedToRankLabel,
        };
      });
    });

    return NextResponse.json(result);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
