import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { Geist, Geist_Mono } from "next/font/google";
import { FirebaseAnalyticsInit } from "@/components/FirebaseAnalyticsInit";
import { LegalFooter } from "@/components/LegalFooter";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteTitle =
  "原神ゲッサー | キャラクター当てクイズ（原神・ファンメイド・無料）";
const siteDescription =
  "原神のキャラクターを元素・武器・地区のヒントから当てる無料ブラウザクイズ。インストール不要のファンメイドミニゲームで、原神の知識を試せます。";

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: `${SITE_URL}/`,
      name: "原神ゲッサー",
      description: siteDescription,
      inLanguage: "ja",
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: "原神ゲッサー",
      url: SITE_URL,
    },
    {
      "@type": "WebApplication",
      name: "原神ゲッサー",
      url: `${SITE_URL}/`,
      description: siteDescription,
      applicationCategory: "GameApplication",
      operatingSystem: "Web",
      browserRequirements: "Requires JavaScript.",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "JPY",
      },
      isPartOf: { "@id": `${SITE_URL}/#website` },
    },
  ],
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: "原神ゲッサー",
  title: {
    default: siteTitle,
    template: "%s | 原神ゲッサー",
  },
  description: siteDescription,
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
    },
  },
  openGraph: {
    type: "website",
    locale: "ja_JP",
    siteName: "原神ゲッサー",
    url: SITE_URL,
    title: siteTitle,
    description: siteDescription,
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "原神ゲッサー" }],
  },
  twitter: {
    card: "summary_large_image",
    title: siteTitle,
    description: siteDescription,
    images: ["/og-image.png"],
  },
  verification: {
    google: "h7V3_l6etGHSkZPAmd4jHy58A-hSqLQa1QywXSLMOng",
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
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        <LegalFooter />
        <FirebaseAnalyticsInit />
        <Analytics />
      </body>
    </html>
  );
}
