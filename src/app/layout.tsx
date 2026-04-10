import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { LegalFooter } from "@/components/LegalFooter";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://genshin-guesser.vercel.app"),
  title: "原神ゲッサー - キャラ当てクイズ",
  description:
    "元素、武器、地域から原神のキャラクターを当てるクイズゲーム！あなたの原神知識を試そう。",
  openGraph: {
    type: "website",
    url: "https://genshin-guesser.vercel.app",
    title: "原神ゲッサー - キャラ当てクイズ",
    description:
      "元素、武器、地域から原神のキャラクターを当てるクイズゲーム！あなたの原神知識を試そう。",
    images: [{ url: "/og-image.png" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "原神ゲッサー - キャラ当てクイズ",
    description:
      "元素、武器、地域から原神のキャラクターを当てるクイズゲーム！あなたの原神知識を試そう。",
    images: ["/og-image.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-screen flex-col bg-[#0a0f1e] text-white antialiased">
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        <LegalFooter />
      </body>
    </html>
  );
}
