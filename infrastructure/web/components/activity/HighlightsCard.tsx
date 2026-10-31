import type { ActivityStory } from "@/lib/api";

function Badge({ label, value, sub, lit }: { label: string; value: React.ReactNode; sub?: React.ReactNode; lit?: boolean }) {
  return (
    <div className={`rounded-xl px-3 py-2.5 min-w-0 border ${lit ? "border-[#F59E0B]/40 bg-[#F59E0B]/10" : "border-transparent bg-[#18181B]"}`}>
      <p className="text-[10px] text-[#52525B] uppercase tracking-widest">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${lit ? "text-[#F59E0B]" : "text-[#FAFAFA]"}`}>{value}</p>
      {sub && <p className="text-xs text-[#71717A] leading-snug">{sub}</p>}
    </div>
  );
}

/** What this activity added: plan consistency, new road and villages — the things worth a small celebration. */
export function HighlightsCard({ story }: { story: ActivityStory }) {
  const { plan, explore } = story;
  const villages = explore?.villages ?? [];
  const fresh = villages.filter((v) => v.new);
  const badges: React.ReactNode[] = [];

  if (plan && plan.streak > 0) {
    badges.push(<Badge key="streak" label="Plan streak" value={`${plan.streak} in a row`} lit={plan.streak >= 5}
                       sub={`${plan.goal} sessions done without a miss`} />);
  }
  if (plan && plan.pct_4w != null) {
    badges.push(<Badge key="4w" label="Last 4 weeks" value={`${plan.pct_4w}%`} lit={plan.pct_4w >= 90}
                       sub={`${plan.done_4w} of ${plan.planned_4w} planned sessions done`} />);
  }
  if (explore && explore.earlier > 0) {
    badges.push(<Badge key="road" label="New road" value={explore.new_km > 0 ? `${explore.new_km} km` : "None"}
                       lit={explore.new_km >= 5}
                       sub={explore.new_km > 0 ? `${explore.new_pct}% of the route · amber on the map` : "all on roads you know"} />);
  }
  if (villages.length > 0) {
    badges.push(<Badge key="vill" label="Villages" value={fresh.length ? `${fresh.length} new` : villages.length}
                       lit={fresh.length > 0}
                       sub={fresh.length ? `of ${villages.length} passed` : `passed, all visited before`} />);
  }
  if (!badges.length) return null;

  return (
    <section className="mb-8">
      <p className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Highlights</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{badges}</div>
      {villages.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {villages.map((v) => (
            <span key={v.name}
                  title={v.new ? "first time" : v.first_date ? `first passed ${v.first_date}` : undefined}
                  className={`text-xs px-2 py-0.5 rounded-full ${v.new ? "bg-[#F59E0B]/15 text-[#F59E0B] font-semibold" : "bg-[#18181B] text-[#A1A1AA]"}`}>
              {v.name}{v.new ? " ✦" : ""}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
