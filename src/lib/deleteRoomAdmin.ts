import { getAdminFirestore } from "@/lib/firebaseAdmin";

/** Admin SDK で presence を消してから rooms ドキュメントを削除（Cron / 開発用 API と共通） */
export async function deleteRoomDocumentsViaAdmin(roomId: string): Promise<void> {
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
