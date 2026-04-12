import { NextResponse } from "next/server";
import {
  doc,
  getDoc,
  increment,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import {
  characterStatsDocId,
  DEFAULT_AVG_HANDS,
  pureMeanHandCount,
} from "@/lib/characterStats";
import {
  applyWinRatingBonus,
  clampLifetimeTotalRate,
  clampRating,
  computeNewPlayerRating,
  DEFAULT_INITIAL_RATING,
  expectedScore,
} from "@/lib/elo";
import { getPublicFirestore } from "@/lib/firebasePublicFirestore";
import { withUserFirestore } from "@/lib/firebaseUserFirestore";
import { getUidFromIdToken } from "@/lib/identityToolkit";
import { getRatingWeekMondayKeyJst } from "@/lib/ratingWeek";
import { goldEarnedFromRatingDelta } from "@/lib/gold";
import {
  formatRankTierLine,
  getRankData,
  isLifetimeTierOrRankPromoted,
} from "@/lib/rankUtils";
import { isAdminUid } from "@/lib/adminUids";
import { validateDisplayName } from "@/lib/validateDisplayName";

type SubmitBody = {
  idToken: string;
  won: boolean;
  handCount: number;
  guessCount: number;
  characterName: string;
  roundId: string;
  displayName: string;
  /** /api/get-ghost が返した runs のドキュメント ID（検証用） */
  ghostRunId?: string;
  /** ゴーストの手数に達しても未正解のときの即敗北（サーバーで ghost と照合） */
  lostToGhost?: boolean;
  /** 降参した場合 true（キャラ統計の手数は 7 手として計上） */
  surrendered?: boolean;
  /** 個人モード: 週次・累計レート・ゴールドは変えない */
  personalMode?: boolean;
};

/** 降参・手数切れなど won:false の runs 記録用ペナルティ手数 */
const LOSS_RECORD_HANDS = 7;
const MAX_GUESSES_ROUND = 7;
const MIN_GUESSES_TO_RESIGN = 4;

async function resolveGhostHandCount(
  characterName: string,
  ghostRunId: string | undefined
): Promise<number | undefined> {
  if (!ghostRunId) return undefined;
  const trimmed = ghostRunId.trim();
  if (trimmed.length < 5 || trimmed.length > 1900) return undefined;
  try {
    const db = getPublicFirestore();
    const snap = await getDoc(doc(db, "runs", trimmed));
    if (!snap.exists()) return undefined;
    const gd = snap.data() as Record<string, unknown>;
    if (gd.characterName !== characterName) return undefined;
    if (gd.won !== true) return undefined;
    const hc = gd.handCount;
    if (typeof hc !== "number" || !Number.isFinite(hc)) return undefined;
    const rounded = Math.round(hc);
    if (rounded < 1 || rounded > MAX_GUESSES_ROUND) return undefined;
    return rounded;
  } catch {
    return undefined;
  }
}

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
  if (typeof lt === "number" && Number.isFinite(lt)) return clampLifetimeTotalRate(lt);
  const legacy = data.rating;
  if (typeof legacy === "number" && Number.isFinite(legacy)) {
    return clampLifetimeTotalRate(legacy);
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
    ghostRunId: rawGhostRunId,
  } = body ?? ({} as SubmitBody);

  const surrendered = body.surrendered === true;
  const personalMode = body.personalMode === true;

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

  const lostToGhostClaim = body.lostToGhost === true;

  if (
    !won &&
    guessCount < MIN_GUESSES_TO_RESIGN &&
    guessCount !== MAX_GUESSES_ROUND
  ) {
    if (!lostToGhostClaim) {
      return NextResponse.json(
        {
          ok: false,
          error: "降参は4回以上予想してから可能です（手数切れを除く）",
        },
        { status: 400 }
      );
    }
  }

  if (won && Math.round(rawHandCount) !== guessCount) {
    return NextResponse.json(
      { ok: false, error: "handCount and guessCount must match when won" },
      { status: 400 }
    );
  }

  if (surrendered && won) {
    return NextResponse.json(
      { ok: false, error: "surrendered cannot be true when won" },
      { status: 400 }
    );
  }

  if (
    personalMode &&
    (lostToGhostClaim ||
      (typeof rawGhostRunId === "string" && rawGhostRunId.trim().length > 0))
  ) {
    return NextResponse.json(
      { ok: false, error: "personalMode はゴーストと併用できません" },
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

  const uid = await getUidFromIdToken(idToken);
  if (!uid) {
    return NextResponse.json(
      { ok: false, error: "Invalid or expired idToken" },
      { status: 401 }
    );
  }

  const nameCheck = validateDisplayName(
    typeof rawDisplayName === "string" ? rawDisplayName : "",
    { ignoreBadSubstrings: isAdminUid(uid) }
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
    const ghostHc = personalMode
      ? undefined
      : await resolveGhostHandCount(
          characterName,
          typeof rawGhostRunId === "string" ? rawGhostRunId : undefined
        );

    if (lostToGhostClaim) {
      if (
        typeof rawGhostRunId !== "string" ||
        !rawGhostRunId.trim() ||
        ghostHc === undefined ||
        won ||
        guessCount <= ghostHc
      ) {
        return NextResponse.json(
          { ok: false, error: "Invalid lostToGhost" },
          { status: 400 }
        );
      }
    }

    const storedHandCount = won ? Math.max(1, rawHandCount) : LOSS_RECORD_HANDS;
    /** キャラ別平均: 勝ちは実手数、降参は 7 手、他の負けは実際の予想回数（勝敗・敗北種別すべて集計） */
    const statHandCountForCharacter = won
      ? Math.max(1, Math.round(rawHandCount))
      : surrendered
        ? LOSS_RECORD_HANDS
        : guessCount;
    const shouldIncrementCharacterStats = true;

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
          const characterAverageHands = pureMeanHandCount(thDup, twDup);

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

        const averageHandCount = pureMeanHandCount(totalHandCount, totalWins);

        const userData = userSnap.exists()
          ? (userSnap.data() as Record<string, unknown>)
          : undefined;

        let Rp = readSeasonRate(userData);
        const lifetimeTotal = readLifetimeTotal(userData);

        let weeklyResetApplied = false;
        if (!personalMode && userSnap.exists()) {
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
        let ghostBeatBonus: number | undefined;

        if (personalMode) {
          newRating = Rp;
          ratingDelta = 0;
          eloActualScore = 0;
          eloExpected = expectedScore(Rp, DEFAULT_INITIAL_RATING);
          winBaseBonus = undefined;
          winSpeedBonus = undefined;
          ghostBeatBonus = undefined;
        } else if (won) {
          const win = applyWinRatingBonus(
            Rp,
            averageHandCount,
            storedHandCount,
            ghostHc !== undefined
              ? { ghostHandCount: ghostHc }
              : undefined
          );
          newRating = win.newRating;
          ratingDelta = win.ratingDelta;
          winBaseBonus = win.baseBonus;
          winSpeedBonus = win.speedBonus;
          ghostBeatBonus = win.ghostBeatBonus;
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

        const goldEarned = personalMode
          ? 0
          : goldEarnedFromRatingDelta(ratingDelta);
        const goldTotal = goldBefore + goldEarned;

        /** 累計は減らさない（負け・減点時は週次のみ反映）。個人モードは累計も変えない */
        const newLifetimeTotal = personalMode
          ? lifetimeTotal
          : clampLifetimeTotalRate(
              lifetimeTotal + Math.max(0, ratingDelta)
            );

        const lifetimeTierPromoted =
          !personalMode &&
          isLifetimeTierOrRankPromoted(lifetimeTotal, newLifetimeTotal);
        const promotedToRankLabel = lifetimeTierPromoted
          ? formatRankTierLine(getRankData(newLifetimeTotal))
          : undefined;

        if (personalMode) {
          tx.set(
            userRef,
            {
              displayName,
              games: gamesAfter,
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        } else {
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
        }

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
            personalMode,
            ...(won && !personalMode
              ? {
                  winBaseBonus: winBaseBonus ?? 6,
                  winSpeedBonus: winSpeedBonus ?? 0,
                  ghostBeatBonus: ghostBeatBonus ?? 0,
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
