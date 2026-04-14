import type { FirebaseApp } from "firebase/app";
import {
  getFirestore,
  initializeFirestore,
  type Firestore,
} from "firebase/firestore";

const cache = new WeakMap<FirebaseApp, Firestore>();

/**
 * Firestore を1アプリにつき1回だけ初期化する。
 * `experimentalAutoDetectLongPolling` はプロキシ・企業ネット・一部ブラウザで WebChannel が不安定なときの接続失敗を減らす（Firebase 推奨の緩和策）。
 */
export function getFirestoreForApp(app: FirebaseApp): Firestore {
  let db = cache.get(app);
  if (db) return db;
  try {
    db = initializeFirestore(app, {
      // 自動検出より強い指定。WebChannel/gRPC ストリームが通らない環境向け（帯域はやや増える）
      experimentalForceLongPolling: true,
    });
  } catch {
    db = getFirestore(app);
  }
  cache.set(app, db);
  return db;
}
