import type { Metadata, Viewport } from "next";
// Root application layout wires global lively scrapbook styling, app metadata, viewport theme, fonts, and providers.

import { Inter, Noto_Sans_SC } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const notoSc = Noto_Sans_SC({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-noto-sc",
});

export const metadata: Metadata = {
  title: "我们之间的小事",
  description: "两个人一起记录、安排和回看日常的小书",
  applicationName: "我们之间的小事",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fff4eb" },
    { media: "(prefers-color-scheme: dark)", color: "#2b1823" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="zh-CN"
      className={`${inter.variable} ${notoSc.variable}`}
      suppressHydrationWarning
    >
      <body className="font-body min-h-dvh antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
