/**
 * 全 users に `leaderboard_rating` を埋める（既存の current_rate / rating から実効レートを計算）。
 * ランキングの orderBy クエリが動くようにする。初回デプロイ後に 1 回実行。
 *
 *   npm run backfill:leaderboard-rating
 *
 * 要: .env.local の FIREBASE_SERVICE_ACCOUNT_JSON（または KEY_PATH）
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const __dirname = dirname(fileURLToPath(import.meta.url));

const LEADERBOARD_RATING_FIELD = "leaderboard_rating";

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

const MIN_RATING = 1500;
const MAX_RATING = 100000;
const DEFAULT_INITIAL_RATING = 1500;

function clampRating(rating) {
  return Math.max(MIN_RATING, Math.min(MAX_RATING, rating));
}

/** seasonLeaderboard.effectiveSeasonRateFromUserData と同じ */
function effectiveSeasonRateFromUserData(data) {
  const r = data.rating;
  const cr = data.current_rate;
  const a =
    typeof r === "number" && Number.isFinite(r) ? clampRating(r) : null;
  const b =
    typeof cr === "number" && Number.isFinite(cr) ? clampRating(cr) : null;
  if (a != null && b != null) return Math.max(a, b);
  if (a != null) return a;
  if (b != null) return b;
  return DEFAULT_INITIAL_RATING;
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
  console.error("FIREBASE_SERVICE_ACCOUNT_JSON の JSON が不正です。");
  process.exit(1);
}

if (getApps().length === 0) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();

const snap = await db.collection("users").get();
let batch = db.batch();
let batchOps = 0;
let updated = 0;

for (const docSnap of snap.docs) {
  const data = docSnap.data();
  const lr = effectiveSeasonRateFromUserData(data);
  batch.set(
    docSnap.ref,
    {
      [LEADERBOARD_RATING_FIELD]: lr,
    },
    { merge: true }
  );
  batchOps++;
  updated++;

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
    {
      ok: true,
      userCount: snap.size,
      documentsUpdated: updated,
      field: LEADERBOARD_RATING_FIELD,
    },
    null,
    2
  )
);
