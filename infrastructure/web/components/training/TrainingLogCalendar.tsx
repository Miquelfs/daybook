"use client";

import { useEffect, useState } from "react";
import { format, parseISO, startOfWeek, addDays, eachWeekOfInterval, subWeeks } from "date-fns";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

type ActivityBubble = {
  id: string;
  sport: string;
  start_time: string;
  distance_m: number;
  duration_s: number;
  tss: number;
};

type DayEntry = {
  date: string;
  activities: ActivityBubble[];
};

const SPORT_COLOR: Record<string, string> = {
  running: "#F59E0B",
  trail_running: "#D97706",
  cycling: "#3B82F6",
  road_biking: "#2563EB",
  indoor_cycling: "#60A5FA",
  swimming: "#06B6D4",
  lap_swimming: "#0891B2",
  walking: "#22C55E",
  hiking: "#16A34A",
  other: "#71717A",
};

function sportColor(type: string | undefined) {
  if (!type) return SPORT_COLOR.other;
  return SPORT_COLOR[type.toLowerCase()] ?? SPORT_COLOR.other;
}

function bubbleSize(tss: number): number {
  // Min 6px, max 22px — TSS 0=6, TSS 100=18, TSS 150+=22
  return Math.min(22, 6 + (tss / 150) * 16);
}

