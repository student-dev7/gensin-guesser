"use client";

/**
 * ランキング「お知らせ」に表示する旧パッチノート本文（折りたたみ用の中身のみ）。
 */
export function PatchNotesBattleSection() {
  return (
    <div className="space-y-2.5 border-t border-[#ece5d8]/10 px-2 pb-2 pt-3 leading-relaxed text-white/72">
      <p>
        対戦の基準を、
        <span className="font-semibold text-[#ece5d8]">
          過去のクリア記録から選ばれるゴースト
        </span>
        との比較に切り替えました（従来の「平均手数ボーナス」に加え、ゴーストとの差もレートに反映されます）。
      </p>
      <ul className="list-disc space-y-1.5 pl-4 marker:text-amber-400/80">
        <li>
          各ラウンドで対戦モードのとき、そのお題キャラの過去正解から1件がゴーストとして選ばれます（表示名・手数）。1〜2
          手だけの正解記録はゴーストに使いません。
        </li>
        <li>
          ゴーストが正解したのと同じ手数に達したタイミングで、ゴースト側の正解が通知されます。
        </li>
        <li>
          まだ自分が正解していない状態で、ゴーストの正解手数を
          <span className="font-medium text-[#ece5d8]">超えた</span>
          時点で
          <span className="font-medium text-rose-300/90">敗北</span>
          です。同じ手数の時点ではまだ続行できます。
        </li>
        <li>
          正解すればクリアでシーズンレートは勝ち更新です。未正解のままゴーストの手数を超えたときだけ敗北し、それまでは予想を続けられます。ゴーストより少ない手数で当てるほどボーナスが増えます。
        </li>
        <li>
          <span className="font-medium text-[#ece5d8]">個人モード</span>
          ではゴーストは出ず、
          <span className="font-medium text-amber-200/90">
            シーズンレート・ゴールドは一切変動しません
          </span>
          （練習向け）。
        </li>
      </ul>
    </div>
  );
}

export function PatchNotesStatsSection() {
  return (
    <div className="space-y-2.5 border-t border-[#ece5d8]/10 px-2 pb-2 pt-3 leading-relaxed text-white/72">
      <p>
        キャラ別の参考平均手数は
        <span className="font-medium text-[#ece5d8]">全プレイの単純平均</span>
        です（勝ち・負け・ゴースト敗北を含み、
        <span className="font-medium text-[#ece5d8]">降参は 7 手</span>
        として計上）。
      </p>
      <p>
        <span className="font-semibold text-[#ece5d8]">ランク表示</span>
        は
        <span className="font-medium text-[#ece5d8]">シーズンレート（対戦モード）</span>
        だけから決まります。ウォリアー〜ミシックは各ティア{" "}
        <span className="tabular-nums font-medium text-amber-200/95">125</span>{" "}
        pt 幅で IV→III→II→I と昇格します。詳細はトップの「ランク」から参照できます。
      </p>
    </div>
  );
}

export function PatchNotesRateSection() {
  return (
    <div className="mt-2 border-t border-[#ece5d8]/10 px-2 pb-2 pt-3 text-[0.8125rem] leading-relaxed text-white/72 sm:text-sm">
      <p className="font-semibold text-[#ece5d8]">勝ちのシーズンレート増分</p>
      <p className="mt-1.5 text-white/65">
        シーズンレート帯ごとの
        <span className="font-medium text-[#ece5d8]">基礎点</span>
        （1500 未満 +15／1500〜1999 +12／2000 以上 +10）に、
        <span className="font-mono text-[0.7rem] text-white/80 sm:text-xs">
          max(0, キャラ平均手数−自分の手数)×2
        </span>
        と、ゴーストがいるときは
        <span className="font-mono text-[0.7rem] text-white/80 sm:text-xs">
          max(0, ゴースト手数−自分の手数)×2
        </span>
        を加算します。
      </p>
      <p className="mt-2 font-semibold text-[#ece5d8]">
        例: キャラ平均 4 手・シーズンレート 1500〜1999（基礎 +12）
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[16rem] border-collapse text-left text-[0.8125rem] tabular-nums sm:text-sm">
          <thead>
            <tr className="border-b border-[#ece5d8]/20 text-[#ece5d8]/90">
              <th className="py-1 pr-3 font-medium">正解までの手数</th>
              <th className="py-1 font-medium">シーズンレート増分（勝ち）</th>
            </tr>
          </thead>
          <tbody className="text-white/80">
            <tr className="border-b border-white/5">
              <td className="py-1 pr-3">1</td>
              <td className="text-emerald-200/95">+18</td>
            </tr>
            <tr className="border-b border-white/5">
              <td className="py-1 pr-3">2</td>
              <td className="text-emerald-200/95">+16</td>
            </tr>
            <tr className="border-b border-white/5">
              <td className="py-1 pr-3">3</td>
              <td className="text-emerald-200/95">+14</td>
            </tr>
            <tr className="border-b border-white/5">
              <td className="py-1 pr-3">4</td>
              <td className="text-emerald-200/95">+12</td>
            </tr>
            <tr className="border-b border-white/5">
              <td className="py-1 pr-3">5〜7</td>
              <td className="text-emerald-200/95">
                +12（平均より遅いので速度ボーナスなし）
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-white/65">
        <span className="font-semibold text-rose-300/90">負け</span>
        （不正解・降参・手数切れ・ゴースト敗北など）のシーズンレート減少は、
        <span className="font-medium text-[#ece5d8]">そのラウンドの手数によらず</span>
        、いまのシーズンレート帯だけで決まります：
        1500 未満{" "}
        <span className="tabular-nums text-rose-200/95">−5</span>
        ／1500〜1999{" "}
        <span className="tabular-nums text-rose-200/95">−8</span>
        ／2000 以上{" "}
        <span className="tabular-nums text-rose-200/95">−12</span>
        。
      </p>
    </div>
  );
}
