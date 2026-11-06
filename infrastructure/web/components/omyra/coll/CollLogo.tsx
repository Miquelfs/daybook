/**
 * Coll's mark (brand file: public/coll/coll-logo.svg): a hill on navy, the dotted road up its
 * side and you — the orange dot — at the top. Rounded square, the brand's own colours on both
 * themes (it's a logo, not themed UI). `wordmark` adds COLL in Space Grotesk-style caps.
 */
import { Space_Grotesk } from "next/font/google";

const grotesk = Space_Grotesk({ subsets: ["latin"], weight: ["700"], display: "swap" });

export const COLL_BRAND = { navy: "#1B3A6B", hill: "#2F5FA3", ground: "#0C1F3D", road: "#F4F5F2", accent: "#E8742A", ink: "#0B1626" };

export function CollMark({ size = 40, className = "", title = "Coll" }: { size?: number; className?: string; title?: string }) {
  const b = COLL_BRAND;
  return (
    <svg width={size} height={size} viewBox="0 0 160 160" className={`shrink-0 ${className}`} role="img" aria-label={title}
         style={{ borderRadius: size * (48 / 220), overflow: "hidden", display: "block" }}>
      <title>{title}</title>
      <rect width="160" height="160" rx="35" fill={b.navy} />
      <path d="M-10 128 C 28 128 46 52 86 52 C 122 52 138 128 170 128 L170 170 L-10 170 Z" fill={b.hill} />
      <path d="M-10 152 C 36 152 66 100 112 100 C 138 100 152 124 170 128 L170 170 L-10 170 Z" fill={b.ground} />
      <path d="M24 146 C 56 142 62 96 84 62" fill="none" stroke={b.road} strokeWidth={size < 64 ? 6 : 5}
            strokeLinecap="round" strokeDasharray={size < 64 ? "1 12" : "1 11"} />
      <circle cx="86" cy="54" r={size < 64 ? 9 : 8} fill={b.accent} />
    </svg>
  );
}

/** The mark with COLL beside it, for headers. */
export function CollLogo({ size = 40, wordmark = false, className = "" }: { size?: number; wordmark?: boolean; className?: string }) {
  if (!wordmark) return <CollMark size={size} className={className} />;
  return (
    <span className={`inline-flex items-center gap-3 ${className}`}>
      <CollMark size={size} />
      <span className={`${grotesk.className} font-bold leading-none text-[#FAFAFA]`}
            style={{ fontSize: size * 0.62, letterSpacing: "0.04em" }}>
        COLL
      </span>
    </span>
  );
}
