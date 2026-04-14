import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // クライアントで Vercel 判定（VERCEL はブラウザに渡らないため NEXT_PUBLIC に載せる）
  env: {
    NEXT_PUBLIC_VERCEL_WEB_ANALYTICS:
      process.env.VERCEL === "1" || process.env.VERCEL === "true"
        ? "1"
        : "0",
  },
};

export default nextConfig;
