import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { isAdminUid } from "@/lib/adminUids";
import { getUidFromIdToken } from "@/lib/identityToolkit";

function verifyPasswordConstantTime(input: string, expected: string): boolean {
  const a = createHash("sha256").update(input, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

/**
 * 管理者 UID のみ。body: { idToken, password }
 * パスワードはサーバー環境変数 ADMIN_PANEL_PASSWORD のみ（クライアントに埋め込まない）
 */
export async function POST(req: Request) {
  const body = (await req.json()) as {
    idToken?: string;
    password?: string;
  };
  const idToken = body.idToken;
  const password =
    typeof body.password === "string" ? body.password : "";

  if (!idToken || typeof idToken !== "string") {
    return NextResponse.json(
      { ok: false, error: "idToken が必要です" },
      { status: 400 }
    );
  }

  const uid = await getUidFromIdToken(idToken);
  if (!uid || !isAdminUid(uid)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const expected = process.env.ADMIN_PANEL_PASSWORD ?? "";
  if (!expected) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "サーバーに ADMIN_PANEL_PASSWORD が未設定です（ホスティングの環境変数を確認）",
      },
      { status: 503 }
    );
  }

  if (!verifyPasswordConstantTime(password, expected)) {
    return NextResponse.json(
      { ok: false, error: "パスワードが違います" },
      { status: 401 }
    );
  }

  return NextResponse.json({ ok: true });
}
