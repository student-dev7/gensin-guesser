import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import { getUidFromIdToken } from "@/lib/identityToolkit";
import { isAdminUid } from "@/lib/adminUids";
import { DEFAULT_INITIAL_RATING } from "@/lib/rating";

export const runtime = "nodejs";

/**
 * 管理者のみ。全 `users` の current_rate / rating を初期値 1500 に揃え、
 * プレイ回数 `games` を 0 にする。
 * body: { idToken, pass } — pass は小大文字区別なしで `reset1500`
 */
export async function POST(req: Request) {
  const body = (await req.json()) as {
    idToken?: string;
    pass?: string;
  };
  const idToken = body.idToken;
  const passRaw = typeof body.pass === "string" ? body.pass.trim() : "";

  if (!idToken || typeof idToken !== "string") {
    return NextResponse.json(
      { ok: false, error: "idToken が必要です" },
      { status: 400 }
    );
  }

  if (passRaw.toLowerCase() !== "reset1500") {
    return NextResponse.json(
      {
        ok: false,
        error: "確認のため pass に「reset1500」と入力してください",
      },
      { status: 400 }
    );
  }

  const uid = await getUidFromIdToken(idToken);
  if (!uid || !isAdminUid(uid)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

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

  const r = DEFAULT_INITIAL_RATING;

  try {
    const snap = await db.collection("users").get();
    let batch = db.batch();
    let batchOps = 0;

    for (const docSnap of snap.docs) {
      batch.set(
        docSnap.ref,
        {
          current_rate: r,
          rating: r,
          games: 0,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      batchOps++;

      if (batchOps >= 500) {
        await batch.commit();
        batch = db.batch();
        batchOps = 0;
      }
    }

    if (batchOps > 0) {
      await batch.commit();
    }

    return NextResponse.json({
      ok: true,
      userCount: snap.size,
      rating: r,
      games: 0,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
