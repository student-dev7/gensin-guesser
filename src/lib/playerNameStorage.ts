/** ゲーム内表示名（page.tsx の PLAYER_NAME と同一キー） */
export const PLAYER_NAME_STORAGE_KEY = "genshin-guesser-player-name";

export function readStoredPlayerName(): string {
  try {
    return localStorage.getItem(PLAYER_NAME_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeStoredPlayerName(name: string): void {
  try {
    localStorage.setItem(PLAYER_NAME_STORAGE_KEY, name);
  } catch {
    /* ignore */
  }
}
