import { deleteApp, initializeServerApp } from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getFirebaseWebConfig } from "./firebaseWebConfig";

/**
 * ユーザーの ID トークンに紐づく Firestore（セキュリティルールが request.auth に効く）。
 * リクエストごとに Server App を作り、終了時に deleteApp で解放する。
 */
export async function withUserFirestore<T>(
  idToken: string,
  fn: (db: Firestore) => Promise<T>
): Promise<T> {
  const config = getFirebaseWebConfig();
  const app = initializeServerApp(config, { authIdToken: idToken });
  try {
    const db = getFirestore(app);
    return await fn(db);
  } finally {
    await deleteApp(app);
  }
}
