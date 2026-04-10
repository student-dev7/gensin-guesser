"use client";

import { useCallback, useEffect, useState } from "react";

export function LegalFooter() {
  const [open, setOpen] = useState(false);

  const onKey = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onKey]);

  return (
    <>
      <footer className="mt-auto border-t border-[#ece5d8]/10 bg-[#070a14]/90 px-4 py-4 text-center">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs text-white/45 underline decoration-white/25 underline-offset-2 transition hover:text-[#ece5d8]/80"
        >
          利用規約・プライバシーポリシー
        </button>
      </footer>

      {open && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="legal-title"
        >
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#ece5d8]/20 bg-[#12182a] p-6 text-left shadow-2xl">
            <h2
              id="legal-title"
              className="text-lg font-semibold text-[#ece5d8]"
            >
              利用規約・プライバシーポリシー（概要）
            </h2>
            <div className="mt-4 space-y-3 text-sm leading-relaxed text-white/75">
              <p>
                本サービス（GenshinGuesser）は個人開発の非公式ファン作品です。原神
                (Genshin Impact)
                は株式会社HoYoverse及びその関連会社の商標・著作物です。本サービスは上記事業者と一切関係ありません。
              </p>
              <p>
                <strong className="text-[#ece5d8]/95">データの取り扱い：</strong>
                スコア・表示名・ゲーム結果の保存に Google Firebase（Authentication /
                Firestore）を利用します。匿名認証や端末識別に伴うデータが当該インフラに保存される場合があります。
              </p>
              <p>
                <strong className="text-[#ece5d8]/95">免責：</strong>
                サービスは現状有姿で提供され、動作保証・可用性・データの完全性を保証しません。利用により生じた損害について、開発者は法令で義務付けられる場合を除き責任を負いません。
              </p>
              <p>
                <strong className="text-[#ece5d8]/95">利用制限：</strong>
                虚偽・他者への迷惑・法令違反となる利用を禁止します。表示名は運営が不適切と判断した場合、予告なく利用を制限する場合があります。
              </p>
              <p className="text-xs text-white/50">
                内容は予告なく変更されることがあります。最終更新: 利用時点の掲示に従ってください。
              </p>
            </div>
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-xl border border-[#ece5d8]/35 bg-[#ece5d8]/10 px-4 py-2 text-sm font-medium text-[#ece5d8] transition hover:bg-[#ece5d8]/20"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
