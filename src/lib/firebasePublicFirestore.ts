import { type FirebaseApp, getApp, initializeApp } from "firebase/app";
import type { Firestore } from "firebase/firestore";
import { getFirestoreForApp } from "./firestoreForApp";
import { getFirebaseWebConfig } from "./firebaseWebConfig";

const PUBLIC_APP_NAME = "genshin-guesser-public-read";

let cached: Firestore | null = null;

/**
 * 未ログインのサーバー側読み取り（ランキング用）。
 * Firestore ルールで users の read を許可している必要がある。
 */
export function getPublicFirestore(): Firestore {
  if (cached) {
    return cached;
  }
  const config = getFirebaseWebConfig();
  let app: FirebaseApp;
  try {
    app = getApp(PUBLIC_APP_NAME);
  } catch {
    app = initializeApp(config, PUBLIC_APP_NAME);
  }
  cached = getFirestoreForApp(app);
  return cached;
}
