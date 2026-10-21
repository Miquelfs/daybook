"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Target } from "lucide-react";
import { HabitCalendar } from "@/components/HabitCalendar";
import { tagsApi } from "@/lib/tags-api";
import { localISODate } from "@/lib/dates";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ── Habit streaks types ───────────────────────────────────────────────────────
type TagStreak = {
  id: number;
  slug: string;
  name: string;
  icon: string | null;
  total_days: number;
  total_count: number | null;
  current_streak: number;
  longest_streak: number;
  last_used: string;
  weekly_avg: number;
  negative_streak: number | null;
  is_negative: boolean;
};

type TagDetail = {
  slug: string;
  name: string;
  icon: string | null;
  usage_dates: string[];
  current_streak: number;
  longest_streak: number;
  longest_streak_end: string | null;
  weekly_avg: number;
  monthly_avg: number;
  total_days_all: number;
};

const HABIT_SORT_OPTIONS = [
  { key: "longest_streak", label: "Longest streak" },
  { key: "current_streak", label: "Active now" },
  { key: "total_days", label: "Most used" },
  { key: "weekly_avg", label: "Frequency" },
];

function MiniHeatmap({ dates }: { dates: string[] }) {
  if (!dates.length) return null;
  const dateSet = new Set(dates);
  const today = new Date();
  const weeks: { week: Date[]; key: string }[] = [];
  const start = new Date(today);
  start.setDate(start.getDate() - 90);
  const dow = start.getDay();
  start.setDate(start.getDate() - ((dow + 6) % 7));
  let cur = new Date(start);
  while (cur <= today) {
    const weekDays: Date[] = [];
    for (let d = 0; d < 7; d++) {
      const dd = new Date(cur);
      dd.setDate(dd.getDate() + d);
      weekDays.push(dd);
    }
    weeks.push({ week: weekDays, key: cur.toISOString() });
    cur.setDate(cur.getDate() + 7);
  }
  return (
    <div className="flex gap-0.5">
      {weeks.map(({ week, key }) => (
        <div key={key} className="flex flex-col gap-0.5">
          {week.map((d) => {
            const ds = localISODate(d);
            const active = dateSet.has(ds);
            const isFuture = d > today;
            return (
              <div key={ds} className="w-2 h-2 rounded-[1px]"
                style={{ backgroundColor: isFuture ? "transparent" : active ? "#F59E0B" : "#18181B", opacity: isFuture ? 0 : 1 }}
                title={active ? ds : ""}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

/**
 * Habits — every tag as a habit: calendar grid, streak list, per-habit detail.
 * Lives in Plan (moved from Insights) so tracking and goals sit together;
 * `onMakeGoal` turns a habit into a tag goal.
 */
export function HabitsPanel({ onMakeGoal }: { onMakeGoal?: (slug: string) => void }) {
  const qc = useQueryClient();
  const [habitSortBy, setHabitSortBy] = useState("longest_streak");
  const [selectedHabitSlug, setSelectedHabitSlug] = useState<string | null>(null);
  const [habitView, setHabitView] = useState<"calendar" | "list">("calendar");

  const { data: habitTags = [], isLoading: habitsLoading } = useQuery<TagStreak[]>({
    queryKey: ["tag-streaks"],
    queryFn: () => fetch(`${BASE_URL}/tags/streaks`).then(r => r.json()),
  });

  const { data: habitDetail } = useQuery<TagDetail>({
    queryKey: ["tag-detail", selectedHabitSlug],
    queryFn: () => fetch(`${BASE_URL}/tags/${selectedHabitSlug}/stats`).then(r => r.json()),
    enabled: !!selectedHabitSlug,
  });

  const toggleNegative = useMutation({
    mutationFn: ({ id, is_negative }: { id: number; is_negative: boolean }) =>
      tagsApi.updateTag(id, { is_negative }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tag-streaks"] }),
  });

  return (
        <div>
          {selectedHabitSlug && habitDetail ? (
            <div className="space-y-5">
              <button
                onClick={() => setSelectedHabitSlug(null)}
                className="text-xs text-[#71717A] hover:text-[#A1A1AA] uppercase tracking-widest"
              >
                ← Back
              </button>
              <div className="flex items-center gap-3">
                <span className="text-3xl">{habitDetail.icon ?? "🏷️"}</span>
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-semibold">{habitDetail.name}</h2>
                  <p className="text-sm text-[#71717A]">{habitDetail.total_days_all} days tagged</p>
                </div>
                {onMakeGoal && (
                  <button onClick={() => onMakeGoal(habitDetail.slug)}
                          className="shrink-0 inline-flex items-center gap-1 text-xs bg-[#F59E0B]/10 border border-[#F59E0B]/30 text-[#F59E0B] hover:bg-[#F59E0B]/20 rounded-lg px-3 py-1.5 transition-colors">
                    <Target size={13} />Make it a goal
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-4">
                  <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Current streak</p>
                  <p className="text-3xl font-bold tabular-nums text-[#F59E0B]">{habitDetail.current_streak}</p>
                  <p className="text-xs text-[#52525B] mt-0.5">{habitDetail.current_streak === 1 ? "day" : "days"}</p>
                </div>
                <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-4">
                  <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Longest streak</p>
                  <p className="text-3xl font-bold tabular-nums text-[#22C55E]">{habitDetail.longest_streak}</p>
                  <p className="text-xs text-[#52525B] mt-0.5">
                    {habitDetail.longest_streak_end ? `ended ${format(parseISO(habitDetail.longest_streak_end), "d MMM yy")}` : "—"}
                  </p>
                </div>
                <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-4">
                  <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Avg / week</p>
                  <p className="text-2xl font-bold tabular-nums">{habitDetail.weekly_avg}×</p>
                </div>
                <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-4">
                  <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Avg / month</p>
                  <p className="text-2xl font-bold tabular-nums">{habitDetail.monthly_avg}×</p>
                </div>
              </div>
              {habitDetail.usage_dates.length > 0 && (
                <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-4">
                  <p className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Last 13 weeks</p>
                  <MiniHeatmap dates={habitDetail.usage_dates} />
                  <div className="flex justify-between text-[10px] text-[#3F3F46] mt-2">
                    <span>13 weeks ago</span><span>Today</span>
                  </div>
                </div>
              )}
              {habitDetail.usage_dates.length > 0 && (
                <div>
                  <p className="text-xs text-[#52525B] uppercase tracking-widest mb-3">All occurrences</p>
                  <div className="flex flex-col gap-1">
                    {[...habitDetail.usage_dates].reverse().map((d) => (
                      <Link key={d} href={`/day/${d}`}
                        className="flex items-center gap-3 px-4 py-2.5 bg-[#0D0D0F] border border-[#27272A] rounded-xl hover:border-[#3F3F46] transition-colors"
                      >
                        <span className="text-sm tabular-nums text-[#52525B] w-24 shrink-0">{format(parseISO(d), "d MMM yyyy")}</span>
                        <span className="text-xs text-[#3F3F46]">{format(parseISO(d), "EEEE")}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {/* Calendar / List toggle */}
              <div className="flex gap-1 bg-[#0D0D0F] border border-[#27272A] rounded-lg p-1 w-fit">
                {(["calendar", "list"] as const).map((v) => (
                  <button key={v} onClick={() => setHabitView(v)}
                    className={`px-3 py-1 rounded text-xs font-medium capitalize transition-colors ${
                      habitView === v ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"
                    }`}
                  >{v}</button>
                ))}
              </div>

              {habitView === "calendar" && <HabitCalendar fixedMode="tags" />}

              {habitView === "list" && <>
              {/* Sort pills */}
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
                {HABIT_SORT_OPTIONS.map((opt) => (
                  <button key={opt.key} onClick={() => setHabitSortBy(opt.key)}
                    className={`shrink-0 px-3 py-1 text-xs rounded-full border transition-colors ${
                      habitSortBy === opt.key
                        ? "border-[#F59E0B] text-[#F59E0B] bg-[#F59E0B]/10"
                        : "border-[#27272A] text-[#52525B] hover:text-[#A1A1AA]"
                    }`}
                  >{opt.label}</button>
                ))}
              </div>

              {habitsLoading && (
                <div className="flex flex-col gap-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="h-16 bg-[#18181B] rounded-xl animate-pulse" />
                  ))}
                </div>
              )}

              {!habitsLoading && habitTags.length === 0 && (
                <div className="border border-dashed border-[#27272A] rounded-xl px-6 py-12 text-center">
                  <p className="text-sm text-[#71717A]">No tags used yet.</p>
                </div>
              )}

              {!habitsLoading && [...habitTags].sort((a, b) => {
                const av = a[habitSortBy as keyof TagStreak] as number;
                const bv = b[habitSortBy as keyof TagStreak] as number;
                return bv - av;
              }).map((tag) => (
                <div key={tag.slug}
                  className="flex items-center gap-2 bg-[#0D0D0F] border border-[#27272A] rounded-xl overflow-hidden hover:border-[#3F3F46] transition-colors"
                >
                  <button onClick={() => setSelectedHabitSlug(tag.slug)}
                    className="flex items-center gap-3 flex-1 min-w-0 px-4 py-3 text-left"
                  >
                    <span className="text-xl w-7 text-center shrink-0">{tag.icon ?? "🏷️"}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#FAFAFA] truncate">{tag.name}</p>
                      <p className="text-xs text-[#52525B]">
                        {tag.total_days} days
                        {tag.total_count !== null && <span className="text-[#3F3F46]"> · {tag.total_count}× total</span>}
                        {" · "}{tag.weekly_avg}×/wk ·{" "}
                        {tag.current_streak > 0
                          ? <span className="text-[#F59E0B]">on a {tag.current_streak}-day run</span>
                          : `last ${format(parseISO(tag.last_used), "d MMM")}`}
                      </p>
                      {tag.is_negative && tag.negative_streak !== null && tag.negative_streak > 0 && (
                        <p className="text-[10px] text-emerald-500 mt-0.5">✓ {tag.negative_streak}-day clean streak</p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      {tag.is_negative ? (
                        <div>
                          <div className="flex items-baseline gap-1 justify-end">
                            <span className="text-lg font-bold tabular-nums text-emerald-400">{tag.negative_streak ?? 0}</span>
                            <span className="text-[10px] text-[#52525B]">clean</span>
                          </div>
                          <p className="text-[10px] text-[#52525B]">{tag.total_days}× used</p>
                        </div>
                      ) : (
                        <div>
                          <div className="flex items-baseline gap-1 justify-end">
                            <span className="text-lg font-bold tabular-nums text-[#F59E0B]">{tag.longest_streak}</span>
                            <span className="text-[10px] text-[#52525B]">best</span>
                          </div>
                          {tag.current_streak > 0 && (
                            <p className="text-[10px] text-[#22C55E]">🔥 {tag.current_streak} now</p>
                          )}
                        </div>
                      )}
                    </div>
                    <span className="text-[#3F3F46] text-xs ml-1">›</span>
                  </button>
                  <button
                    title={tag.is_negative ? "Switch to positive" : "Switch to negative (clean streak)"}
                    onClick={() => toggleNegative.mutate({ id: tag.id, is_negative: !tag.is_negative })}
                    className={`shrink-0 mr-3 w-7 h-7 rounded-lg border text-xs transition-colors ${
                      tag.is_negative
                        ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
                        : "border-[#27272A] bg-[#18181B] text-[#3F3F46] hover:text-[#52525B]"
                    }`}
                  >{tag.is_negative ? "✓" : "—"}</button>
                </div>
              ))}
              <p className="text-[10px] text-[#3F3F46] text-center">
                ✓ = clean streak (less is better) · — = positive streak (more is better)
              </p>
              </>}
            </div>
          )}
        </div>
  );
}
