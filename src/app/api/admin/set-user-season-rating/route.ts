import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import { getUidFromIdToken } from "@/lib/identityToolkit";
import { isAdminUid } from "@/lib/adminUids";
import { clampRating } from "@/lib/rating";
import { USER_FIELD_LEADERBOARD_RATING } from "@/lib/seasonLeaderboard";

export const runtime = "nodejs";

/**
 * 管理者のみ。任意 UID のシーズンレート（current_rate / rating）を上書きする。
 * body: { idToken, targetUid, rating, pass } — pass は小大文字区別なしで `setrate`
 */
export async function POST(req: Request) {
  const body = (await req.json()) as {
    idToken?: string;
    targetUid?: string;
    rating?: unknown;
    pass?: string;
  };

  const idToken = body.idToken;
  const targetUid =
    typeof body.targetUid === "string" ? body.targetUid.trim() : "";
  const passRaw = typeof body.pass === "string" ? body.pass.trim() : "";

  if (!idToken || typeof idToken !== "string") {
    return NextResponse.json(
      { ok: false, error: "idToken が必要です" },
      { status: 400 }
    );
  }
  if (!targetUid || targetUid.length < 5 || targetUid.length > 128) {
    return NextResponse.json(
      { ok: false, error: "targetUid が不正です" },
      { status: 400 }
    );
  }
  if (typeof body.rating !== "number" || !Number.isFinite(body.rating)) {
    return NextResponse.json(
      { ok: false, error: "rating は数値で指定してください" },
      { status: 400 }
    );
  }

  if (passRaw.toLowerCase() !== "setrate") {
    return NextResponse.json(
      {
        ok: false,
        error: "確認のため pass に「setrate」と入力してください",
      },
      { status: 400 }
    );
  }

  const uid = await getUidFromIdToken(idToken);
  if (!uid || !isAdminUid(uid)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const next = clampRating(body.rating);

  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "サーバーに FIREBASE_SERVICE_ACCOUNT_JSON が未設定です。Firebase コンソールのサービスアカウント鍵 JSON を 1 行で設定してください。",
      },
      { status: 503 }
    );
  }

  try {
    const ref = db.collection("users").doc(targetUid);
    await ref.set(
      {
        current_rate: next,
        rating: next,
        [USER_FIELD_LEADERBOARD_RATING]: next,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return NextResponse.json({
      ok: true,
      targetUid,
      rating: next,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
