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
  clampRating,
  computeFixedLossRating,
  DEFAULT_INITIAL_RATING,
} from "@/lib/rating";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import { getPublicFirestore } from "@/lib/firebasePublicFirestore";
import { withUserFirestore } from "@/lib/firebaseUserFirestore";
import { executeSubmitWithAdmin } from "./executeSubmitWithAdmin";
import { getUidFromIdToken } from "@/lib/identityToolkit";
import { goldEarnedFromRatingDelta } from "@/lib/gold";
import {
  formatRankTierLine,
  getRankData,
  isSeasonTierOrRankPromoted,
} from "@/lib/rankUtils";
import { isAdminUid } from "@/lib/adminUids";
import { USER_FIELD_NEXT_WIN_RATING_DOUBLE } from "@/lib/shop";
import { validateDisplayName } from "@/lib/validateDisplayName";
import { ROOM_UNLIMITED_GUESS_CAP } from "@/lib/roomTypes";
import {
  effectiveSeasonRateFromUserData,
  USER_FIELD_LEADERBOARD_RATING,
} from "@/lib/seasonLeaderboard";
import { getGrpcStatusCodeDeep } from "@/lib/grpcFirestoreErrors";

/**
 * Vercel の関数上限。`SUBMIT_INTERNAL_TIMEOUT_MS` より長くし、先に JSON で返せる余地を残す。
 */
export const maxDuration = 60;

/** プラットフォームが HTML タイムアウトを返す前に、こちらで JSON エラーを返す（ms） */
const SUBMIT_INTERNAL_TIMEOUT_MS = 50_000;

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
  /** 個人モード: シーズンレート・ゴールドは変えない */
  personalMode?: boolean;
  /**
   * このラウンドの予想回数上限（通常 7、ルーム無制限は最大 999）。
   * 未指定時は 7。
   */
  maxGuessCap?: number;
};

/** 降参・手数切れなど won:false の runs 記録用ペナルティ手数 */
const LOSS_RECORD_HANDS = 7;
const DEFAULT_MAX_GUESS_CAP = 7;
const GHOST_RUN_HAND_CAP = 7;
const MIN_GUESSES_TO_RESIGN = 4;

/** gRPC / Firestore の Error は message が壊れていることがあるため列挙でログする */
function logSubmitResultCaughtError(e: unknown): void {
  if (!(e instanceof Error)) {
    console.error("[submit-result] non-Error:", e);
    return;
  }
  const inferred = getGrpcStatusCodeDeep(e);
  const err = e as Error & {
    code?: unknown;
    details?: unknown;
    status?: unknown;
    statusCode?: unknown;
  };
  console.error("[submit-result] Firestore/gRPC error:", {
    name: err.name,
    message: err.message,
    code: err.code,
    inferredGrpcStatusCode: inferred,
    details: err.details,
    status: err.status ?? err.statusCode,
    stack: err.stack?.split("\n").slice(0, 10).join("\n"),
  });
  for (const k of Object.getOwnPropertyNames(e)) {
    if (k === "name" || k === "message" || k === "stack") continue;
    try {
      const v = (e as unknown as Record<string, unknown>)[k];
      if (typeof v === "function") continue;
      console.error(`[submit-result] error.${k}:`, v);
    } catch {
      /* ignore */
    }
  }
}

