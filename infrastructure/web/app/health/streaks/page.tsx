"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Activity, Moon, Dumbbell, Flame, AlertTriangle } from "lucide-react";
import { format, parseISO } from "date-fns";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const ACTIVITY_ICON: Record<string, string> = {
  running: "🏃", cycling: "🚴", swimming: "🏊", hiking: "🥾",
  walking: "🚶", strength_training: "🏋️", yoga: "🧘", rowing: "🚣",
  skiing: "⛷", snowboarding: "🏂", surfing: "🏄", tennis: "🎾",
  soccer: "⚽", basketball: "🏀", elliptical: "⚙️",
};
function actIcon(t: string) { return ACTIVITY_ICON[t.toLowerCase()] ?? "🏅"; }

type StreakData = {
  current_streak: number;
  longest_streak: number;
  longest_streak_end: string | null;
  current_rest: number;
  longest_rest: number;
  total_active_days: number;
  weekly_avg: number;
  monthly_avg: number;
  heatmap_weeks: { week: string; week_start: string; count: number }[];
  by_type: { type: string; sessions: number; active_days: number; longest_streak: number }[];
};

type SportDetail = {
  type: string;
  dates: string[];
};

export default function ActivityStreaksPage() {
  const [selectedSport, setSelectedSport] = useState<string | null>(null);

  const { data: streaks, isLoading } = useQuery<StreakData>({
    queryKey: ["activity-streaks"],
    queryFn: () => fetch(`${BASE}/activities/streaks`).then(r => r.json()),
  });

  const { data: sportDetail, isLoading: detailLoading } = useQuery<SportDetail>({
    queryKey: ["activity-streaks-sport", selectedSport],
    queryFn: () =>
      fetch(`${BASE}/activities/streaks?activity_type=${encodeURIComponent(selectedSport!)}`)
        .then(r => r.json())
        .then((d: StreakData) =>
          // We need the actual dates list — fetch activities for this type
          fetch(`${BASE}/activities?start=2020-01-01&end=${new Date().toISOString().slice(0, 10)}&activity_type=${encodeURIComponent(selectedSport!)}`)
            .then(r => r.json())
            .then((activities: { date: string }[]) => ({
              type: selectedSport!,
              dates: [...new Set(activities.map((a: { date: string }) => a.date))].sort().reverse(),
            }))
        ),
    enabled: !!selectedSport,
  });

  if (selectedSport) {
    return (
      <main className="max-w-2xl mx-auto px-4 pb-20 pt-8">
        <button
          onClick={() => setSelectedSport(null)}
          className="text-xs text-[#71717A] hover:text-[#A1A1AA] uppercase tracking-widest mb-3 inline-block"
        >
          ← Back
        </button>
        <div className="flex items-center gap-3 mb-6">
          <span className="text-3xl">{actIcon(selectedSport)}</span>
          <div>
            <h1 className="text-xl font-semibold capitalize">{selectedSport.replace(/_/g, " ")}</h1>
            <p className="text-sm text-[#71717A]">All sessions</p>
          </div>
        </div>

        {detailLoading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="h-10 bg-[#18181B] rounded-lg animate-pulse" />
            ))}
          </div>
        ) : sportDetail && sportDetail.dates.length > 0 ? (
          <div className="flex flex-col gap-1">
            {sportDetail.dates.map((d) => (
              <Link
                key={d}
                href={`/day/${d}`}
                className="flex items-center gap-3 px-4 py-3 bg-[#0D0D0F] border border-[#27272A] rounded-xl hover:border-[#3F3F46] transition-colors"
              >
                <span className="text-sm tabular-nums text-[#52525B] w-24 shrink-0">
                  {format(parseISO(d), "d MMM yyyy")}
                </span>
                <span className="text-xs text-[#3F3F46]">
                  {format(parseISO(d), "EEE")}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[#52525B] text-center py-8">No sessions found.</p>
        )}
      </main>
    );
  }

  return (
    <main className="max-w-2xl mx-auto px-4 pb-20 pt-8">
      {/* Header + sub-nav */}
      <div className="mb-6">
        <Link href="/health" className="text-xs text-[#71717A] hover:text-[#A1A1AA] uppercase tracking-widest inline-block mb-2">
          ← Health
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Activity Streaks</h1>
        <p className="text-sm text-[#71717A] mt-0.5">Consistency across all logged activities</p>

        <div className="flex gap-0 bg-[#0D0D0F] border border-[#27272A] rounded-lg p-1 mt-4 overflow-x-auto">
          <Link href="/health" className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-[#52525B] hover:text-[#A1A1AA] transition-colors whitespace-nowrap">
            <Activity size={13} />Overview
          </Link>
          <Link href="/training" className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-[#52525B] hover:text-[#A1A1AA] transition-colors whitespace-nowrap">
            <Dumbbell size={13} />Training
          </Link>
          <Link href="/health/sleep" className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-[#52525B] hover:text-[#A1A1AA] transition-colors whitespace-nowrap">
            <Moon size={13} />Sleep
          </Link>
          <span className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-[#27272A] text-[#FAFAFA] whitespace-nowrap">
            <Flame size={13} />Streaks
          </span>
          <Link href="/health/injuries" className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-[#52525B] hover:text-[#A1A1AA] transition-colors whitespace-nowrap">
            <AlertTriangle size={13} />Injuries
          </Link>
        </div>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 bg-[#18181B] rounded-xl animate-pulse" />)}
        </div>
      )}

      {!isLoading && streaks && (
        <div className="space-y-6">
          {/* Key numbers */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-4">
              <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Current streak</p>
              <p className="text-3xl font-bold tabular-nums text-[#F59E0B]">{streaks.current_streak}</p>
              <p className="text-xs text-[#52525B] mt-0.5">active {streaks.current_streak === 1 ? "day" : "days"}</p>
            </div>
            <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-4">
              <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Longest streak</p>
              <p className="text-3xl font-bold tabular-nums text-[#22C55E]">{streaks.longest_streak}</p>
              <p className="text-xs text-[#52525B] mt-0.5">
                {streaks.longest_streak_end ? `ended ${format(parseISO(streaks.longest_streak_end), "d MMM yy")}` : "—"}
              </p>
            </div>
            <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-4">
              <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Rest days now</p>
              <p className="text-3xl font-bold tabular-nums text-[#A1A1AA]">{streaks.current_rest}</p>
              <p className="text-xs text-[#52525B] mt-0.5">since last activity</p>
            </div>
            <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-4">
              <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Longest rest</p>
              <p className="text-3xl font-bold tabular-nums text-[#71717A]">{streaks.longest_rest}</p>
              <p className="text-xs text-[#52525B] mt-0.5">days without activity</p>
            </div>
          </div>

          {/* Frequency */}
          <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-4">
            <p className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Frequency</p>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-xl font-semibold tabular-nums">{streaks.weekly_avg}</p>
                <p className="text-xs text-[#52525B] mt-0.5">days / week</p>
              </div>
              <div>
                <p className="text-xl font-semibold tabular-nums">{streaks.monthly_avg}</p>
                <p className="text-xs text-[#52525B] mt-0.5">days / month</p>
              </div>
              <div>
                <p className="text-xl font-semibold tabular-nums">{streaks.total_active_days}</p>
                <p className="text-xs text-[#52525B] mt-0.5">total active days</p>
              </div>
            </div>
          </div>

          {/* Heatmap */}
          {streaks.heatmap_weeks.length > 0 && (
            <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-4">
              <p className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Last 52 weeks</p>
              <div className="flex gap-0.5 overflow-x-auto pb-1 scrollbar-none">
                {streaks.heatmap_weeks.map((w) => {
                  const intensity = Math.min(w.count / 5, 1);
                  const bg = w.count === 0
                    ? "#18181B"
                    : `rgba(245,158,11,${0.2 + intensity * 0.8})`;
                  return (
                    <div
                      key={w.week}
                      title={`${w.week_start}: ${w.count} session${w.count !== 1 ? "s" : ""}`}
                      className="w-3 h-3 rounded-[2px] shrink-0"
                      style={{ backgroundColor: bg }}
                    />
                  );
                })}
              </div>
              <div className="flex items-center gap-1.5 mt-2 justify-end">
                <span className="text-[10px] text-[#3F3F46]">0</span>
                {[1, 2, 3, 4, 5].map((n) => (
                  <div
                    key={n}
                    className="w-3 h-3 rounded-[2px]"
                    style={{ backgroundColor: `rgba(245,158,11,${0.2 + (n / 5) * 0.8})` }}
                    title={`${n} session${n > 1 ? "s" : ""}`}
                  />
                ))}
                <span className="text-[10px] text-[#3F3F46]">5+</span>
              </div>
            </div>
          )}

          {/* By sport — tappable */}
          {streaks.by_type.length > 0 && (
            <div>
              <p className="text-xs text-[#52525B] uppercase tracking-widest mb-3">By sport</p>
              <p className="text-[11px] text-[#3F3F46] mb-2">Tap a sport to see all sessions</p>
              <div className="flex flex-col gap-2">
                {streaks.by_type.map((t) => (
                  <button
                    key={t.type}
                    onClick={() => setSelectedSport(t.type)}
                    className="flex items-center gap-3 bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3 hover:border-[#3F3F46] transition-colors text-left w-full"
                  >
                    <span className="text-lg w-7 shrink-0 text-center">{actIcon(t.type)}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#FAFAFA] capitalize">{t.type.replace(/_/g, " ")}</p>
                      <p className="text-xs text-[#52525B]">
                        {t.sessions} session{t.sessions !== 1 ? "s" : ""} · {t.active_days} active {t.active_days === 1 ? "day" : "days"}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold text-[#F59E0B] tabular-nums">{t.longest_streak}</p>
                      <p className="text-[10px] text-[#52525B]">best streak</p>
                    </div>
                    <span className="text-[#3F3F46] text-xs ml-1">›</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
