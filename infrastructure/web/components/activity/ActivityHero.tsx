import Link from "next/link";
import { ActivityMap } from "@/components/ActivityMap";

const COLS: Record<number, string> = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-2 sm:grid-cols-4" };

export type HeroStat = { label: string; value: string | null };

/** "52.4 km" → big "52.4" + small "km" (the way activity apps set their headline numbers). */
function Big({ value }: { value: string }) {
  const m = value.match(/^(.*?)(\s*(km\/h|km|m|bpm|kcal|\/km|W))$/);
  const arrow = value.startsWith("↑ ");
  const body = arrow ? value.slice(2) : value;
  const mm = arrow ? body.match(/^(.*?)(\s*(m))$/) : m;
  return (
    <span className="text-[26px] sm:text-[30px] leading-none font-semibold tabular-nums tracking-tight">
      {arrow && <span className="text-[#71717A] text-lg mr-0.5">↑</span>}
      {mm ? <>{mm[1]}<span className="text-sm font-medium text-[#71717A] ml-1">{mm[3]}</span></> : body}
    </span>
  );
}

/**
 * The top of an activity, laid out like the activity apps do it: the route as a banner, then who /
 * what / when, the headline numbers large with hairline dividers, and the rest as quiet chips.
 */
export function ActivityHero({
  icon, title, typeLabel, color, when, source, strava, plan, stats, chips, polyline, newRoad, newKm, children,
}: {
  icon: string; title: string; typeLabel: string; color: string; when: string; source: string | null;
  strava?: boolean; plan?: { label: string; href: string } | null;
  stats: HeroStat[]; chips: (string | null | false | undefined)[];
  polyline?: string | null; newRoad?: string[]; newKm?: number | null;
  children?: React.ReactNode;
}) {
  const shown = stats.filter((s): s is { label: string; value: string } => !!s.value && s.value !== "—");
  const extra = chips.filter((c): c is string => !!c);
  return (
    <section className="mb-8 rounded-3xl overflow-hidden border border-[#27272A] bg-[#0D0D0F]">
      {polyline && (
        <div className="relative">
          <ActivityMap polyline={polyline} highlight={newRoad} height="300px" bare />
          {newKm ? (
            <span className="absolute left-3 bottom-3 z-[500] inline-flex items-center gap-1.5 rounded-full backdrop-blur px-2.5 py-1 text-[11px] font-medium shadow-sm"
                  style={{ background: "rgba(255,255,255,0.92)", color: "#111" }}>
              <span className="w-3 h-1 rounded-full" style={{ background: "#10B981" }} />
              {newKm} km of new road
            </span>
          ) : null}
        </div>
      )}

      <div className="p-5 sm:p-6">
        <div className="flex items-start gap-3.5">
          <span className="shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center text-2xl"
                style={{ background: `color-mix(in srgb, ${color} 16%, transparent)` }}>{icon}</span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[22px] sm:text-2xl font-semibold tracking-tight leading-tight">{title}</h1>
            <p className="text-sm text-[#71717A] mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1">
              <span>{when}</span>
              {source && <><span className="text-[#3F3F46]">·</span><span className="capitalize">{source}</span></>}
              {strava && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#FC4C02]/10 text-[#FC4C02] font-medium">Strava</span>}
            </p>
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              <span className="text-[11px] px-2 py-0.5 rounded-full font-medium capitalize"
                    style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}>{typeLabel}</span>
              {plan && (
                <Link href={plan.href} className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-[#10B981]/12 text-[#10B981] hover:opacity-80">
                  ✓ {plan.label}
                </Link>
              )}
            </div>
          </div>
        </div>

        {shown.length > 0 && (
          <div className={`grid gap-y-5 mt-6 ${COLS[Math.min(shown.length, 4)]}`}>
            {shown.map((s, i) => (
              <div key={s.label} className={`min-w-0 px-3 first:pl-0 ${i % 2 === 1 ? "border-l border-[#27272A]" : ""} ${
                i >= 2 ? "sm:border-l sm:border-[#27272A]" : ""} ${i === 2 ? "pl-0 sm:pl-3" : ""}`}>
                <p className="text-[10px] text-[#71717A] uppercase tracking-widest mb-1.5">{s.label}</p>
                <Big value={s.value} />
              </div>
            ))}
          </div>
        )}

        {extra.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-5">
            {extra.map((c) => (
              <span key={c} className="text-xs px-2.5 py-1 rounded-full bg-[#18181B] text-[#A1A1AA] tabular-nums">{c}</span>
            ))}
          </div>
        )}

        {children}
      </div>
    </section>
  );
}
