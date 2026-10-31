import type { ActivityStory } from "@/lib/api";
import { Block, Chip, Stat, Stats } from "@/components/ui/kit";

/** What this activity added: plan consistency, new road, villages — plain tiles, like the rest of the app. */
export function HighlightsCard({ story }: { story: ActivityStory }) {
  const { plan, explore } = story;
  const villages = explore?.villages ?? [];
  const fresh = villages.filter((v) => v.new);
  const tiles: React.ReactNode[] = [];

  if (plan && plan.streak > 0) {
    tiles.push(<Stat key="streak" label="Plan streak" value={plan.streak} unit="in a row" sub={`${plan.goal} sessions`} />);
  }
  if (plan && plan.pct_4w != null) {
    tiles.push(<Stat key="4w" label="Last 4 weeks" value={`${plan.pct_4w}%`} sub={`${plan.done_4w} of ${plan.planned_4w} done`} />);
  }
  if (explore && explore.earlier > 0) {
    tiles.push(<Stat key="road" label="New road" value={explore.new_km} unit="km"
                     sub={explore.new_km > 0 ? `${explore.new_pct}% of the route` : "all on known roads"} />);
  }
  if (villages.length > 0) {
    tiles.push(<Stat key="vill" label="Villages" value={fresh.length ? `${fresh.length} new` : villages.length}
                     sub={fresh.length ? `of ${villages.length} passed` : "all visited before"} />);
  }
  if (!tiles.length) return null;

  return (
    <div className="mb-8">
      <Block title="Highlights">
        <Stats cols={tiles.length >= 4 ? 4 : tiles.length === 3 ? 3 : 2}>{tiles}</Stats>
        {villages.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {villages.map((v) => (
              <Chip key={v.name} accent={v.new} href={`/explore/place/${encodeURIComponent(v.name)}`}
                    title={v.new ? "first time here" : v.first_date ? `first passed ${v.first_date}` : undefined}>
                {v.name}{v.new ? " · new" : ""}
              </Chip>
            ))}
          </div>
        )}
      </Block>
    </div>
  );
}
