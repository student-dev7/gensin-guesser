/**
 * デバッグ UI（DBG パネル・正解表示など）を本番でも使える UID。
 * カンマ区切りで追加: NEXT_PUBLIC_ADMIN_UIDS=uid1,uid2
 *
 * チャット全削除・他人メッセージ削除は Firestore の isChatModerator とも同期すること
 * （env のみ追加した場合は firestore.rules に手動で同じ UID を追記）。
 */
const BUILTIN_ADMIN_UIDS = new Set<string>([
  "WVvphz6TOZSKuwck6Kf83vAFupo2",
]);

function adminUidsFromEnv(): Set<string> {
  const raw = process.env.NEXT_PUBLIC_ADMIN_UIDS ?? "";
  const next = new Set<string>();
  for (const part of raw.split(",")) {
    const t = part.trim();
    if (t.length > 0) next.add(t);
  }
  return next;
}

const envAdminUids = adminUidsFromEnv();

export function isAdminUid(uid: string | null | undefined): boolean {
  if (!uid) return false;
  if (BUILTIN_ADMIN_UIDS.has(uid)) return true;
  if (envAdminUids.has(uid)) return true;
  return false;
}
