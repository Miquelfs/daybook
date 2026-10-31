import { CalendarCheck, Flame, MapPin, Route } from "lucide-react";
import type { ActivityStory } from "@/lib/api";
import { ink } from "@/lib/duty";

type Medal = { key: string; Icon: typeof Flame; color: string; value: string; label: string; sub: string; lit: boolean };

/** One achievement: a round badge (full colour when earned, muted otherwise), the number, a label. */
function Medallion({ m }: { m: Medal }) {
  return (
    <div className="flex flex-col items-center text-center min-w-0">
      <span className="relative w-14 h-14 rounded-full flex items-center justify-center"
            style={m.lit
              ? { background: `radial-gradient(circle at 30% 25%, color-mix(in srgb, ${m.color} 55%, white), ${m.color})`,
                  boxShadow: `0 6px 18px -6px ${m.color}` }
              : { background: `color-mix(in srgb, ${m.color} 14%, transparent)` }}>
        <m.Icon size={24} strokeWidth={2} style={{ color: m.lit ? "#FFFFFF" : ink(m.color) }} />
      </span>
      <p className="text-lg font-semibold tabular-nums mt-2 leading-none" style={m.lit ? { color: ink(m.color) } : undefined}>{m.value}</p>
      <p className="text-[10px] text-[#71717A] uppercase tracking-widest mt-1">{m.label}</p>
      <p className="text-[11px] text-[#52525B] mt-0.5 leading-snug">{m.sub}</p>
    </div>
  );
}

/** What this activity added — plan consistency, new road, villages — as achievement badges. */
export function HighlightsCard({ story }: { story: ActivityStory }) {
  const { plan, explore } = story;
  const villages = explore?.villages ?? [];
  const fresh = villages.filter((v) => v.new);
  const medals: Medal[] = [];

  if (plan && plan.streak > 0) {
    medals.push({ key: "streak", Icon: Flame, color: "#F97316", value: `${plan.streak}`, label: "in a row",
                  sub: `${plan.goal} sessions`, lit: plan.streak >= 3 });
  }
  if (plan && plan.pct_4w != null) {
    medals.push({ key: "4w", Icon: CalendarCheck, color: "#22C55E", value: `${plan.pct_4w}%`, label: "4 weeks",
                  sub: `${plan.done_4w} of ${plan.planned_4w} done`, lit: plan.pct_4w >= 90 });
  }
  if (explore && explore.earlier > 0) {
    medals.push({ key: "road", Icon: Route, color: "#10B981", value: explore.new_km > 0 ? `${explore.new_km} km` : "0 km",
                  label: "new road", sub: explore.new_km > 0 ? `${explore.new_pct}% of the route` : "all known roads",
                  lit: explore.new_km >= 1 });
  }
  if (villages.length > 0) {
    medals.push({ key: "vill", Icon: MapPin, color: "#8B5CF6", value: fresh.length ? `${fresh.length} new` : `${villages.length}`,
                  label: "villages", sub: fresh.length ? `of ${villages.length} passed` : "all visited before",
                  lit: fresh.length > 0 });
  }
  if (!medals.length) return null;

  return (
    <section className="mb-8">
      <p className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Achievements</p>
      <div className="rounded-3xl border border-[#27272A] bg-[#0D0D0F] px-4 py-5">
        <div className={`grid gap-3 ${medals.length >= 4 ? "grid-cols-4" : medals.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
          {medals.map((m) => <Medallion key={m.key} m={m} />)}
        </div>
        {villages.length > 0 && (
          <div className="flex flex-wrap justify-center gap-1.5 mt-5 pt-4 border-t border-[#18181B]">
            {villages.map((v) => (
              <span key={v.name}
                    title={v.new ? "first time here" : v.first_date ? `first passed ${v.first_date}` : undefined}
                    className={`text-xs px-2.5 py-1 rounded-full inline-flex items-center gap-1 ${v.new ? "" : "bg-[#18181B] text-[#A1A1AA]"}`}
                    style={v.new
                      ? { background: "color-mix(in srgb, #8B5CF6 14%, transparent)", color: ink("#8B5CF6"), fontWeight: 600 }
                      : undefined}>
                <MapPin size={11} />{v.name}{v.new ? " · new" : ""}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
