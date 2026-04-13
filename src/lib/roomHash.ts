/**
 * ルーム用パスワード照合（クライアント・サーバー共通）。
 * `passwordHash` は空文字で「パスワードなし」。
 */
export async function sha256HexUtf8(text: string): Promise<string> {
  const enc = new TextEncoder();
  const buf = enc.encode(text);
  const cryptoObj = globalThis.crypto?.subtle;
  if (!cryptoObj) {
    throw new Error("Web Crypto が使えません");
  }
  const hash = await cryptoObj.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function roomPasswordInputKey(code: string): string {
  return `genshin-guesser-room-pw-ok-${code}`;
}
