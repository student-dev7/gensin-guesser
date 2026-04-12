import {
  doc,
  increment,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import { NextResponse } from "next/server";
import {
  NEXT_WIN_RATING_DOUBLE_COST_GOLD,
  USER_FIELD_NEXT_WIN_RATING_DOUBLE,
} from "@/lib/shop";
import { getUidFromIdToken } from "@/lib/identityToolkit";
import { withUserFirestore } from "@/lib/firebaseUserFirestore";

type Body = {
  idToken?: string;
};

export async function POST(req: Request) {
  const body = (await req.json()) as Body;
  const idToken = body.idToken;

  if (!idToken || typeof idToken !== "string") {
    return NextResponse.json(
      { ok: false, error: "idToken が必要です" },
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

  const cost = NEXT_WIN_RATING_DOUBLE_COST_GOLD;

  try {
    const result = await withUserFirestore(idToken, async (db) => {
      const userRef = doc(db, "users", uid);

      return runTransaction(db, async (tx) => {
        const snap = await tx.get(userRef);
        if (!snap.exists()) {
          return { ok: false as const, error: "ユーザーが見つかりません" };
        }
        const d = snap.data() as Record<string, unknown>;
        const goldRaw = d.gold;
        const gold =
          typeof goldRaw === "number" && Number.isFinite(goldRaw)
            ? goldRaw
            : 0;
        if (gold < cost) {
          return {
            ok: false as const,
            error: `ゴールドが足りません（必要 ${cost}）`,
          };
        }
        if (d[USER_FIELD_NEXT_WIN_RATING_DOUBLE] === true) {
          return {
            ok: false as const,
            error: "すでに次回勝利2倍バフを所持しています",
          };
        }

        tx.set(
          userRef,
          {
            gold: increment(-cost),
            [USER_FIELD_NEXT_WIN_RATING_DOUBLE]: true,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );

        return {
          ok: true as const,
          goldAfter: gold - cost,
        };
      });
    });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      gold: result.goldAfter,
      cost,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
