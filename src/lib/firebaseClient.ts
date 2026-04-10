"use client";

import { FirebaseApp, getApps, initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  getAuth,
  setPersistence,
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
 * ブラウザを閉じてもセッションを維持する（IndexedDB / localStorage）。
 * signIn より前に await すること。
 */
export async function ensureFirebaseAuthPersistence(): Promise<void> {
  const auth = getAuth(ensureApp());
  cachedAuth = auth;
  if (!persistencePromise) {
    persistencePromise = setPersistence(auth, browserLocalPersistence).catch(
      (err) => {
        persistencePromise = null;
        throw err;
      }
    );
  }
  await persistencePromise;
}

export function getFirebaseAuth(): Auth {
  if (!cachedAuth) {
    cachedAuth = getAuth(ensureApp());
  }
  return cachedAuth;
}
