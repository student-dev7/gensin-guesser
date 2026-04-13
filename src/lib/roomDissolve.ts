import {
  collection,
  doc,
  getDocs,
  writeBatch,
  type Firestore,
} from "firebase/firestore";

/** presence をすべて消してから rooms ドキュメントを削除（500件バッチ制限対応） */
export async function dissolveRoomClient(
  db: Firestore,
  roomId: string
): Promise<void> {
  const presSnap = await getDocs(collection(db, "rooms", roomId, "presence"));
  const roomRef = doc(db, "rooms", roomId);
  let batch = writeBatch(db);
  let ops = 0;
  for (const d of presSnap.docs) {
    batch.delete(d.ref);
    ops++;
    if (ops >= 450) {
      await batch.commit();
      batch = writeBatch(db);
      ops = 0;
    }
  }
  batch.delete(roomRef);
  ops++;
  if (ops > 0) {
    await batch.commit();
  }
}
