import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
} from "firebase/firestore";
import { NextResponse } from "next/server";
import { getPublicFirestore } from "@/lib/firebasePublicFirestore";

const RUNS_SAMPLE_LIMIT = 200;
/** 1〜2 手正解の記録はゴーストに使わない */
const MIN_GHOST_WIN_HANDS = 3;

function fallbackName(uid: string) {
  return `GenshinUser_${uid.slice(0, 8)}`;
}

/**
 * 指定キャラの過去の勝ち run から1件ランダム取得し、表示名（users）と手数を返す。
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const characterName = url.searchParams.get("characterName")?.trim() ?? "";

  if (!characterName || characterName.length > 200) {
    return NextResponse.json(
      { ok: false, error: "Missing or invalid characterName" },
      { status: 400 }
    );
  }

  try {
    const db = getPublicFirestore();
    const q = query(
      collection(db, "runs"),
      where("characterName", "==", characterName),
      limit(RUNS_SAMPLE_LIMIT)
    );
    const snap = await getDocs(q);
    const winDocs = snap.docs.filter((d) => {
      const w = d.data() as { won?: unknown; handCount?: unknown };
      if (w.won !== true) return false;
      const hc =
        typeof w.handCount === "number" && Number.isFinite(w.handCount)
          ? Math.round(w.handCount)
          : 0;
      return hc >= MIN_GHOST_WIN_HANDS;
    });
    if (winDocs.length === 0) {
      return NextResponse.json({ ok: true, ghost: null });
    }

    const pick = winDocs[Math.floor(Math.random() * winDocs.length)]!;
    const data = pick.data() as {
      uid?: unknown;
      handCount?: unknown;
    };
    const uid = typeof data.uid === "string" ? data.uid : "";
    const handCount =
      typeof data.handCount === "number" &&
      Number.isFinite(data.handCount) &&
      data.handCount >= 1
        ? Math.round(data.handCount)
        : null;
    if (!uid || handCount === null) {
      return NextResponse.json({ ok: true, ghost: null });
    }

    let displayName = fallbackName(uid);
    const userSnap = await getDoc(doc(db, "users", uid));
    if (userSnap.exists()) {
      const ud = userSnap.data() as { displayName?: unknown };
      if (
        typeof ud.displayName === "string" &&
        ud.displayName.trim().length > 0
      ) {
        displayName = ud.displayName.trim();
      }
    }

    return NextResponse.json({
      ok: true,
      ghost: {
        ghostRunId: pick.id,
        displayName,
        handCount,
      },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
