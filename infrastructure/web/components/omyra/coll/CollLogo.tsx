/**
 * Coll's mark: a round badge with a col — the saddle between two peaks the Mallorca 312 is
 * named for — and the switchback road climbing to it, the rider a dot on top. Ink badge, white
 * ridge, amber road (the one accent). The same on paper and ink themes: it's a logo.
 */
export function CollLogo({ size = 40, className = "", title = "Coll" }: { size?: number; className?: string; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} role="img" aria-label={title}>
      <title>{title}</title>
      <defs>
        <clipPath id="coll-badge"><circle cx="32" cy="32" r="30" /></clipPath>
      </defs>
      <circle cx="32" cy="32" r="31" fill="#141416" />
      <g clipPath="url(#coll-badge)">
        {/* the far ridge, faint */}
        <path d="M-2 40 L12 30 L20 34 L30 26 L44 33 L52 28 L66 36 L66 66 L-2 66 Z" fill="#1F1F23" />
        {/* the two peaks and the col between them */}
        <path d="M-2 50 L17 22 C24 33 40 33 47 17 L66 50 L66 66 L-2 66 Z" fill="#2A2A30" />
        <path d="M-2 50 L17 22 C24 33 40 33 47 17 L66 50" fill="none" stroke="#F4F4F5"
              strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
        {/* snow on the high peak */}
        <path d="M44 22.6 L47 17 L50.2 22.6 L48.3 21.6 L47 23.2 L45.6 21.7 Z" fill="#F4F4F5" />
        {/* the switchback road, up to the col (the low point of the saddle) */}
        <path d="M27 64 L37 57.5 L24 52 L37 46 L27 41 L34 36.5 L32 31.5" fill="none" stroke="#F59E0B"
              strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" />
      </g>
      {/* the rider, on the col */}
      <circle cx="32" cy="30" r="3.4" fill="#F59E0B" stroke="#141416" strokeWidth="1.6" />
      <circle cx="32" cy="32" r="30.5" fill="none" stroke="#3F3F46" strokeWidth="1" />
    </svg>
  );
}
