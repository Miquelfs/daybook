import { ActivityMap } from "@/components/ActivityMap";
import { Chip, Panel, Stat } from "@/components/ui/kit";

export type HeroStat = { label: string; value: string | null };

/** "52.4 km" → value "52.4" + unit "km", so numbers and units sit like every other Stat. */
function split(v: string): { value: string; unit?: string } {
  const m = v.match(/^(?:↑\s*)?(.*?)\s*(km\/h|km|m|bpm|kcal|\/km|W)$/);
  return m ? { value: m[1], unit: m[2] } : { value: v };
}

/**
 * The top of an activity: the route as a banner, then what / when, the headline numbers
 * and the rest as chips — built from the kit so it reads like the rest of Daybook.
 */
export function ActivityHero({
  icon, title, typeLabel, when, source, strava, plan, stats, chips, polyline, newRoad, newKm, children,
}: {
  icon: string; title: string; typeLabel: string; color?: string; when: string; source: string | null;
  strava?: boolean; plan?: { label: string; href: string } | null;
  stats: HeroStat[]; chips: (string | null | false | undefined)[];
  polyline?: string | null; newRoad?: string[]; newKm?: number | null;
  children?: React.ReactNode;
}) {
  const shown = stats.filter((s): s is { label: string; value: string } => !!s.value && s.value !== "—");
  const extra = chips.filter((c): c is string => !!c);
  return (
    <Panel className="mb-8 overflow-hidden">
      {polyline && (
        <div className="relative border-b border-[#27272A]">
          <ActivityMap polyline={polyline} highlight={newRoad} height="260px" bare />
          {newKm ? (
            <span className="absolute left-3 bottom-3 z-[500] inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium"
                  style={{ background: "rgba(255,255,255,0.92)", color: "#111" }}>
              <span className="w-3 h-1 rounded-full" style={{ background: "#10B981" }} />
              {newKm} km of new road
            </span>
          ) : null}
        </div>
      )}

      <div className="p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <span className="text-3xl leading-none">{icon}</span>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight truncate">{title}</h1>
            <p className="text-xs text-[#71717A] mt-0.5">
              {when}{source ? <span className="capitalize"> · {source}</span> : null}{strava ? " · Strava" : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-3">
          <Chip><span className="capitalize">{typeLabel}</span></Chip>
          {plan && <Chip accent href={plan.href}>✓ {plan.label}</Chip>}
        </div>

        {shown.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5">
            {shown.map((s) => {
              const v = split(s.value);
              return <Stat key={s.label} plain label={s.label} value={v.value} unit={v.unit} />;
            })}
          </div>
        )}

        {extra.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-4">
            {extra.map((c) => <Chip key={c}>{c}</Chip>)}
          </div>
        )}

        {children}
      </div>
    </Panel>
  );
}
