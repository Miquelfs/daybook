import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { BottomNav } from "@/components/BottomNav";

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

// Applies the stored theme before first paint (no flash).
// Resolution order: server-set cookie → localStorage. The device's
// prefers-color-scheme is deliberately NOT consulted: it caused the app to flip
// to dark on its own whenever the persisted preference had been evicted (iOS
// Safari ITP) while the device was in auto/scheduled dark mode. The cookie is
// now written server-side (/api/theme), which ITP does not cap to 7 days, so
// the chosen appearance sticks. If nothing is stored we keep the dark default.
const themeScript = `
(function () {
  try {
    var t;
    var c = document.cookie.match(/(?:^|; )db-theme=([^;]+)/);
    if (c) t = decodeURIComponent(c[1]);
    if (!t) { try { t = localStorage.getItem("db-theme"); } catch (e) {} }
    if (t === "light") {
      document.documentElement.setAttribute("data-theme", "light");
      var m = document.querySelector('meta[name="theme-color"]');
      if (m) m.setAttribute("content", "#F3EFE6");
    }
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full`}
    >
      <head>
        <meta name="theme-color" content="#09090B" />
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
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
