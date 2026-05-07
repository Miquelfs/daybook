import { fmtDuration, fmtDistance, activityIcon } from "@/lib/api";
import type { Activity, DailyStats } from "@/lib/api";
import { SectionLabel } from "./MorningBrief";

interface Props {
  activities: Activity[];
  stats: DailyStats | null;
}

export function MovementBlock({ activities, stats }: Props) {
  return (
    <section>
      <SectionLabel>Movement</SectionLabel>

      <div className="flex gap-6 mb-4 flex-wrap">
        {stats?.steps != null && (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-[#52525B] uppercase tracking-widest">Steps</span>
            <span className="text-2xl font-semibold tabular-nums">
              {stats.steps.toLocaleString()}
            </span>
          </div>
        )}
        {stats?.active_calories != null && (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-[#52525B] uppercase tracking-widest">Active cal</span>
            <span className="text-2xl font-semibold tabular-nums text-[#A1A1AA]">
              {stats.active_calories}
            </span>
          </div>
        )}
      </div>

      {activities.length === 0 ? (
        <p className="text-sm text-[#52525B]">No recorded activities</p>
      ) : (
        <div className="flex flex-col gap-2">
          {activities.map((a) => (
            <ActivityRow key={a.activity_id} activity={a} />
          ))}
        </div>
      )}
    </section>
  );
}

function ActivityRow({ activity: a }: { activity: Activity }) {
  return (
    <div className="flex items-center gap-3 bg-[#18181B] border border-[#27272A] rounded-lg px-4 py-3">
      <span className="text-xl">{activityIcon(a.type)}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{a.name ?? a.type ?? "Activity"}</p>
        <p className="text-xs text-[#A1A1AA] mt-0.5">
          {fmtDuration(a.duration_seconds)}
          {a.distance_meters ? ` · ${fmtDistance(a.distance_meters)}` : ""}
          {a.avg_hr ? ` · ${a.avg_hr} bpm avg` : ""}
        </p>
      </div>
      {a.elevation_gain ? (
        <span className="text-xs text-[#52525B] shrink-0">↑ {Math.round(a.elevation_gain)}m</span>
      ) : null}
    </div>
  );
}
