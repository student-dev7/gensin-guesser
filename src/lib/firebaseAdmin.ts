import { cert, getApps, initializeApp, type App, type ServiceAccount } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

let adminApp: App | null | undefined;

/**
 * サービスアカウント JSON（1 行の JSON 文字列）を FIREBASE_SERVICE_ACCOUNT_JSON に設定。
 * 未設定時は null（管理者のみ API が 503 を返す）。
 */
function getServiceAccountJson(): ServiceAccount | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ServiceAccount;
  } catch {
    return null;
  }
}

export function getFirebaseAdminApp(): App | null {
  if (adminApp !== undefined) return adminApp;
  const svc = getServiceAccountJson();
  if (!svc) {
    adminApp = null;
    return null;
  }
  if (getApps().length > 0) {
    adminApp = getApps()[0]!;
    return adminApp;
  }
  adminApp = initializeApp({
    credential: cert(svc),
  });
  return adminApp;
}

export function getAdminFirestore(): Firestore | null {
  const app = getFirebaseAdminApp();
  if (!app) return null;
  return getFirestore(app);
}
