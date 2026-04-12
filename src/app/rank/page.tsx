import type { Metadata } from "next";
import { RankDetailClient } from "./RankDetailClient";

export const metadata: Metadata = {
  title: "ランク詳細",
  description:
    "原神ゲッサーのシーズンレート・ランク・ティア・昇格までのポイントを表示します。",
  alternates: {
    canonical: "/rank",
  },
};

export default function RankPage() {
  return <RankDetailClient />;
}
