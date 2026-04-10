import { getFirebaseWebConfig } from "./firebaseWebConfig";

/**
 * Firebase JS SDK のみ運用時、サーバーで ID トークンを検証して uid を得る。
 * Identity Toolkit REST（Web API キー使用・サービスアカウント不要）。
 */
export async function getUidFromIdToken(idToken: string): Promise<string | null> {
  const { apiKey } = getFirebaseWebConfig();
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    }
  );
  if (!res.ok) {
    return null;
  }
  const data = (await res.json()) as { users?: { localId?: string }[] };
  const uid = data.users?.[0]?.localId;
  return typeof uid === "string" ? uid : null;
}
