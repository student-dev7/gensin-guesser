import type { Metadata } from "next";
import { ShopClient } from "./ShopClient";

export const metadata: Metadata = {
  title: "ショップ",
  description:
    "原神ゲッサーのゴールドショップ。アイコンフレームなどの購入（準備中）。",
  alternates: {
    canonical: "/shop",
  },
};

export default function ShopPage() {
  return <ShopClient />;
}
