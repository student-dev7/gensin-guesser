/** 開発用 UI（DebugUserTools・正解表示など）を出すホストかどうか */
export function isDevLocalhostHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}
