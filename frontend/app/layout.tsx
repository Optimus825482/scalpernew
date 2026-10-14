import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import AuthGate from "./components/AuthGate";
import TopNav from "./components/TopNav";
import ServiceWorkerRegister from "./components/ServiceWorkerRegister";
import InstallPrompt from "./components/InstallPrompt";
import SplashScreen from "./components/SplashScreen";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-sans", display: "swap" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-mono", display: "swap" });

const BASE = process.env.NEXT_BASE_PATH || "";

export const metadata: Metadata = {
  title: "Scalper Intelligent Trade Systems",
  description: "Scalper Intelligent Trade Systems — Tek Sinyal Motoru & Hızlı Binance TR Scalper",
  manifest: `${BASE}/manifest.webmanifest`,
  appleWebApp: {
    capable: true,
    title: "Scalper",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: `${BASE}/icon.svg`, type: "image/svg+xml" },
      { url: `${BASE}/icons/icon-192.png`, sizes: "192x192", type: "image/png" },
      { url: `${BASE}/icons/icon-512.png`, sizes: "512x512", type: "image/png" },
    ],
    apple: `${BASE}/icons/icon-192.png`,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0066ff",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" suppressHydrationWarning>
      <body className={`${inter.variable} ${jetbrains.variable} font-sans min-h-screen bg-canvas text-ink-900`}>
        <SplashScreen />
        <AuthGate>
          <TopNav />
          <div className="mx-auto max-w-[1600px] px-3 py-4 sm:px-6 sm:py-6">
            <main className="min-w-0">{children}</main>
          </div>
        </AuthGate>
        <ServiceWorkerRegister />
        <InstallPrompt />
      </body>
    </html>
  );
}