function formatPace(distance_m: number, duration_s: number): string {
  if (!distance_m || distance_m < 100) return "";
  const pace = duration_s / (distance_m / 1000); // s/km
  const min = Math.floor(pace / 60);
  const sec = Math.round(pace % 60);
  return `${min}:${sec.toString().padStart(2, "0")}/km`;
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKS_OPTIONS = [8, 12, 16, 26];

export default function TrainingLogCalendar() {
  const [weeks, setWeeks] = useState(16);
  const [dayMap, setDayMap] = useState<Map<string, ActivityBubble[]>>(new Map());
  const [weeklyTotals, setWeeklyTotals] = useState<Map<string, { km: number; hours: number; tss: number }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoveredActivity, setHoveredActivity] = useState<{ activity: ActivityBubble; x: number; y: number } | null>(null);

  useEffect(() => {
    const end = format(new Date(), "yyyy-MM-dd");
    const start = format(subWeeks(new Date(), weeks), "yyyy-MM-dd");
    setLoading(true);
    setError(null);
    fetch(`/api/training/log?start=${start}&end=${end}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((rows: DayEntry[]) => {
        const map = new Map<string, ActivityBubble[]>();
        const totals = new Map<string, { km: number; hours: number; tss: number }>();

        rows.forEach((day) => {
          map.set(day.date, day.activities);
          // Week key = Monday of that week
          const d = parseISO(day.date);
          const weekStart = format(startOfWeek(d, { weekStartsOn: 1 }), "yyyy-MM-dd");
          const existing = totals.get(weekStart) ?? { km: 0, hours: 0, tss: 0 };
          day.activities.forEach((a) => {
            existing.km += (a.distance_m ?? 0) / 1000;
            existing.hours += (a.duration_s ?? 0) / 3600;
            existing.tss += a.tss ?? 0;
          });
          totals.set(weekStart, existing);
        });

        setDayMap(map);
        setWeeklyTotals(totals);
        setLoading(false);
      })
      .catch((e) => { setError(String(e)); setLoading(false); });
  }, [weeks]);

  // Build week grid — must match the API fetch range (subWeeks(today, weeks))
  const today = new Date();
  const gridStart = startOfWeek(subWeeks(today, weeks), { weekStartsOn: 1 });
  const allWeeks = eachWeekOfInterval({ start: gridStart, end: today }, { weekStartsOn: 1 }).reverse();

  return (
    <div className="space-y-3">
      {/* Weeks selector */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-zinc-500">Show</span>
        <div className="flex gap-1">
          {WEEKS_OPTIONS.map((w) => (
            <button
              key={w}
              onClick={() => setWeeks(w)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                weeks === w
                  ? "bg-blue-500 text-white"
                  : "bg-[#18181B] text-zinc-400 hover:text-white border border-[#27272A]"
              }`}
            >
              {w}w
            </button>
          ))}
        </div>
      </div>

      {/* Sport legend */}
      <div className="flex gap-4 flex-wrap text-xs text-zinc-400">
        {[["Running", "#F59E0B"], ["Cycling", "#3B82F6"], ["Swimming", "#06B6D4"], ["Other", "#71717A"]].map(([label, color]) => (
          <span key={label} className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: color }} />
            {label}
          </span>
        ))}
        <span className="text-zinc-600">· Bubble size = TSS</span>
      </div>

      {error && (
        <div className="h-16 flex items-center justify-center text-rose-400 text-xs font-mono">Error: {error}</div>
      )}
      {loading ? (
        <div className="h-48 flex items-center justify-center text-zinc-500 text-sm">Loading…</div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[600px]">
            {/* Day column headers */}
            <div className="grid text-xs text-zinc-500 mb-1" style={{ gridTemplateColumns: "52px repeat(7, 1fr) 100px" }}>
              <div />
              {DAY_LABELS.map((d) => (
                <div key={d} className="text-center">{d}</div>
              ))}
              <div className="text-right pr-1">Week</div>
            </div>

            {/* Rows */}
            <div className="space-y-0.5">
              {allWeeks.map((weekStart) => {
                const weekKey = format(weekStart, "yyyy-MM-dd");
                const totals = weeklyTotals.get(weekKey);

                return (
                  <div
                    key={weekKey}
                    className="grid items-center"
                    style={{ gridTemplateColumns: "52px repeat(7, 1fr) 100px", height: 36 }}
                  >
                    {/* Week label */}
                    <div className="text-xs text-zinc-600 text-right pr-2">
                      {format(weekStart, "d MMM")}
                    </div>

                    {/* 7 days */}
                    {[0, 1, 2, 3, 4, 5, 6].map((offset) => {
                      const day = addDays(weekStart, offset);
                      const dayStr = format(day, "yyyy-MM-dd");
                      const activities = dayMap.get(dayStr) ?? [];
                      const isFuture = day > today;

                      return (
                        <div key={dayStr} className="flex items-center justify-center gap-0.5 relative" style={{ height: 36 }}>
                          {isFuture ? (
                            <div className="w-1 h-1 rounded-full bg-[#27272A]" />
                          ) : activities.length === 0 ? (
                            <div className="w-1.5 h-1.5 rounded-full bg-[#27272A]" />
                          ) : (
                            activities.map((act) => {
                              const size = bubbleSize(act.tss);
                              return (
                                <a
                                  key={act.id}
                                  href={`/activity/${act.id}`}
                                  onMouseEnter={(e) => setHoveredActivity({ activity: act, x: e.clientX, y: e.clientY })}
                                  onMouseLeave={() => setHoveredActivity(null)}
                                  className="rounded-full flex-shrink-0 transition-opacity hover:opacity-80"
                                  style={{
                                    width: size,
                                    height: size,
                                    background: sportColor(act.sport),
                                  }}
                                />
                              );
                            })
                          )}
                        </div>
                      );
                    })}

                    {/* Weekly totals */}
                    <div className="text-right pr-1 text-xs text-zinc-500 leading-tight">
                      {totals ? (
                        <>
                          <div>{totals.km.toFixed(0)} km</div>
                          <div>{totals.hours.toFixed(1)}h · {Math.round(totals.tss)} TSS</div>
                        </>
                      ) : (
                        <div className="text-zinc-700">—</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Hover tooltip */}
      {hoveredActivity && (
        <div
          className="fixed z-50 pointer-events-none bg-[#18181B] border border-[#27272A] rounded-lg p-3 text-xs shadow-xl"
          style={{ left: hoveredActivity.x + 12, top: hoveredActivity.y - 60 }}
        >
          <div className="text-white font-medium capitalize mb-1">{hoveredActivity.activity.sport}</div>
          {hoveredActivity.activity.distance_m > 0 && (
            <div className="text-zinc-400">{(hoveredActivity.activity.distance_m / 1000).toFixed(1)} km</div>
          )}
          <div className="text-zinc-400">{(hoveredActivity.activity.duration_s / 60).toFixed(0)} min</div>
          {hoveredActivity.activity.tss > 0 && (
            <div className="text-zinc-400">{Math.round(hoveredActivity.activity.tss)} TSS</div>
          )}
          {hoveredActivity.activity.distance_m > 0 && hoveredActivity.activity.duration_s > 0 && (
            <div className="text-zinc-500 mt-0.5">{formatPace(hoveredActivity.activity.distance_m, hoveredActivity.activity.duration_s)}</div>
          )}
        </div>
      )}
    </div>
  );
}
