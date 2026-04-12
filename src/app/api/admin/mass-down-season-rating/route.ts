import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import { getUidFromIdToken } from "@/lib/identityToolkit";
import { isAdminUid } from "@/lib/adminUids";
import { clampRating, DEFAULT_INITIAL_RATING } from "@/lib/rating";
import { RANK_TIER_WIDTH_PT } from "@/lib/rankUtils";

export const runtime = "nodejs";

/** 全ユーザーの表示ランクを約 1.5 段（6 ティア）下げる */
const TIER_STEPS_DOWN = 6;

function readSeasonFromUserData(data: Record<string, unknown>): number {
  const cr = data.current_rate;
  if (typeof cr === "number" && Number.isFinite(cr)) return clampRating(cr);
  const r = data.rating;
  if (typeof r === "number" && Number.isFinite(r)) return clampRating(r);
  return DEFAULT_INITIAL_RATING;
}

/**
 * 管理者のみ。全 `users` のシーズンレートを 6 ティア分（125×6 pt）減らす。
 * body: { idToken, pass } — pass は小大文字区別なしで `down` であること。
 * 要: 環境変数 FIREBASE_SERVICE_ACCOUNT_JSON（サービスアカウント鍵の JSON）
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

  if (passRaw.toLowerCase() !== "down") {
    return NextResponse.json(
      { ok: false, error: "確認のため pass に「down」と入力してください" },
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

  const delta = TIER_STEPS_DOWN * RANK_TIER_WIDTH_PT;

  try {
    const snap = await db.collection("users").get();
    let batch = db.batch();
    let batchOps = 0;

    for (const docSnap of snap.docs) {
      const data = docSnap.data() as Record<string, unknown>;
      const cur = readSeasonFromUserData(data);
      const next = clampRating(cur - delta);

      batch.set(
        docSnap.ref,
        {
          current_rate: next,
          rating: next,
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
      deltaPoints: -delta,
      tierStepsDown: TIER_STEPS_DOWN,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
