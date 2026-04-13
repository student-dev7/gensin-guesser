import { NextResponse } from "next/server";
import { deleteRoomDocumentsViaAdmin } from "@/lib/deleteRoomAdmin";
import { normalizeRoomCode, ROOM_CODE_LEN } from "@/lib/roomTypes";

/**
 * 開発環境（next dev）のみ。Firestore Admin 未設定時は 503。
 * 本番ビルドでは常に 403。
 */
export async function POST(req: Request) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json(
      { ok: false, error: "development only" },
      { status: 403 }
    );
  }

  let body: { roomId?: string };
  try {
    body = (await req.json()) as { roomId?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const raw = typeof body.roomId === "string" ? body.roomId : "";
  const roomId = normalizeRoomCode(raw);
  if (!roomId || roomId.length !== ROOM_CODE_LEN) {
    return NextResponse.json(
      { ok: false, error: "5桁の部屋番号を入力してください" },
      { status: 400 }
    );
  }

  try {
    await deleteRoomDocumentsViaAdmin(roomId);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 503 });
  }

  return NextResponse.json({ ok: true, roomId });
}
