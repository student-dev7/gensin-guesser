"use client";

import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { onAuthStateChanged } from "firebase/auth";
import CHARACTERS from "@/data/characters.json";
import { APP_VERSION } from "@/lib/appVersion";
import { isAdminUid } from "@/lib/adminUids";
import {
  ensureAnonymousSession,
  getFirebaseAuth,
} from "@/lib/firebaseClient";
import { isDevLocalhostHost } from "@/lib/devLocalhost";

const LS_PREFER_NORMAL = "genshin-guesser-prefer-normal-ui";
const SS_ADMIN_VERIFIED = "genshin-guesser-admin-session-verified";

const CHARACTER_COUNT = (CHARACTERS as unknown[]).length;

export type AdminModeContextValue = {
  /** localhost または管理者 UID */
  adminCapability: boolean;
  /** DBG・正解表示・管理者ツールを表示するか */
  showAdminTools: boolean;
  /** 本番で未認証のとき true（管理者モードへ誘導可能） */
  needsAdminPassword: boolean;
  isLocalhostDev: boolean;
  currentUid: string | null;
  requestAdminMode: () => void;
  switchToNormalUser: () => void;
};

const AdminModeContext = createContext<AdminModeContextValue | null>(null);

export function useAdminMode(): AdminModeContextValue {
  const v = useContext(AdminModeContext);
  if (!v) {
    throw new Error("useAdminMode は AdminModeProvider 内で使ってください");
  }
  return v;
}

