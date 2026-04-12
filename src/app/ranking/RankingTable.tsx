"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { RankingAvatar } from "@/components/RankingAvatar";
import { RankLogoMark } from "@/components/RankLogoMark";
import { isAdminUid } from "@/lib/adminUids";
import { RANK_BAND_WIDTH_PT } from "@/lib/rankUtils";
import {
  ensureAnonymousSession,
  getFirebaseAuth,
} from "@/lib/firebaseClient";

export type RankRow = {
  uid: string;
  rank: number;
  displayName: string;
  rating: number;
  games: number;
};

type Props = {
  rows: RankRow[];
  error: string | null;
};

export function RankingTable({ rows, error }: Props) {
  const router = useRouter();
  const [myUid, setMyUid] = useState<string | null | undefined>(undefined);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [massDownOpen, setMassDownOpen] = useState(false);
  const [massDownPass, setMassDownPass] = useState("");
  const [massDownLoading, setMassDownLoading] = useState(false);
  const [massDownMessage, setMassDownMessage] = useState<string | null>(null);
  const [massDown500Open, setMassDown500Open] = useState(false);
  const [massDown500Pass, setMassDown500Pass] = useState("");
  const [massDown500Loading, setMassDown500Loading] = useState(false);
  const [massDown500Message, setMassDown500Message] = useState<string | null>(
    null
  );
  const [adminEditOpen, setAdminEditOpen] = useState(false);
  const [adminEditUid, setAdminEditUid] = useState<string | null>(null);
  const [adminEditName, setAdminEditName] = useState("");
  const [adminEditRatingDraft, setAdminEditRatingDraft] = useState("");
  const [adminEditPass, setAdminEditPass] = useState("");
  const [adminEditLoading, setAdminEditLoading] = useState(false);
  const [adminEditMessage, setAdminEditMessage] = useState<string | null>(
    null
  );

  const isAdmin =
    typeof myUid === "string" && myUid.length > 0 && isAdminUid(myUid);
  const tableColSpan = isAdmin ? 5 : 4;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await ensureAnonymousSession();
        const uid = getFirebaseAuth().currentUser?.uid ?? null;
        if (!cancelled) setMyUid(uid);
      } catch {
        if (!cancelled) setMyUid(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0f1e] px-4 py-12 text-white">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-10 text-center">
          <p className="text-xs font-medium uppercase tracking-[0.35em] text-[#ece5d8]/80">
            GenshinGuesser
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[#ece5d8] sm:text-4xl">
            レートランキング
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-white/55">
            Firestore のユーザー別レート上位 50 名です。
          </p>
          <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-white/40">
            2 週間に 1 度、全員のシーズンレートが 1 ランク分（500pt）ダウンします。次回実行は4月27日です。自分だけ
            1500 に戻す場合は下のボタンを使えます。
          </p>
          <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:flex-wrap sm:justify-center">
            <Link
              href="/"
              className="inline-flex items-center justify-center rounded-full border border-[#ece5d8]/35 bg-[#12182a] px-6 py-2.5 text-sm font-medium text-[#ece5d8] shadow-[0_0_24px_-8px_rgba(236,229,216,0.25)] transition hover:border-[#ece5d8]/55 hover:bg-[#1a2238]"
            >
              ← トップへ戻る
            </Link>
            <button
              type="button"
              onClick={() => {
                setResetOpen(true);
                setResetConfirm("");
                setResetMessage(null);
              }}
              className="inline-flex items-center justify-center rounded-full border border-rose-500/45 bg-rose-950/35 px-6 py-2.5 text-sm font-medium text-rose-200/95 shadow-sm transition hover:border-rose-400/60 hover:bg-rose-950/55"
            >
              自分のレートを 1500 に戻す
            </button>
            {isAdmin && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setMassDown500Open(true);
                    setMassDown500Pass("");
                    setMassDown500Message(null);
                  }}
                  className="inline-flex items-center justify-center rounded-full border border-amber-500/50 bg-amber-950/40 px-6 py-2.5 text-sm font-medium text-amber-200/95 shadow-sm transition hover:border-amber-400/65 hover:bg-amber-950/60"
                >
                  管理者：全員 −500pt
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMassDownOpen(true);
                    setMassDownPass("");
                    setMassDownMessage(null);
                  }}
                  className="inline-flex items-center justify-center rounded-full border border-amber-500/50 bg-amber-950/40 px-6 py-2.5 text-sm font-medium text-amber-200/95 shadow-sm transition hover:border-amber-400/65 hover:bg-amber-950/60"
                >
                  管理者：全員 6 ティア分下げる
                </button>
              </>
            )}
          </div>
        </header>

        {resetOpen && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-rating-title"
            onClick={() => setResetOpen(false)}
          >
            <div
              className="w-full max-w-md rounded-2xl border border-[#ece5d8]/25 bg-[#12182a] p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h2
                id="reset-rating-title"
                className="text-lg font-semibold text-[#ece5d8]"
              >
                自分のレートを初期値に戻す
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-white/60">
                あなたのアカウントのシーズンレート（
                <span className="text-[#ece5d8]/90">current_rate / rating</span>
                ）を 1500 に戻します。ランク表示もリセット後のレートに合わせて変わります。実行するには下に{" "}
                <span className="font-mono text-amber-200/95">quit</span>{" "}
                と入力してください。
              </p>
              <input
                value={resetConfirm}
                onChange={(e) => setResetConfirm(e.target.value)}
                autoComplete="off"
                placeholder="quit"
                className="mt-4 w-full rounded-xl border border-[#ece5d8]/20 bg-[#0a0f1e] px-4 py-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-[#ece5d8]/45"
              />
              {resetMessage && (
                <p className="mt-2 text-sm text-rose-400">{resetMessage}</p>
              )}
              <div className="mt-6 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setResetOpen(false)}
                  className="rounded-xl px-4 py-2 text-sm text-white/70 transition hover:bg-white/10"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  disabled={resetLoading}
                  onClick={async () => {
                    setResetMessage(null);
                    if (resetConfirm.trim().toLowerCase() !== "quit") {
                      setResetMessage("「quit」と正確に入力してください");
                      return;
                    }
                    setResetLoading(true);
                    try {
                      await ensureAnonymousSession();
                      const auth = getFirebaseAuth();
                      const idToken = await auth.currentUser?.getIdToken();
                      if (!idToken) {
                        setResetMessage("ログインが必要です");
                        return;
                      }
                      const res = await fetch("/api/reset-season-rating", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          idToken,
                          confirm: resetConfirm.trim(),
                        }),
                      });
                      const json = (await res.json()) as {
                        ok?: boolean;
                        error?: string;
                      };
                      if (!json?.ok) {
                        setResetMessage(json?.error ?? "リセットに失敗しました");
                        return;
                      }
                      setResetOpen(false);
                      router.refresh();
                    } catch (e: unknown) {
                      setResetMessage(
                        e instanceof Error ? e.message : String(e)
                      );
                    } finally {
                      setResetLoading(false);
                    }
                  }}
                  className="rounded-xl border border-rose-500/50 bg-rose-900/40 px-4 py-2 text-sm font-medium text-rose-100 transition hover:bg-rose-900/60 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {resetLoading ? "処理中…" : "リセットする"}
                </button>
              </div>
            </div>
          </div>
        )}

        {massDown500Open && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mass-down-500-title"
            onClick={() => setMassDown500Open(false)}
          >
            <div
              className="w-full max-w-md rounded-2xl border border-amber-500/35 bg-[#12182a] p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h2
                id="mass-down-500-title"
                className="text-lg font-semibold text-amber-200/95"
              >
                全ユーザーのシーズンレートを −500
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-white/60">
                全員の{" "}
                <span className="text-[#ece5d8]/90">current_rate / rating</span>{" "}
                から{" "}
                <span className="tabular-nums text-amber-200/95">
                  {RANK_BAND_WIDTH_PT}
                </span>{" "}
                pt（1 ランク帯相当）を減算し、下限 1500 で打ち止めします。
              </p>
              <p className="mt-2 text-xs text-amber-200/75">
                実行するには下に{" "}
                <span className="font-mono text-amber-200/95">down</span>{" "}
                と入力してください（6 ティア一括と同じ）。
              </p>
              <input
                value={massDown500Pass}
                onChange={(e) => setMassDown500Pass(e.target.value)}
                autoComplete="off"
                placeholder="down"
                className="mt-4 w-full rounded-xl border border-[#ece5d8]/20 bg-[#0a0f1e] px-4 py-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-amber-400/45"
              />
              {massDown500Message && (
                <p className="mt-2 text-sm text-rose-400">{massDown500Message}</p>
              )}
              <div className="mt-6 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setMassDown500Open(false)}
                  className="rounded-xl px-4 py-2 text-sm text-white/70 transition hover:bg-white/10"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  disabled={massDown500Loading}
                  onClick={async () => {
                    setMassDown500Message(null);
                    if (massDown500Pass.trim().toLowerCase() !== "down") {
                      setMassDown500Message(
                        "「down」と正確に入力してください"
                      );
                      return;
                    }
                    setMassDown500Loading(true);
                    try {
                      await ensureAnonymousSession();
                      const auth = getFirebaseAuth();
                      const idToken = await auth.currentUser?.getIdToken();
                      if (!idToken) {
                        setMassDown500Message("ログインが必要です");
                        return;
                      }
                      const res = await fetch(
                        "/api/admin/mass-down-500-season-rating",
                        {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            idToken,
                            pass: massDown500Pass.trim(),
                          }),
                        }
                      );
                      const json = (await res.json()) as {
                        ok?: boolean;
                        error?: string;
                        userCount?: number;
                      };
                      if (!json?.ok) {
                        setMassDown500Message(
                          json?.error ?? "処理に失敗しました"
                        );
                        return;
                      }
                      setMassDown500Open(false);
                      router.refresh();
                    } catch (e: unknown) {
                      setMassDown500Message(
                        e instanceof Error ? e.message : String(e)
                      );
                    } finally {
                      setMassDown500Loading(false);
                    }
                  }}
                  className="rounded-xl border border-amber-500/50 bg-amber-900/50 px-4 py-2 text-sm font-medium text-amber-100 transition hover:bg-amber-900/70 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {massDown500Loading ? "処理中…" : "実行する"}
                </button>
              </div>
            </div>
          </div>
        )}

        {massDownOpen && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mass-down-title"
            onClick={() => setMassDownOpen(false)}
          >
            <div
              className="w-full max-w-md rounded-2xl border border-amber-500/35 bg-[#12182a] p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h2
                id="mass-down-title"
                className="text-lg font-semibold text-amber-200/95"
              >
                全ユーザーのシーズンレートを下げる
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-white/60">
                全員の <span className="text-[#ece5d8]/90">current_rate / rating</span>{" "}
                から <span className="tabular-nums text-amber-200/95">750</span>{" "}
                pt（ティア 6 段・約 1.5 ランク相当）を減算し、下限 1500
                で打ち止めします。Firestore の読み書きが発生するため、ユーザー数に比例してクォータを消費します。
              </p>
              <p className="mt-2 text-xs text-amber-200/75">
                実行するには下に{" "}
                <span className="font-mono text-amber-200/95">down</span>{" "}
                と入力してください。
              </p>
              <input
                value={massDownPass}
                onChange={(e) => setMassDownPass(e.target.value)}
                autoComplete="off"
                placeholder="down"
                className="mt-4 w-full rounded-xl border border-[#ece5d8]/20 bg-[#0a0f1e] px-4 py-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-amber-400/45"
              />
              {massDownMessage && (
                <p className="mt-2 text-sm text-rose-400">{massDownMessage}</p>
              )}
              <div className="mt-6 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setMassDownOpen(false)}
                  className="rounded-xl px-4 py-2 text-sm text-white/70 transition hover:bg-white/10"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  disabled={massDownLoading}
                  onClick={async () => {
                    setMassDownMessage(null);
                    if (massDownPass.trim().toLowerCase() !== "down") {
                      setMassDownMessage("「down」と正確に入力してください");
                      return;
                    }
                    setMassDownLoading(true);
                    try {
                      await ensureAnonymousSession();
                      const auth = getFirebaseAuth();
                      const idToken = await auth.currentUser?.getIdToken();
                      if (!idToken) {
                        setMassDownMessage("ログインが必要です");
                        return;
                      }
                      const res = await fetch("/api/admin/mass-down-season-rating", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          idToken,
                          pass: massDownPass.trim(),
                        }),
                      });
                      const json = (await res.json()) as {
                        ok?: boolean;
                        error?: string;
                        userCount?: number;
                      };
                      if (!json?.ok) {
                        setMassDownMessage(json?.error ?? "処理に失敗しました");
                        return;
                      }
                      setMassDownOpen(false);
                      router.refresh();
                    } catch (e: unknown) {
                      setMassDownMessage(
                        e instanceof Error ? e.message : String(e)
                      );
                    } finally {
                      setMassDownLoading(false);
                    }
                  }}
                  className="rounded-xl border border-amber-500/50 bg-amber-900/50 px-4 py-2 text-sm font-medium text-amber-100 transition hover:bg-amber-900/70 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {massDownLoading ? "処理中…" : "実行する"}
                </button>
              </div>
            </div>
          </div>
        )}

        {adminEditOpen && adminEditUid && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-edit-rate-title"
            onClick={() => setAdminEditOpen(false)}
          >
            <div
              className="w-full max-w-md rounded-2xl border border-amber-500/35 bg-[#12182a] p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h2
                id="admin-edit-rate-title"
                className="text-lg font-semibold text-amber-200/95"
              >
                レートを上書き（管理者）
              </h2>
              <p className="mt-2 text-sm text-white/70">
                <span className="font-medium text-[#ece5d8]">{adminEditName}</span>
              </p>
              <p className="mt-1 font-mono text-xs text-white/45">{adminEditUid}</p>
              <label className="mt-4 block text-xs font-medium text-[#ece5d8]/80">
                新しいシーズンレート（1500〜5000 に丸められます）
              </label>
              <input
                type="number"
                inputMode="numeric"
                min={1500}
                max={5000}
                value={adminEditRatingDraft}
                onChange={(e) => setAdminEditRatingDraft(e.target.value)}
                className="mt-1 w-full rounded-xl border border-[#ece5d8]/20 bg-[#0a0f1e] px-4 py-3 text-sm text-white outline-none tabular-nums focus:border-amber-400/45"
              />
              <p className="mt-2 text-xs text-amber-200/75">
                確認のため下に{" "}
                <span className="font-mono text-amber-200/95">setrate</span>{" "}
                と入力してください。
              </p>
              <input
                value={adminEditPass}
                onChange={(e) => setAdminEditPass(e.target.value)}
                autoComplete="off"
                placeholder="setrate"
                className="mt-2 w-full rounded-xl border border-[#ece5d8]/20 bg-[#0a0f1e] px-4 py-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-amber-400/45"
              />
              {adminEditMessage && (
                <p className="mt-2 text-sm text-rose-400">{adminEditMessage}</p>
              )}
              <p className="mt-3 text-xs leading-relaxed text-white/40">
                本番ではサーバーに{" "}
                <span className="text-white/55">FIREBASE_SERVICE_ACCOUNT_JSON</span>{" "}
                が必要です（一括レートと同じ）。
              </p>
              <div className="mt-6 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setAdminEditOpen(false)}
                  className="rounded-xl px-4 py-2 text-sm text-white/70 transition hover:bg-white/10"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  disabled={adminEditLoading}
                  onClick={async () => {
                    setAdminEditMessage(null);
                    if (adminEditPass.trim().toLowerCase() !== "setrate") {
                      setAdminEditMessage("「setrate」と正確に入力してください");
                      return;
                    }
                    const n = Number(adminEditRatingDraft);
                    if (!Number.isFinite(n)) {
                      setAdminEditMessage("レートは数値で入力してください");
                      return;
                    }
                    setAdminEditLoading(true);
                    try {
                      await ensureAnonymousSession();
                      const auth = getFirebaseAuth();
                      const idToken = await auth.currentUser?.getIdToken();
                      if (!idToken || !adminEditUid) {
                        setAdminEditMessage("ログインが必要です");
                        return;
                      }
                      const res = await fetch(
                        "/api/admin/set-user-season-rating",
                        {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            idToken,
                            targetUid: adminEditUid,
                            rating: n,
                            pass: adminEditPass.trim(),
                          }),
                        }
                      );
                      const json = (await res.json()) as {
                        ok?: boolean;
                        error?: string;
                        rating?: number;
                      };
                      if (!json?.ok) {
                        setAdminEditMessage(json?.error ?? "更新に失敗しました");
                        return;
                      }
                      setAdminEditOpen(false);
                      setAdminEditPass("");
                      router.refresh();
                    } catch (e: unknown) {
                      setAdminEditMessage(
                        e instanceof Error ? e.message : String(e)
                      );
                    } finally {
                      setAdminEditLoading(false);
                    }
                  }}
                  className="rounded-xl border border-amber-500/50 bg-amber-900/50 px-4 py-2 text-sm font-medium text-amber-100 transition hover:bg-amber-900/70 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {adminEditLoading ? "保存中…" : "保存"}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="overflow-hidden rounded-2xl border border-[#ece5d8]/20 bg-[#0d1324]/95 shadow-[0_25px_60px_-20px_rgba(0,0,0,0.65)] backdrop-blur-sm">
          <div className="border-b border-[#ece5d8]/15 bg-gradient-to-r from-[#0f1528] via-[#121a30] to-[#0f1528] px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium tracking-wide text-[#ece5d8]/95">
                トップ 50
              </span>
              <span className="text-xs text-white/40">rating desc</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[320px] border-collapse text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wider text-[#ece5d8]/75">
                  <th className="px-4 py-3 font-semibold sm:px-6">順位</th>
                  <th className="px-4 py-3 font-semibold sm:px-6">ユーザー</th>
                  <th className="px-4 py-3 text-right font-semibold sm:px-6">
                    レート
                  </th>
                  <th className="px-4 py-3 text-right font-semibold sm:px-6">
                    プレイ回数
                  </th>
                  {isAdmin && (
                    <th className="px-4 py-3 text-right font-semibold sm:px-6">
                      管理
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#ece5d8]/10">
                {error && (
                  <tr>
                    <td
                      colSpan={tableColSpan}
                      className="px-5 py-10 text-center text-[#ece5d8]/90 sm:px-8"
                    >
                      {error}
                    </td>
                  </tr>
                )}

                {!error && rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={tableColSpan}
                      className="px-5 py-12 text-center text-white/45 sm:px-8"
                    >
                      まだランキングがありません
                    </td>
                  </tr>
                )}

                {!error &&
                  rows.map((row) => {
                    const isMe =
                      typeof myUid === "string" && row.uid === myUid;
                    return (
                      <tr
                        key={row.uid}
                        className={`transition hover:bg-white/[0.04] ${
                          isMe
                            ? "bg-amber-500/10 ring-1 ring-inset ring-amber-400/25"
                            : ""
                        }`}
                      >
                        <td className="whitespace-nowrap px-4 py-3.5 font-mono sm:px-6">
                          <span
                            className={
                              row.rank === 1
                                ? "bg-gradient-to-br from-amber-200 via-yellow-300 to-amber-500 bg-clip-text text-lg font-bold text-transparent drop-shadow-[0_0_12px_rgba(251,191,36,0.35)]"
                                : row.rank === 2
                                  ? "bg-gradient-to-br from-slate-100 via-slate-200 to-slate-400 bg-clip-text text-lg font-bold text-transparent"
                                  : row.rank === 3
                                    ? "bg-gradient-to-br from-orange-300 via-amber-700 to-orange-900 bg-clip-text text-lg font-bold text-transparent"
                                    : "text-white/45"
                            }
                          >
                            {row.rank}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 sm:px-6">
                          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                            <RankingAvatar
                              uid={row.uid}
                              displayName={row.displayName}
                              size="md"
                            />
                            {row.rank <= 10 && (
                              <RankLogoMark
                                rating={row.rating}
                                sizePx={44}
                                className="shrink-0"
                              />
                            )}
                            <span className="min-w-0 font-medium text-white">
                              {row.displayName}
                              {isMe && (
                                <span className="ml-2 text-xs font-normal text-[#ece5d8]/80">
                                  （あなた）
                                </span>
                              )}
                            </span>
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3.5 text-right font-semibold tabular-nums text-[#ece5d8] sm:px-6">
                          {Math.round(row.rating)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3.5 text-right tabular-nums text-white/45 sm:px-6">
                          {row.games}
                        </td>
                        {isAdmin && (
                          <td className="whitespace-nowrap px-4 py-3.5 text-right sm:px-6">
                            <button
                              type="button"
                              onClick={() => {
                                setAdminEditUid(row.uid);
                                setAdminEditName(row.displayName);
                                setAdminEditRatingDraft(String(Math.round(row.rating)));
                                setAdminEditPass("");
                                setAdminEditMessage(null);
                                setAdminEditOpen(true);
                              }}
                              className="rounded-lg border border-amber-500/40 bg-amber-950/40 px-2.5 py-1 text-xs font-medium text-amber-200/95 transition hover:border-amber-400/60 hover:bg-amber-950/65"
                            >
                              編集
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
