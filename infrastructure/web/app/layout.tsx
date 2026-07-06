import type { Metadata } from "next";
import { Fraunces, Alegreya_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { BottomNav } from "@/components/BottomNav";

// A pilot's logbook: editorial serif display, humanist body, instrument mono.
const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
});

const body = Alegreya_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-body",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Daybook",
  description: "One day at a time. Owned, indexed, and made meaningful.",
};

// Applies the stored theme before first paint (no flash). Dark is default.
const themeScript = `
(function () {
  try {
    var t = localStorage.getItem("db-theme");
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
      className={`${display.variable} ${body.variable} ${mono.variable} h-full`}
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
