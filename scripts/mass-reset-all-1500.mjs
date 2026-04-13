/**
 * 全 users のシーズンレートを 1500 に揃え、プレイ回数 games を 0 にする（管理者 API と同じ処理・ローカル用）。
 *   node scripts/mass-reset-all-1500.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const DEFAULT_INITIAL_RATING = 1500;

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnvFile(rel) {
  const p = resolve(__dirname, rel);
  if (!existsSync(p)) return;
  const raw = readFileSync(p, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFile("../.env.local");
loadEnvFile("../.env");

function resolveServiceAccountJson() {
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (inline) return inline;
  const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH?.trim();
  if (keyPath) {
    const abs = resolve(__dirname, "..", keyPath);
    const alt = resolve(keyPath);
    const p = existsSync(abs) ? abs : existsSync(alt) ? alt : null;
    if (!p) {
      console.error(
        "FIREBASE_SERVICE_ACCOUNT_KEY_PATH のファイルが見つかりません:",
        keyPath
      );
      process.exit(1);
    }
    return readFileSync(p, "utf8");
  }
  return null;
}

const rawJson = resolveServiceAccountJson();
if (!rawJson) {
  console.error(
    "FIREBASE_SERVICE_ACCOUNT_JSON または FIREBASE_SERVICE_ACCOUNT_KEY_PATH を設定してください。"
  );
  process.exit(1);
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(rawJson);
} catch {
  console.error("サービスアカウント JSON が不正です。");
  process.exit(1);
}

if (getApps().length === 0) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();
const r = DEFAULT_INITIAL_RATING;

const snap = await db.collection("users").get();
let batch = db.batch();
let batchOps = 0;

for (const docSnap of snap.docs) {
  batch.set(
    docSnap.ref,
    {
      current_rate: r,
      rating: r,
      games: 0,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  batchOps++;

  if (batchOps >= 500) {
    await batch.commit();
    batch = db.batch();
    batchOps = 0;
  }
}

if (batchOps > 0) {
  await batch.commit();
}

console.log(
  JSON.stringify(
    { ok: true, userCount: snap.size, rating: r, games: 0 },
    null,
    2
  )
);
