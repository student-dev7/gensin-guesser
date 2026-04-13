/** 英数字5桁（紛らわしい文字は除外） */
export const ROOM_CODE_CHARS =
  "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" as const;

export const ROOM_CODE_LEN = 5;
export const ROOM_MOVE_TIMEOUT_SEC_DEFAULT = 30;
/** 同時に存在できる公開ルーム（isPublic）の上限（Firestore 無料枠対策） */
export const MAX_PUBLIC_ROOMS = 15;
/** 公開一覧の「3/4」表示用・定員のデフォルト（作成時に保存） */
export const ROOM_MAX_PLAYERS_DEFAULT = 4;
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
  /** 定員（一覧の n/max 表示用。未設定の旧ルームは ROOM_MAX_PLAYERS_DEFAULT 扱い） */
  maxPlayers?: number;
  /** パスワードありのとき SHA-256 hex（code|password） */
  passwordHash: string;
  /**
   * false: ロビー（2人以上＋ホストの開始まで待機）
   * true: 試合開始済み。未設定の旧ドキュメントは「開始済み」とみなす。
   */
  matchStarted?: boolean;
  /** ホストが開始したときの共有お題（キャラ名） */
  targetCharacterName?: string;
  /** 共有ラウンド ID（開始時にホストが発行） */
  activeRoundId?: string;
  /** 最終活動（放置ルーム削除の目安。クライアントが定期的に更新） */
  lastActivityAt?: unknown;
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
