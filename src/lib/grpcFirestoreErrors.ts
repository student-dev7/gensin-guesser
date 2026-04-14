import { status as GrpcStatus } from "@grpc/grpc-js";

/**
 * gRPC の ServiceError は `code` が列挙されない／message が壊れることがあるため、
 * cause チェーンも辿って数値コードを推定する。
 */
export function getGrpcStatusCodeDeep(
  e: unknown,
  depth = 0
): number | undefined {
  if (depth > 8 || e == null || typeof e !== "object") return undefined;
  const err = e as { code?: unknown; cause?: unknown };
  if (typeof err.code === "number" && Number.isFinite(err.code)) {
    const n = Math.trunc(err.code);
    if (n >= 0 && n <= 16) return n;
  }
  if (err.cause !== undefined) {
    const c = getGrpcStatusCodeDeep(err.cause, depth + 1);
    if (c !== undefined) return c;
  }
  return undefined;
}

export function shouldRetryFirestoreWrite(e: unknown): boolean {
  const code = getGrpcStatusCodeDeep(e);
  if (
    code === GrpcStatus.CANCELLED ||
    code === GrpcStatus.DEADLINE_EXCEEDED ||
    code === GrpcStatus.UNAVAILABLE ||
    code === GrpcStatus.ABORTED ||
    code === GrpcStatus.RESOURCE_EXHAUSTED
  ) {
    return true;
  }
  if (e instanceof Error && e.message === "undefined undefined: undefined") {
    return true;
  }
  return false;
}

export async function withFirestoreWriteRetry<T>(
  fn: () => Promise<T>
): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (attempt === 0 && shouldRetryFirestoreWrite(e)) {
        await new Promise((r) => setTimeout(r, 350));
        continue;
      }
      throw e;
    }
  }
  throw last;
}