export function AdminModeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [ready, setReady] = useState(false);
  const [isLocalhostDev, setIsLocalhostDev] = useState(false);
  const [uid, setUid] = useState<string | null>(null);
  const [preferNormal, setPreferNormal] = useState(false);
  const [sessionVerified, setSessionVerified] = useState(false);

  const [passOpen, setPassOpen] = useState(false);
  const [passDraft, setPassDraft] = useState("");
  const [passError, setPassError] = useState<string | null>(null);
  const [passLoading, setPassLoading] = useState(false);

  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    setIsLocalhostDev(isDevLocalhostHost(window.location.hostname));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await ensureAnonymousSession();
      } catch {
        /* ignore */
      }
      if (cancelled) return;
      try {
        setPreferNormal(localStorage.getItem(LS_PREFER_NORMAL) === "1");
        setSessionVerified(sessionStorage.getItem(SS_ADMIN_VERIFIED) === "1");
      } catch {
        /* ignore */
      }
      setUid(getFirebaseAuth().currentUser?.uid ?? null);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const auth = getFirebaseAuth();
    const unsub = onAuthStateChanged(auth, (u) => {
      setUid(u?.uid ?? null);
    });
    return () => unsub();
  }, []);

  const adminCapability = useMemo(() => {
    if (isLocalhostDev) return true;
    return isAdminUid(uid);
  }, [isLocalhostDev, uid]);

  const showAdminTools = useMemo(() => {
    if (!ready || !adminCapability) return false;
    if (preferNormal) return false;
    if (isLocalhostDev) return true;
    return sessionVerified;
  }, [
    ready,
    adminCapability,
    preferNormal,
    isLocalhostDev,
    sessionVerified,
  ]);

  const needsAdminPassword = useMemo(() => {
    if (!ready || !adminCapability || preferNormal) return false;
    if (isLocalhostDev) return false;
    return !sessionVerified;
  }, [
    ready,
    adminCapability,
    preferNormal,
    isLocalhostDev,
    sessionVerified,
  ]);

  const switchToNormalUser = useCallback(() => {
    try {
      localStorage.setItem(LS_PREFER_NORMAL, "1");
    } catch {
      /* ignore */
    }
    try {
      sessionStorage.removeItem(SS_ADMIN_VERIFIED);
    } catch {
      /* ignore */
    }
    setPreferNormal(true);
    setSessionVerified(false);
    setPassOpen(false);
    setPanelOpen(false);
  }, []);

  const unlockAfterPassword = useCallback(() => {
    try {
      sessionStorage.setItem(SS_ADMIN_VERIFIED, "1");
    } catch {
      /* ignore */
    }
    try {
      localStorage.removeItem(LS_PREFER_NORMAL);
    } catch {
      /* ignore */
    }
    setSessionVerified(true);
    setPreferNormal(false);
    setPassOpen(false);
    setPassDraft("");
    setPassError(null);
  }, []);

  const requestAdminMode = useCallback(() => {
    if (isLocalhostDev) {
      try {
        localStorage.removeItem(LS_PREFER_NORMAL);
      } catch {
        /* ignore */
      }
      setPreferNormal(false);
      return;
    }
    if (!isAdminUid(uid)) return;
    if (sessionVerified) {
      try {
        localStorage.removeItem(LS_PREFER_NORMAL);
      } catch {
        /* ignore */
      }
      setPreferNormal(false);
      return;
    }
    setPassError(null);
    setPassOpen(true);
  }, [isLocalhostDev, uid, sessionVerified]);

  const submitPassword = useCallback(async () => {
    setPassError(null);
    setPassLoading(true);
    try {
      await ensureAnonymousSession();
      const auth = getFirebaseAuth();
      const idToken = await auth.currentUser!.getIdToken();
      const res = await fetch("/api/verify-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken, password: passDraft }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!json?.ok) {
        throw new Error(json?.error ?? "認証に失敗しました");
      }
      unlockAfterPassword();
    } catch (e: unknown) {
      setPassError(e instanceof Error ? e.message : String(e));
    } finally {
      setPassLoading(false);
    }
  }, [passDraft, unlockAfterPassword]);

  const value = useMemo<AdminModeContextValue>(
    () => ({
      adminCapability,
      showAdminTools,
      needsAdminPassword,
      isLocalhostDev,
      currentUid: uid,
      requestAdminMode,
      switchToNormalUser,
    }),
    [
      adminCapability,
      showAdminTools,
      needsAdminPassword,
      isLocalhostDev,
      uid,
      requestAdminMode,
      switchToNormalUser,
    ]
  );

  const projectId =
    typeof process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID === "string"
      ? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
      : "";

  return (
    <AdminModeContext.Provider value={value}>
      {children}

      {ready && adminCapability && (
        <>
          {showAdminTools && (
            <div className="fixed bottom-4 right-4 z-[195] flex max-w-[min(20rem,calc(100vw-2rem))] flex-col items-end gap-2">
              <button
                type="button"
                onClick={() => setPanelOpen((v) => !v)}
                className="rounded-lg border border-amber-500/45 bg-amber-950/95 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-100 shadow-lg shadow-black/40 backdrop-blur-sm hover:border-amber-400/70"
              >
                {panelOpen ? "管理者 ▲" : "管理者 ▼"}
              </button>
              {panelOpen && (
                <div className="w-full rounded-xl border border-amber-500/35 bg-[#1a1508]/98 p-3 text-xs text-amber-50/95 shadow-xl shadow-black/50 backdrop-blur-sm">
                  <p className="font-semibold text-amber-100">管理者ツール</p>
                  <ul className="mt-2 space-y-2 text-[11px] leading-relaxed text-amber-100/80">
                    <li>
                      アプリ: v{APP_VERSION} / キャラ数: {CHARACTER_COUNT}
                    </li>
                    <li className="break-all font-mono text-[10px] text-amber-200/90">
                      UID: {uid ?? "—"}
                    </li>
                    <li className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (uid)
                            void navigator.clipboard.writeText(uid).catch(
                              () => {
                                /* ignore */
                              }
                            );
                        }}
                        disabled={!uid}
                        className="rounded border border-amber-400/40 px-2 py-0.5 text-[11px] hover:bg-amber-500/20 disabled:opacity-40"
                      >
                        UID をコピー
                      </button>
                      {projectId ? (
                        <a
                          href={`https://console.firebase.google.com/project/${encodeURIComponent(projectId)}/overview`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded border border-amber-400/40 px-2 py-0.5 text-[11px] hover:bg-amber-500/20"
                        >
                          Firebase コンソール
                        </a>
                      ) : null}
                      <Link
                        href="/ranking"
                        className="rounded border border-amber-400/40 px-2 py-0.5 text-[11px] hover:bg-amber-500/20"
                      >
                        ランキング
                      </Link>
                    </li>
                  </ul>
                  <button
                    type="button"
                    onClick={switchToNormalUser}
                    className="mt-3 w-full rounded-lg border border-white/20 bg-black/25 py-2 text-[11px] font-medium text-white/90 hover:bg-white/10"
                  >
                    一般ユーザー表示に切り替え
                  </button>
                </div>
              )}
            </div>
          )}

          {!showAdminTools && (
            <div className="fixed bottom-4 right-4 z-[195] flex flex-col items-end gap-2">
              <button
                type="button"
                onClick={requestAdminMode}
                className="rounded-lg border border-amber-500/40 bg-[#1a1508]/95 px-2.5 py-1.5 text-[11px] font-medium text-amber-100/95 shadow-lg shadow-black/40 hover:border-amber-400/60"
              >
                {needsAdminPassword
                  ? "管理者モード（要パス）"
                  : "管理者モードへ"}
              </button>
            </div>
          )}
        </>
      )}

      {passOpen && (
        <div
          className="fixed inset-0 z-[220] flex items-end justify-center bg-black/60 p-4 pb-8 backdrop-blur-[2px] sm:items-center sm:pb-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-pass-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPassOpen(false);
          }}
        >
          <div className="w-full max-w-sm rounded-2xl border border-amber-500/40 bg-[#1a1508] p-5 shadow-2xl">
            <h2
              id="admin-pass-title"
              className="text-sm font-semibold text-amber-100"
            >
              管理者認証
            </h2>
            <p className="mt-2 text-xs text-amber-200/75">
              管理者 UID でログイン中です。続行するにはパスワードを入力してください。
            </p>
            <label className="mt-4 block">
              <span className="text-xs text-white/55">パスワード</span>
              <input
                type="password"
                autoComplete="current-password"
                value={passDraft}
                onChange={(e) => setPassDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submitPassword();
                }}
                className="mt-1 w-full rounded-lg border border-white/15 bg-black/35 px-3 py-2 text-sm text-white outline-none focus:border-amber-400/50"
              />
            </label>
            {passError && (
              <p className="mt-2 text-xs text-rose-300">{passError}</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setPassOpen(false);
                  setPassError(null);
                }}
                className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10"
              >
                キャンセル
              </button>
              <button
                type="button"
                disabled={passLoading || passDraft.length === 0}
                onClick={() => void submitPassword()}
                className="rounded-lg border border-amber-400/50 bg-amber-700/80 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600/90 disabled:opacity-50"
              >
                {passLoading ? "確認中…" : "認証"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminModeContext.Provider>
  );
}