function messageFromSubmitResultError(e: unknown): string {
  if (e instanceof Error && e.message === "__SUBMIT_INTERNAL_TIMEOUT__") {
    return "サーバーがタイムアウトしました。しばらくしてからもう一度お試しください。";
  }
  if (e instanceof Error && e.message === "undefined undefined: undefined") {
    return "通信が中断されました。もう一度お試しください。";
  }
  if (e instanceof Error) {
    const any = e as Error & { code?: number | string };
    const codeNum =
      getGrpcStatusCodeDeep(e) ??
      (typeof any.code === "number"
        ? any.code
        : typeof any.code === "string"
          ? Number.parseInt(any.code, 10)
          : NaN);
    if (codeNum === 7) {
      return "Firestore に書き込めません（サービスアカウントの権限、またはプロジェクト ID の不一致を確認してください）";
    }
    if (codeNum === 5) {
      return "Firestore のデータが見つかりません（プロジェクト ID を確認してください）";
    }
    if (codeNum === 1) {
      return "通信が中断されました。もう一度お試しください。";
    }
    if (codeNum === 4 || codeNum === 14) {
      return "サーバーが混み合っています。しばらくしてからもう一度お試しください。";
    }
    if (codeNum === 10) {
      return "保存が競合しました。もう一度お試しください。";
    }
    if (
      typeof any.message === "string" &&
      any.message.length > 0 &&
      any.message !== "undefined undefined: undefined"
    ) {
      return any.message;
    }
  }
  return "サーバーで結果の保存に失敗しました";
}

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
    if (rounded < 1 || rounded > GHOST_RUN_HAND_CAP) return undefined;
    return rounded;
  } catch {
    return undefined;
  }
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

  const capRaw = (body as SubmitBody).maxGuessCap;
  let maxGuessCap = DEFAULT_MAX_GUESS_CAP;
  if (capRaw !== undefined) {
    if (typeof capRaw !== "number" || !Number.isFinite(capRaw)) {
      return NextResponse.json(
        { ok: false, error: "maxGuessCap が不正です" },
        { status: 400 }
      );
    }
    maxGuessCap = Math.round(capRaw);
    if (
      maxGuessCap < DEFAULT_MAX_GUESS_CAP ||
      maxGuessCap > ROOM_UNLIMITED_GUESS_CAP
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: `maxGuessCap は ${DEFAULT_MAX_GUESS_CAP}〜${ROOM_UNLIMITED_GUESS_CAP} で指定してください`,
        },
        { status: 400 }
      );
    }
  }

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
  if (guessCount < 0 || guessCount > maxGuessCap) {
    return NextResponse.json(
      { ok: false, error: "guessCount out of range" },
      { status: 400 }
    );
  }

  const lostToGhostClaim = body.lostToGhost === true;

  if (
    !won &&
    guessCount < MIN_GUESSES_TO_RESIGN &&
    guessCount !== maxGuessCap
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

  try {
    const result = await Promise.race([
      (async () => {
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

    const adminDb = getAdminFirestore();
    const submitParams = {
      uid,
      characterName,
      roundId,
      runRefId,
      displayName,
      won,
      guessCount,
      personalMode,
      ghostHc,
      storedHandCount,
      statHandCountForCharacter,
      shouldIncrementCharacterStats,
    };

    return adminDb
      ? await executeSubmitWithAdmin(adminDb, submitParams)
      : await withUserFirestore(idToken, async (db) => {
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
            playerRatingBefore:
              data.playerRatingBefore ?? DEFAULT_INITIAL_RATING,
            eloActualScore: 0,
            averageHandCount: usedForAverage,
            characterAverageHands,
            storedHandCount:
              typeof data.storedHandCount === "number"
                ? data.storedHandCount
                : storedHandCount,
            guessCount,
            characterStatsUpdated: false,
            goldEarned: 0,
            goldTotal: goldTotalDup,
            seasonTierPromoted: false,
            ratingDoubledApplied: false,
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

        const Rp = userData
          ? effectiveSeasonRateFromUserData(userData)
          : DEFAULT_INITIAL_RATING;

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
        /** ショップ「次回勝利レート2倍」を消費して勝ちに適用したか */
        let ratingDoubledApplied = false;
        /** Firestore 互換: 旧 Elo 名残。勝ち 1 / 負け・個人 0。期待値は未使用のため 0 */
        let eloActualScore: number;
        let eloExpected: number;
        let winBaseBonus: number | undefined;
        let winSpeedBonus: number | undefined;
        let ghostBeatBonus: number | undefined;

        if (personalMode) {
          newRating = Rp;
          ratingDelta = 0;
          eloActualScore = 0;
          eloExpected = 0;
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

        const goldEarned = personalMode
          ? 0
          : goldEarnedFromRatingDelta(ratingDelta);
        const goldTotal = goldBefore + goldEarned;

        const seasonTierPromoted =
          !personalMode && isSeasonTierOrRankPromoted(Rp, newRating);
        const promotedToRankLabel = seasonTierPromoted
          ? formatRankTierLine(getRankData(newRating))
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
          const consumedNextWinDouble =
            won && userData?.[USER_FIELD_NEXT_WIN_RATING_DOUBLE] === true;
          tx.set(
            userRef,
            {
              current_rate: newRating,
              rating: newRating,
              [USER_FIELD_LEADERBOARD_RATING]: newRating,
              games: gamesAfter,
              displayName,
              updatedAt: serverTimestamp(),
              ...(goldEarned > 0 ? { gold: increment(goldEarned) } : {}),
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
            characterStatsUpdated: shouldIncrementCharacterStats,
            goldEarned,
            goldTotalAfter: goldTotal,
            personalMode,
            ...(won && !personalMode
              ? {
                  winBaseBonus: winBaseBonus ?? 0,
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
          guessCount,
          characterStatsUpdated: shouldIncrementCharacterStats,
          winBaseBonus,
          winSpeedBonus,
          goldEarned,
          goldTotal,
          seasonTierPromoted,
          promotedToRankLabel,
          ratingDoubledApplied,
        };
      });
    });

      })(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("__SUBMIT_INTERNAL_TIMEOUT__")),
          SUBMIT_INTERNAL_TIMEOUT_MS
        )
      ),
    ]);

    return NextResponse.json(result);
  } catch (e: unknown) {
    logSubmitResultCaughtError(e);
    const message = messageFromSubmitResultError(e);
    const status =
      e instanceof Error && e.message === "__SUBMIT_INTERNAL_TIMEOUT__"
        ? 504
        : 500;
    return NextResponse.json(
      { ok: false, error: message },
      { status }
    );
  }
}
