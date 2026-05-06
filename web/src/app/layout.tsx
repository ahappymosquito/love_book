import type { Metadata, Viewport } from "next";
import { Fraunces, Inter, Noto_Sans_SC } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-fraunces",
});

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
  description: "两个人的回声 · 一本只属于你们的事件书",
  applicationName: "我们之间的小事",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fdf6f1" },
    { media: "(prefers-color-scheme: dark)", color: "#1c1614" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="zh-CN"
      className={`${fraunces.variable} ${inter.variable} ${notoSc.variable}`}
      suppressHydrationWarning
    >
      <body className="font-body min-h-dvh antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
