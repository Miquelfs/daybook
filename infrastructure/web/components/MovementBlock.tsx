import Link from "next/link";
import { fmtDuration, fmtDistance, activityIcon } from "@/lib/api";
import type { Activity, DailyStats } from "@/lib/api";
import { SectionLabel } from "./MorningBrief";
import type { ReactNode } from "react";

interface Props {
  activities: Activity[];
  stats: DailyStats | null;
  screenTimeSlot?: ReactNode;
}

export function MovementBlock({ activities, stats, screenTimeSlot }: Props) {
  return (
    <section>
      {/* Labels row */}
      <div className="flex items-start justify-between mb-3">
        <SectionLabel>Movement</SectionLabel>
        {screenTimeSlot && <SectionLabel>Screen Time</SectionLabel>}
      </div>

      {/* Stats row: Steps/Cal on the left, ScreenTime on the right — same baseline */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex gap-6 flex-wrap">
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
        {screenTimeSlot && (
          <div className="shrink-0 w-[148px]">{screenTimeSlot}</div>
        )}
      </div>

      {/* Activities — always full width */}
      {activities.length === 0 ? (
        <p className="text-sm text-[#52525B]">No recorded activities</p>
      ) : (
        <div className="flex flex-col gap-2">
          {activities.map((a) => (
            <ActivityRow key={a.id} activity={a} />
          ))}
        </div>
      )}
    </section>
  );
}

function ActivityRow({ activity: a }: { activity: Activity }) {
  const inner = (
    <div className="flex items-center gap-3 bg-[#18181B] border border-[#27272A] rounded-lg px-4 py-3 transition-colors hover:border-[#3F3F46]">
      <span className="text-xl">{activityIcon(a.activity_type)}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{a.name ?? a.activity_type ?? "Activity"}</p>
        <p className="text-xs text-[#A1A1AA] mt-0.5">
          {fmtDuration(a.duration_seconds)}
          {a.distance_meters ? ` · ${fmtDistance(a.distance_meters)}` : ""}
          {a.avg_heart_rate ? ` · ${a.avg_heart_rate} bpm avg` : ""}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {a.elevation_gain_meters ? (
          <span className="text-xs text-[#52525B]">↑ {Math.round(a.elevation_gain_meters)}m</span>
        ) : null}
        {a.strava_id && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#FC4C02]/10 text-[#FC4C02] font-medium">S</span>
        )}
        {a.has_polyline && (
          <span className="text-[10px] text-[#52525B]">📍</span>
        )}
        <span className="text-[#3F3F46]">›</span>
      </div>
    </div>
  );

  return (
    <Link href={`/activity/${encodeURIComponent(a.id)}`} className="block">
      {inner}
    </Link>
  );
}
