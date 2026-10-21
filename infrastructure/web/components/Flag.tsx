import { FLAG } from "@/lib/flags";

/** The senyera — no emoji for it renders anywhere (only GB nations are RGI). */
function Senyera({ size }: { size: number }) {
  const h = Math.round(size * 0.72);
  return (
    <svg width={size} height={h} viewBox="0 0 9 6" role="img" aria-label="Catalonia"
         className="inline-block align-[-0.1em] rounded-[2px] shrink-0">
      <rect width="9" height="6" fill="#FCDD09" />
      {[1, 2.333, 3.667, 5].map((y) => <rect key={y} y={y - 0.333} width="9" height="0.667" fill="#DA121A" />)}
    </svg>
  );
}

/** A place's flag: the senyera for Catalonia, the country's emoji otherwise. */
export function Flag({ country, region, size = 16, fallback = "🌍" }: {
  country: string | null | undefined;
  region?: string | null;
  size?: number;
  fallback?: string;
}) {
  if (region === "Catalonia") return <Senyera size={size} />;
  return <>{FLAG[country ?? ""] ?? fallback}</>;
}
