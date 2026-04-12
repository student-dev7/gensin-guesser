import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { NextResponse } from "next/server";
import { DEFAULT_INITIAL_RATING } from "@/lib/elo";
import { getUidFromIdToken } from "@/lib/identityToolkit";
import { getRatingWeekMondayKeyJst } from "@/lib/ratingWeek";
import { withUserFirestore } from "@/lib/firebaseUserFirestore";

type Body = {
  idToken: string;
  /** 確認用。小文字の quit のみ受理 */
  confirm: string;
};

export async function POST(req: Request) {
  const body = (await req.json()) as Body;
  const { idToken, confirm } = body ?? {};

  if (!idToken || typeof idToken !== "string") {
    return NextResponse.json(
      { ok: false, error: "Missing idToken" },
      { status: 400 }
    );
  }
  if (typeof confirm !== "string" || confirm.trim().toLowerCase() !== "quit") {
    return NextResponse.json(
      { ok: false, error: '確認のため「quit」と入力してください' },
      { status: 400 }
    );
  }

  try {
    const uid = await getUidFromIdToken(idToken);
    if (!uid) {
      return NextResponse.json(
        { ok: false, error: "Invalid or expired idToken" },
        { status: 401 }
      );
    }

    const weekKey = getRatingWeekMondayKeyJst();

    await withUserFirestore(idToken, async (db) => {
      const userRef = doc(db, "users", uid);
      await setDoc(
        userRef,
        {
          current_rate: DEFAULT_INITIAL_RATING,
          rating: DEFAULT_INITIAL_RATING,
          ratingWeekKey: weekKey,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    });

    return NextResponse.json({
      ok: true,
      rating: DEFAULT_INITIAL_RATING,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
