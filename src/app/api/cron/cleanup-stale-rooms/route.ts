import { NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import { Timestamp } from "firebase-admin/firestore";

/** 最終活動からこれ以上経過したルームを削除対象に（デフォルト 7 日） */
const STALE_MS =
  Number(process.env.ROOM_STALE_AFTER_MS) > 0
    ? Number(process.env.ROOM_STALE_AFTER_MS)
    : 7 * 24 * 60 * 60 * 1000;

/** 試合が一度も開始されないまま、作成からこれ以上経過したルームを削除（デフォルト 10 分。5 分にしたい場合は 300000） */
const LOBBY_NO_MATCH_MS =
  Number(process.env.ROOM_LOBBY_NO_MATCH_MS) > 0
    ? Number(process.env.ROOM_LOBBY_NO_MATCH_MS)
    : 10 * 60 * 1000;

function verifyCronAuth(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth === `Bearer ${secret}`) return true;
  }
  // ローカル検証用（本番では CRON_SECRET 推奨）
  if (process.env.NODE_ENV === "development") {
    return req.headers.get("x-dev-cron") === "1";
  }
  return false;
}

async function deleteRoomAdmin(roomId: string): Promise<void> {
  const db = getAdminFirestore();
  if (!db) throw new Error("no admin firestore");
  const pres = await db.collection("rooms").doc(roomId).collection("presence").get();
  let batch = db.batch();
  let n = 0;
  for (const d of pres.docs) {
    batch.delete(d.ref);
    n++;
    if (n >= 450) {
      await batch.commit();
      batch = db.batch();
      n = 0;
    }
  }
  batch.delete(db.collection("rooms").doc(roomId));
  await batch.commit();
}

/**
 * 古いルームを削除（lastActivityAt がしきい値より古いもの）。
 * Vercel Cron: Authorization: Bearer CRON_SECRET
 */
export async function GET(req: Request) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
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

  const cutoff = Timestamp.fromMillis(Date.now() - STALE_MS);
  const snap = await db
    .collection("rooms")
    .where("lastActivityAt", "<", cutoff)
    .limit(30)
    .get();

  let deleted = 0;
  const errors: string[] = [];
  for (const d of snap.docs) {
    try {
      await deleteRoomAdmin(d.id);
      deleted++;
    } catch (e: unknown) {
      errors.push(
        `${d.id}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  /** 試合未開始のまま古いロビールームを掃除 */
  const lobbyCutoff = Timestamp.fromMillis(Date.now() - LOBBY_NO_MATCH_MS);
  const lobbySnap = await db
    .collection("rooms")
    .where("createdAt", "<", lobbyCutoff)
    .limit(40)
    .get();

  let deletedLobbyNoMatch = 0;
  for (const d of lobbySnap.docs) {
    const data = d.data() as { matchStarted?: boolean };
    if (data.matchStarted === true) continue;
    try {
      await deleteRoomAdmin(d.id);
      deletedLobbyNoMatch++;
    } catch (e: unknown) {
      errors.push(
        `${d.id} (lobby): ${e instanceof Error ? e.message : String(e)}`
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
