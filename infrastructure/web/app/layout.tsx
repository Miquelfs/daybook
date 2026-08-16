import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { BottomNav } from "@/components/BottomNav";

const API =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

// Resolve the theme SERVER-SIDE so `data-theme` is baked into the first byte of
// HTML on every request — no client script, no dependence on browser storage
// (which iOS Safari evicts, the root cause of the app flipping to dark on its
// own). The DB holds the single global preference; the cookie is only a fast
// fallback for a transient API hiccup so we still don't snap to dark.
async function resolveTheme(): Promise<"light" | "dark"> {
  try {
    const res = await fetch(`${API}/settings/theme`, { cache: "no-store" });
    if (res.ok) {
      const j = await res.json();
      if (j?.theme === "light" || j?.theme === "dark") return j.theme;
    }
  } catch {
    /* fall through to cookie */
  }
  try {
    const c = (await cookies()).get("db-theme")?.value;
    if (c === "light" || c === "dark") return c;
  } catch {
    /* ignore */
  }
  return "dark";
}

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Daybook",
  description: "One day at a time. Owned, indexed, and made meaningful.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const theme = await resolveTheme();
  const isLight = theme === "light";
  return (
    <html
      lang="en"
      data-theme={isLight ? "light" : undefined}
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full`}
    >
      <head>
        <meta name="theme-color" content={isLight ? "#F3EFE6" : "#09090B"} />
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      </head>
      <body className="min-h-full bg-[#09090B] text-[#FAFAFA] antialiased">
        <Providers>
          <BottomNav />
          <div className="pt-11">{children}</div>
        </Providers>
      </body>
    </html>
  );
}
