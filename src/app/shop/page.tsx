import type { Metadata } from "next";
import { ShopClient } from "./ShopClient";

export const metadata: Metadata = {
  title: "ショップ",
  description:
    "原神ゲッサーのゴールドショップ。次回勝利レート2倍バフなど。",
  alternates: {
    canonical: "/shop",
  },
};

export default function ShopPage() {
  return <ShopClient />;
}
