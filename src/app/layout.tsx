import { SpeedInsights } from "@vercel/speed-insights/next";
import type { Metadata, Viewport } from "next";
import Script from "next/script";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { AppStateProvider } from "@/components/AppState";
import { APPEARANCE_SCRIPT } from "@/lib/appearance";
import "./globals.css";

export const metadata: Metadata = {
  title: "MARYX Ai",
  description: "MARYX Ai — собственный искусственный интеллект: чат, генерация изображений и видео, свои ассистенты.",
  // Installed on a phone's home screen, it opens like an app (see manifest.ts).
  appleWebApp: { capable: true, title: "MARYX", statusBarStyle: "black-translucent" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#09080f",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The saved theme is set on <html> by the script before React hydrates.
    <html lang="ru" className="dark h-full antialiased" suppressHydrationWarning>
      <head>
        <Script id="maryx-appearance" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: APPEARANCE_SCRIPT }} />
      </head>
      <body className="h-full bg-zinc-950">
        <AppStateProvider>
          <AppShell>{children}</AppShell>
        </AppStateProvider>
        {/* Vercel Speed Insights: page speed of real visitors (works on Vercel, does nothing elsewhere). */}
        <SpeedInsights />
      </body>
    </html>
  );
}
