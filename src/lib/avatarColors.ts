/** UID から決定的なアバター背景色（HSL）。ユーザー画像は使わない。 */
export function uidToAvatarBackground(uid: string): string {
  let h = 2166136261;
  for (let i = 0; i < uid.length; i++) {
    h ^= uid.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hue = (h >>> 0) % 360;
  const s = 42 + ((h >>> 8) % 18);
  const l = 36 + ((h >>> 16) % 14);
  return `hsl(${hue} ${s}% ${l}%)`;
}

/** 表示名の先頭1文字（絵文字等は最初のコードポイント） */
export function avatarInitial(displayName: string): string {
  const t = displayName.trim();
  if (!t) return "?";
  const arr = [...t];
  return arr[0] ?? "?";
}
