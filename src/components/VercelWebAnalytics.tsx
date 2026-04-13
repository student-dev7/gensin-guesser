"use client";

import dynamic from "next/dynamic";

/** Vercel 本番だけでバンドル実行。Cloudflare 等では null（@vercel/analytics は useSearchParams があり Worker で / が 500 になることがある） */
const AnalyticsLazy = dynamic(
  () => import("@vercel/analytics/next").then((m) => m.Analytics),
  { ssr: false },
);

export function VercelWebAnalytics() {
  if (process.env.NEXT_PUBLIC_VERCEL_WEB_ANALYTICS !== "1") {
    return null;
  }
  return <AnalyticsLazy />;
}
