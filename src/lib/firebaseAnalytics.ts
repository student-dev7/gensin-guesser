"use client";

import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import type { Analytics } from "firebase/analytics";
import { getFirebaseWebConfig } from "./firebaseWebConfig";

let cachedAnalytics: Analytics | null | undefined;

function getOrCreateApp(): FirebaseApp {
  const cfg = getFirebaseWebConfig();
  if (getApps().length > 0) {
    return getApps()[0]!;
  }
  return initializeApp(cfg);
}

/**
 * Firebase Analytics（ブラウザのみ・measurementId 必須）。
 * 未対応環境や ID 未設定時は null。
 */
export async function getFirebaseAnalytics(): Promise<Analytics | null> {
  if (typeof window === "undefined") return null;
  if (cachedAnalytics !== undefined) return cachedAnalytics;

  const cfg = getFirebaseWebConfig();
  if (!cfg.measurementId) {
    cachedAnalytics = null;
    return null;
  }

  try {
    const { isSupported, getAnalytics } = await import("firebase/analytics");
    const ok = await isSupported();
    if (!ok) {
      cachedAnalytics = null;
      return null;
    }
    const app = getOrCreateApp();
    cachedAnalytics = getAnalytics(app);
    return cachedAnalytics;
  } catch {
    cachedAnalytics = null;
    return null;
  }
}

/** アプリ起動時に一度だけ呼ぶ（レイアウトのクライアントコンポーネントから） */
export async function initFirebaseAnalytics(): Promise<void> {
  await getFirebaseAnalytics();
}

export async function logAnalyticsEvent(
  name: string,
  params?: { [key: string]: string | number | boolean }
): Promise<void> {
  const analytics = await getFirebaseAnalytics();
  if (!analytics) return;
  const { logEvent } = await import("firebase/analytics");
  logEvent(analytics, name, params);
}
