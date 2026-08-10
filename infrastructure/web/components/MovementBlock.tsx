"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api, fmtDuration, fmtDistance, activityIcon } from "@/lib/api";
import type { Activity, DailyStats } from "@/lib/api";
import { foodApi } from "@/lib/food-api";
import { SectionLabel } from "./MorningBrief";
import type { ReactNode } from "react";

interface Props {
  date: string;
  activities: Activity[];
  stats: DailyStats | null;
  screenTimeSlot?: ReactNode;
}

export function MovementBlock({ date, activities, stats, screenTimeSlot }: Props) {
  const { data: goal } = useQuery({
    queryKey: ["step-goal", date],
    queryFn: () => api.stepGoal(date),
    staleTime: 30_000,
  });
  const { data: food } = useQuery({
    queryKey: ["food-summary", date],
    queryFn: () => foodApi.summary(date),
    staleTime: 30_000,
  });

  const net = food?.net_vs_burn_kcal ?? null;

  return (
    <section id="movement" className="scroll-mt-20">
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
            <Metric label="Active cal" value={stats.active_calories.toLocaleString()} />
          )}
          {stats?.total_calories != null && (
            <Metric label="Total cal" value={stats.total_calories.toLocaleString()} />
          )}
          {net != null && (
            <Metric
              label="Net cal"
              value={`${net > 0 ? "+" : ""}${Math.round(net).toLocaleString()}`}
              color={net <= 0 ? "text-[#34D399]" : "text-[#F87171]"}
            />
          )}
        </div>
        {screenTimeSlot && (
          <div className="shrink-0 w-[148px]">{screenTimeSlot}</div>
        )}
      </div>

      {/* 10k step goal — complete badge + streak */}
      {goal && stats?.steps != null && <StepGoalRow goal={goal} />}

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

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-[#52525B] uppercase tracking-widest">{label}</span>
      <span className={`text-2xl font-semibold tabular-nums ${color ?? "text-[#A1A1AA]"}`}>
        {value}
      </span>
    </div>
  );
}

function StepGoalRow({ goal }: { goal: import("@/lib/api").StepGoal }) {
  const streakLabel =
    goal.streak > 1 ? `${goal.streak}-day streak` : goal.streak === 1 ? "1 day" : null;

  if (goal.reached) {
    return (
      <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#34D399]/30 bg-[#34D399]/10 px-3 py-1.5">
        <span className="text-sm">✓</span>
        <span className="text-xs font-medium text-[#34D399]">
          {goal.goal.toLocaleString()} steps
        </span>
        {streakLabel && (
          <span className="text-xs text-[#34D399]/80">· {streakLabel} 🔥</span>
        )}
      </div>
    );
  }

  const remaining = goal.steps != null ? goal.goal - goal.steps : goal.goal;
  const pct = goal.steps != null ? Math.min(100, (goal.steps / goal.goal) * 100) : 0;

  return (
    <div className="mb-4 max-w-xs">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-[#52525B]">
          {remaining.toLocaleString()} to {goal.goal.toLocaleString()}
        </span>
        {goal.at_risk && streakLabel && (
          <span className="text-xs text-[#F59E0B]">{streakLabel} on the line 🔥</span>
        )}
      </div>
      <div className="h-1.5 rounded-full bg-[#27272A] overflow-hidden">
        <div className="h-full rounded-full bg-[#F59E0B]" style={{ width: `${pct}%` }} />
      </div>
    </div>
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
          {a.avg_heart_rate ? ` · ${Math.round(a.avg_heart_rate)} bpm avg` : ""}
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
