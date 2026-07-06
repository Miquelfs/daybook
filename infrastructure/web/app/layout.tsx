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
