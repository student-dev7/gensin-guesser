/**
 * fetch の応答が JSON でないとき（Vercel のタイムアウト HTML など）に落ちないよう解析する。
 */
export async function parseApiJsonResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  const trimmed = text.trim();
  if (!trimmed) {
    if (!res.ok) {
      throw new Error(
        res.status === 504 || res.status === 503
          ? "サーバーがタイムアウトしました。しばらくしてからもう一度お試しください。"
          : `通信に失敗しました（${res.status}）`
      );
    }
    throw new Error("空の応答です");
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const preview = trimmed.slice(0, 200).replace(/\s+/g, " ").trim();
    const looksLikePlatformTimeout =
      res.status === 504 ||
      res.status === 503 ||
      /timeout|timed out|Function|Runtime|An error occurred/i.test(preview);
    throw new Error(
      looksLikePlatformTimeout
        ? "サーバーがタイムアウトしました。しばらくしてからもう一度お試しください。"
        : `サーバー応答を解釈できませんでした（${res.status}）`
    );
  }
}
