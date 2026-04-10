"use client";

import { FirebaseApp, getApps, initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  getAuth,
  indexedDBLocalPersistence,
  setPersistence,
  signInAnonymously,
  type Auth,
} from "firebase/auth";
import { getFirebaseWebConfig } from "./firebaseWebConfig";

let cachedAuth: Auth | null = null;
let persistencePromise: Promise<void> | null = null;

function ensureApp(): FirebaseApp {
  const firebaseConfig = getFirebaseWebConfig();
  if (getApps().length === 0) {
    return initializeApp(firebaseConfig);
  }
  return getApps()[0]!;
}

/**
 * ブラウザを閉じてもセッションを維持する。
 * IndexedDB は localStorage よりタスクキル・再起動後も残りやすい。
 * signIn より前に await すること。
 */
export async function ensureFirebaseAuthPersistence(): Promise<void> {
  const auth = getAuth(ensureApp());
  cachedAuth = auth;
  if (!persistencePromise) {
    persistencePromise = (async () => {
      try {
        await setPersistence(auth, indexedDBLocalPersistence);
      } catch {
        await setPersistence(auth, browserLocalPersistence);
      }
    })().catch((err) => {
      persistencePromise = null;
      throw err;
    });
  }
  await persistencePromise;
}

/**
 * 永続化を確定したうえで匿名ユーザーを復元または新規作成する。
 * 初回サインインをゲーム終了まで待たない（タスクキル前に UID がストアに載る）。
 */
export async function ensureAnonymousSession(): Promise<void> {
  await ensureFirebaseAuthPersistence();
  const auth = getFirebaseAuth();
  if (!auth.currentUser) {
    await signInAnonymously(auth);
  }
}

export function getFirebaseAuth(): Auth {
  if (!cachedAuth) {
    cachedAuth = getAuth(ensureApp());
  }
  return cachedAuth;
}
