import Link from "next/link";

// A summit sign: white enamel plate, coloured band on top, name in capitals, altitude big.
// Physical colours on purpose: it reads as a sign on paper and on the dark theme alike.
const BAND: Record<string, string> = {
  col: "#B91C1C", saddle: "#B91C1C", pass: "#B91C1C",
  viewpoint: "#1E3A5F", peak: "#3F3F46", place: "#1E3A5F", summit: "#1E3A5F",
};
const LABEL: Record<string, string> = {
  col: "COL", saddle: "COL", pass: "COL", viewpoint: "MIRADOR", peak: "CIM", place: "TOP", summit: "TOP",
};

function Peak() {
  return (
    <svg width="14" height="10" viewBox="0 0 14 10" aria-hidden>
      <path d="M0 10 L5 2 L7.5 5.5 L9.5 3 L14 10 Z" fill="#FFFFFF" fillOpacity="0.9" />
    </svg>
  );
}

export function ColSign({ name, ele, kind = "col", footer, faded = false, size = "md", href, title }: {
  name: string; ele: number | null | undefined; kind?: string; footer?: React.ReactNode; faded?: boolean;
  size?: "sm" | "md" | "lg"; href?: string; title?: string;
}) {
  const big = size === "lg" ? "text-5xl" : size === "sm" ? "text-lg" : "text-3xl";
  const body = (
    <div title={title}
         className={`relative rounded-xl overflow-hidden h-full transition-transform ${href ? "hover:-translate-y-0.5" : ""} ${faded ? "opacity-60" : ""}`}
         style={{ background: "#FBFAF6", border: `1.5px ${faded ? "dashed" : "solid"} ${faded ? "#A8A29E" : "#E2DCCB"}`,
                  boxShadow: faded ? undefined : "0 1px 0 rgba(28,25,23,0.06), 0 6px 14px -10px rgba(28,25,23,0.35)" }}>
      <div className={`flex items-center justify-between ${size === "sm" ? "px-2 h-5" : "px-2.5 h-6"}`}
           style={{ background: faded ? "#A8A29E" : BAND[kind] ?? BAND.col }}>
        <span className="text-[9px] font-bold tracking-[0.25em] text-white">{LABEL[kind] ?? "COL"}</span>
        <Peak />
      </div>
      <div className={size === "sm" ? "px-2 pt-1.5 pb-2" : "px-2.5 pt-2 pb-2.5"} style={{ color: "#1C1917" }}>
        <p className={`${size === "sm" ? "text-[10px]" : size === "lg" ? "text-sm" : "text-[11px]"} font-bold uppercase leading-tight tracking-wide line-clamp-2`}
           style={{ minHeight: size === "sm" ? undefined : "2.4em" }}>
          {name}
        </p>
        <p className="mt-1 font-semibold tabular-nums leading-none">
          <span className={big}>{ele != null ? Math.round(ele).toLocaleString("en-GB") : "—"}</span>
          <span className={size === "lg" ? "text-base" : "text-xs"}> m</span>
        </p>
        {footer && <div className="mt-1.5 text-[10px] leading-snug" style={{ color: "#57534E" }}>{footer}</div>}
      </div>
    </div>
  );
  return href ? <Link href={href} className="block h-full">{body}</Link> : body;
}

export const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;

export const hms = (s: number | null | undefined) => {
  if (!s) return "—";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.round(s % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
};
