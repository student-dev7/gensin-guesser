import { NextResponse } from "next/server";
import { deleteRoomDocumentsViaAdmin } from "@/lib/deleteRoomAdmin";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import { Timestamp } from "firebase-admin/firestore";

export const dynamic = "force-dynamic";

/** 最終活動からこれ以上経過したルームを削除対象に（デフォルト 7 日） */
const STALE_MS =
  Number(process.env.ROOM_STALE_AFTER_MS) > 0
    ? Number(process.env.ROOM_STALE_AFTER_MS)
    : 7 * 24 * 60 * 60 * 1000;

/**
 * 試合未開始のまま「最終活動」からこれ以上経過したルームを削除（デフォルト 5 分）。
 * ホストのハートビートで lastActivityAt が更新されるため、全員退出・ホストが閉じたあとに効く。
 * 変更は ROOM_LOBBY_NO_MATCH_MS（ミリ秒）。
 */
const LOBBY_NO_MATCH_MS =
  Number(process.env.ROOM_LOBBY_NO_MATCH_MS) > 0
    ? Number(process.env.ROOM_LOBBY_NO_MATCH_MS)
    : 5 * 60 * 1000;

function verifyCronAuth(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth === `Bearer ${secret}`) return true;
    return false;
  }
  // ローカル検証用（本番では CRON_SECRET 必須）
  if (process.env.NODE_ENV === "development") {
    return req.headers.get("x-dev-cron") === "1";
  }
  return false;
}

/**
 * 古いルームを削除。
 * Vercel Cron: Authorization: Bearer CRON_SECRET（未設定だと本番では常に 401）
 *
 * 注意: Vercel Hobby は cron が「1 日 1 回まで」。5 分おきのスケジュールは Hobby ではデプロイ不可。
 * 短い間隔で消したい場合は Pro 以上で cron が実際に走る必要がある（Hobby は 1 日 1 回まで）。
 */
export async function GET(req: Request) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json(
      {
        ok: false,
        error: "unauthorized",
        hint:
          "本番では環境変数 CRON_SECRET を設定し、Vercel が Authorization: Bearer で送る値と一致させてください。",
      },
      { status: 401 }
    );
  }

  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json(
      {
        ok: false,
        error: "FIREBASE_SERVICE_ACCOUNT_JSON が未設定です",
      },
      { status: 503 }
    );
  }

  const errors: string[] = [];

  /** 先に「短期放置ロビー」を処理（ホストの lastActivityAt が止まったあと） */
  const lobbyCutoff = Timestamp.fromMillis(Date.now() - LOBBY_NO_MATCH_MS);
  const lobbySnap = await db
    .collection("rooms")
    .where("lastActivityAt", "<", lobbyCutoff)
    .orderBy("lastActivityAt", "asc")
    .limit(200)
    .get();

  let deletedLobbyNoMatch = 0;
  for (const d of lobbySnap.docs) {
    const data = d.data() as { matchStarted?: boolean };
    if (data.matchStarted === true) continue;
    try {
      await deleteRoomDocumentsViaAdmin(d.id);
      deletedLobbyNoMatch++;
    } catch (e: unknown) {
      errors.push(
        `${d.id} (lobby): ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  /** 長期放置（試合中も含む） */
  const cutoff = Timestamp.fromMillis(Date.now() - STALE_MS);
  const snap = await db
    .collection("rooms")
    .where("lastActivityAt", "<", cutoff)
    .orderBy("lastActivityAt", "asc")
    .limit(100)
    .get();

  let deleted = 0;
  for (const d of snap.docs) {
    try {
      await deleteRoomDocumentsViaAdmin(d.id);
      deleted++;
    } catch (e: unknown) {
      errors.push(
        `${d.id}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  return NextResponse.json({
    ok: true,
    deleted,
    scanned: snap.size,
    staleAfterMs: STALE_MS,
    deletedLobbyNoMatch,
    scannedLobbyNoMatch: lobbySnap.size,
    lobbyNoMatchAfterMs: LOBBY_NO_MATCH_MS,
    errors: errors.length ? errors : undefined,
  });
}
