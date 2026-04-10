import { deleteApp, initializeServerApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getFirebaseWebConfig } from "./firebaseWebConfig";

/**
 * ユーザーの ID トークンに紐づく Firestore（セキュリティルールが request.auth に効く）。
 * FirebaseServerApp では getAuth を初期化しないと ID トークンからセッションが復元されず、
 * Firestore が未認証扱いになりルールで PERMISSION_DENIED になる。
 * リクエストごとに Server App を作り、終了時に deleteApp で解放する。
 */
export async function withUserFirestore<T>(
  idToken: string,
  fn: (db: Firestore) => Promise<T>
): Promise<T> {
  const config = getFirebaseWebConfig();
  const app = initializeServerApp(config, { authIdToken: idToken });
  try {
    const auth = getAuth(app);
    await auth.authStateReady();
    if (!auth.currentUser) {
      throw new Error(
        "Firebase Auth did not restore the session from the ID token"
      );
    }
    const db = getFirestore(app);
    return await fn(db);
  } finally {
    await deleteApp(app);
  }
}
