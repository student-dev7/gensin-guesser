/** 英数字5桁（紛らわしい文字は除外） */
export const ROOM_CODE_CHARS =
  "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" as const;

export const ROOM_CODE_LEN = 5;
export const ROOM_MOVE_TIMEOUT_SEC_DEFAULT = 30;
/** Firestore / API との整合用（実質無制限モードの上限） */
export const ROOM_UNLIMITED_GUESS_CAP = 999;

export type RoomDocument = {
  code: string;
  name: string;
  hostUid: string;
  isPublic: boolean;
  /** true: 7手まで / false: 無制限（♾️） */
  maxHandsLimited: boolean;
  /** 1手あたりの秒数（現状 30 固定） */
  moveTimeoutSec: number;
  /** パスワードありのとき SHA-256 hex（code|password） */
  passwordHash: string;
  createdAt: unknown;
  updatedAt: unknown;
};

export function normalizeRoomCode(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (t.length !== ROOM_CODE_LEN) return null;
  return t;
}

export function generateRoomCode(): string {
  const n = ROOM_CODE_CHARS.length;
  let s = "";
  const cryptoObj = globalThis.crypto;
  if (cryptoObj?.getRandomValues) {
    const buf = new Uint32Array(ROOM_CODE_LEN);
    cryptoObj.getRandomValues(buf);
    for (let i = 0; i < ROOM_CODE_LEN; i++) {
      s += ROOM_CODE_CHARS[buf[i]! % n]!;
    }
    return s;
  }
  for (let i = 0; i < ROOM_CODE_LEN; i++) {
    s += ROOM_CODE_CHARS[Math.floor(Math.random() * n)]!;
  }
  return s;
}
