"use client";

import { useState, Suspense } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { format, subDays, parseISO, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachWeekOfInterval, eachMonthOfInterval } from "date-fns";
import { api, type DaySummary } from "@/lib/api";
import Link from "next/link";
import { DayCard } from "@/components/DayCard";
import { LifeGridClient } from "@/app/life/LifeGridClient";
import { WeekCharts } from "@/components/WeekCharts";

const PAGE_SIZE = 30;

function windowFor(page: number): { start: string; end: string } {
  const end = subDays(new Date(), page * PAGE_SIZE);
  const start = subDays(end, PAGE_SIZE - 1);
  return {
    start: format(start, "yyyy-MM-dd"),
    end: format(end, "yyyy-MM-dd"),
  };
}

type Tab = "days" | "weeks" | "life";

export default function TimelinePage() {
  const [tab, setTab] = useState<Tab>("days");

  return (
    <main className="w-full px-4 pb-20">
      {/* Header */}
      <header className="pt-8 pb-5 max-w-5xl mx-auto">
        <Link href="/" className="text-xs text-[#71717A] hover:text-[#A1A1AA] uppercase tracking-widest inline-block mb-2">← Today</Link>
        <h1 className="text-2xl font-semibold tracking-tight mb-5">Timeline</h1>
      </header>

      {/* Tab switcher — centered */}
      <div className="flex justify-center mb-6">
        <div className="inline-flex rounded-lg border border-[#27272A] p-0.5 bg-[#09090B]">
          {(["days", "weeks", "life"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-1.5 text-xs rounded-md transition-colors capitalize ${
                tab === t ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"
              }`}
            >
              {t === "weeks" ? "Weeks / Months" : t === "life" ? "Life in Weeks" : "Days"}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content — both centered at same width */}
      <div className="flex flex-col items-center">
        <div className="w-full max-w-[720px]">
          {tab === "days" ? <DaysTab /> : tab === "weeks" ? <WeeksTab /> : <LifeTab />}
        </div>
      </div>
    </main>
  );
}

// ── Days tab ──────────────────────────────────────────────────────────────────

function DaysTab() {
  const { data, fetchNextPage, isFetchingNextPage, isLoading, isError, error } =
    useInfiniteQuery({
      queryKey: ["timeline"],
      queryFn: ({ pageParam = 0 }) => {
        const { start, end } = windowFor(pageParam as number);
        return api.range(start, end);
      },
      initialPageParam: 0,
      getNextPageParam: (_last, _all, lastParam) => (lastParam as number) + 1,
    });

  const allDays = data?.pages.flat() ?? [];
  const grouped = allDays.reduce<Record<string, typeof allDays>>((acc, day) => {
    const key = day.date.slice(0, 7);
    if (!acc[key]) acc[key] = [];
    acc[key].push(day);
    return acc;
  }, {});

  return (
    <div className="mt-4">
      {isError && (
        <div className="border border-red-900 bg-red-950/30 rounded-lg px-4 py-4 text-sm text-red-400 mb-4">
          <p className="font-medium mb-1">Could not load timeline</p>
          <p className="text-xs text-red-600 font-mono">{String(error)}</p>
        </div>
      )}
      {isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="h-12 bg-[#18181B] rounded-lg animate-pulse" />
          ))}
        </div>
      ) : (
        Object.entries(grouped)
          .sort(([a], [b]) => b.localeCompare(a))
          .map(([month, days]) => (
            <div key={month} className="mb-6">
              <p className="text-xs text-[#52525B] uppercase tracking-widest mb-2 px-4">
                {format(parseISO(`${month}-01`), "MMMM yyyy")}
              </p>
              <div className="flex flex-col">
                {[...days]
                  .sort((a, b) => b.date.localeCompare(a.date))
                  .map((day) => (
                    <DayCard key={day.date} day={day} />
                  ))}
              </div>
            </div>
          ))
      )}

      <div className="mt-4 flex justify-center">
        <button
          onClick={() => fetchNextPage()}
          disabled={isFetchingNextPage}
          className="text-sm text-[#A1A1AA] hover:text-[#FAFAFA] disabled:text-[#52525B] transition-colors px-6 py-2 border border-[#27272A] rounded-full"
        >
          {isFetchingNextPage ? "Loading…" : "Load more"}
        </button>
      </div>
    </div>
  );
}

// ── Weeks / Months tab ───────────────────────────────────────────────────────

type ReviewMode = "weeks" | "months";

// Years available: 2019 (earliest data) to current year
const CURRENT_YEAR = new Date().getFullYear();
const AVAILABLE_YEARS = Array.from(
  { length: CURRENT_YEAR - 2019 + 1 },
  (_, i) => CURRENT_YEAR - i
);

function WeeksTab() {
  const [mode, setMode] = useState<ReviewMode>("weeks");
  const [selectedYear, setSelectedYear] = useState<number>(CURRENT_YEAR);

  const start = `${selectedYear}-01-01`;
  const end = selectedYear === CURRENT_YEAR
    ? format(new Date(), "yyyy-MM-dd")
    : `${selectedYear}-12-31`;

  const { data: days = [], isLoading } = useQuery({
    queryKey: ["timeline-review", start, end],
    queryFn: () => api.range(start, end),
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 mt-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-24 bg-[#18181B] rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="mt-4">
      {/* Controls row */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex gap-2">
          {(["weeks", "months"] as ReviewMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                mode === m
                  ? "border-[#F59E0B] text-[#F59E0B] bg-[#F59E0B]/10"
                  : "border-[#27272A] text-[#52525B] hover:text-[#A1A1AA]"
              }`}
            >
              {m === "weeks" ? "By Week" : "By Month"}
            </button>
          ))}
        </div>
        {/* Year selector */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSelectedYear((y) => Math.max(2019, y - 1))}
            disabled={selectedYear <= 2019}
            className="px-2 py-1 text-xs text-[#52525B] hover:text-[#A1A1AA] disabled:opacity-30 transition-colors"
          >
            ‹
          </button>
          <span className="text-sm font-medium text-[#FAFAFA] w-12 text-center tabular-nums">
            {selectedYear}
          </span>
          <button
            onClick={() => setSelectedYear((y) => Math.min(CURRENT_YEAR, y + 1))}
            disabled={selectedYear >= CURRENT_YEAR}
            className="px-2 py-1 text-xs text-[#52525B] hover:text-[#A1A1AA] disabled:opacity-30 transition-colors"
          >
            ›
          </button>
        </div>
      </div>

      {days.length === 0 ? (
        <p className="text-sm text-[#52525B] text-center py-12">No data for {selectedYear}</p>
      ) : mode === "weeks" ? (
        <WeekReviewList days={days} year={selectedYear} />
      ) : (
        <MonthReviewList days={days} year={selectedYear} />
      )}
    </div>
  );
}

function avgMood(days: DaySummary[]): number | null {
  const moods = days.map((d) => d.mood).filter((m): m is number => m != null);
  return moods.length ? moods.reduce((a, b) => a + b, 0) / moods.length : null;
}

// Progress ring around the average rating: fill = value/10, colour ramps
// red (low) → amber → green (high) on a continuous hue scale.
function MoodRing({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value / 10));
  const size = 42, stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = `hsl(${Math.round(pct * 120)}, 68%, 46%)`;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90 block">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#27272A" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)}
        />
      </svg>
      <span
        className="absolute inset-0 flex items-center justify-center text-xs font-semibold tabular-nums"
        style={{ color }}
      >
        {value.toFixed(1)}
      </span>
    </div>
  );
}

function WeekReviewList({ days, year }: { days: DaySummary[]; year: number }) {
  const start = parseISO(`${year}-01-01`);
  const end = year === CURRENT_YEAR ? new Date() : parseISO(`${year}-12-31`);

  const weeks = eachWeekOfInterval({ start, end }, { weekStartsOn: 1 }).reverse();

  return (
    <div className="flex flex-col gap-3">
      {weeks.map((weekStart) => {
        const ws = format(weekStart, "yyyy-MM-dd");
        const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
        const we = format(weekEnd, "yyyy-MM-dd");
        const weekDays = days.filter((d) => d.date >= ws && d.date <= we);
        if (weekDays.length === 0) return null;
        // Show year on label so it's clear when browsing past years
        const label = `${format(weekStart, "d MMM")} – ${format(weekEnd, "d MMM yyyy")}`;
        return <ReviewCard key={ws} label={label} days={weekDays} start={ws} end={we} />;
      })}
    </div>
  );
}

function MonthReviewList({ days, year }: { days: DaySummary[]; year: number }) {
  const start = parseISO(`${year}-01-01`);
  const end = year === CURRENT_YEAR ? new Date() : parseISO(`${year}-12-31`);

  const months = eachMonthOfInterval({ start, end }).reverse();

  return (
    <div className="flex flex-col gap-3">
      {months.map((monthStart) => {
        const ms = format(monthStart, "yyyy-MM-dd");
        const me = format(endOfMonth(monthStart), "yyyy-MM-dd");
        const monthDays = days.filter((d) => d.date >= ms && d.date <= me);
        if (monthDays.length === 0) return null;
        return <ReviewCard key={ms} label={format(monthStart, "MMMM yyyy")} days={monthDays} start={ms} end={me} />;
      })}
    </div>
  );
}

function ReviewCard({ label, days, start, end }: { label: string; days: DaySummary[]; start: string; end: string }) {
  const [expanded, setExpanded] = useState(false);
  const [expandedView, setExpandedView] = useState<"charts" | "days">("charts");

  const mood = avgMood(days);
  const totalFlights = days.reduce((s, d) => s + (d.flight_count ?? 0), 0);
  const totalActivities = days.reduce((s, d) => s + (d.activity_count ?? 0), 0);
  const daysLogged = days.filter((d) => d.mood != null).length;
  const daysWithPhoto = days.filter((d) => d.photo_path).length;
  const cities = Array.from(new Set(days.flatMap((d) => d.cities ?? []))).slice(0, 3);

  // Mood sparkline: 7 bars for the days
  const moodValues = days
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => d.mood);

  return (
    <div className="bg-[#18181B] border border-[#27272A] rounded-xl overflow-hidden">
      {/* Header row — always visible */}
      <button
        className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-[#1C1C1F] transition-colors"
        onClick={() => setExpanded((e) => !e)}
      >
        {/* Label */}
        <div className="flex-1 min-w-0">
          <p className="text-xs text-[#52525B] uppercase tracking-widest mb-0.5">{label}</p>
          <div className="flex items-center gap-3 flex-wrap">
            {mood != null && <MoodRing value={mood} />}
            {totalFlights > 0 && (
              <span className="text-xs text-sky-400">✈ {totalFlights} sector{totalFlights > 1 ? "s" : ""}</span>
            )}
            {totalActivities > 0 && (
              <span className="text-xs text-green-400">⚡ {totalActivities} activit{totalActivities > 1 ? "ies" : "y"}</span>
            )}
            {cities.length > 0 && (
              <span className="text-xs text-[#52525B]">📍 {cities.join(" · ")}</span>
            )}
          </div>
        </div>

        {/* Mood sparkline */}
        <div className="flex items-end gap-0.5 h-8 shrink-0">
          {moodValues.map((m, i) => {
            const h = m != null ? Math.max(2, (m / 10) * 28) : 2;
            const color = m == null ? "#27272A" : m >= 8 ? "#22C55E" : m >= 5 ? "#F59E0B" : "#EF4444";
            return (
              <div
                key={i}
                style={{ height: `${h}px`, backgroundColor: color, width: "4px", borderRadius: "2px" }}
              />
            );
          })}
        </div>

        {/* Stats */}
        <div className="text-right shrink-0 hidden sm:block">
          <p className="text-xs text-[#52525B]">{daysLogged}/{days.length} logged</p>
          {daysWithPhoto > 0 && <p className="text-xs text-[#52525B]">📷 {daysWithPhoto}</p>}
        </div>

        <span className="text-[#3F3F46] text-xs ml-1">{expanded ? "↑" : "↓"}</span>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-[#27272A]">
          {/* Toggle: Charts / Days */}
          <div className="flex gap-1 px-4 pt-3 pb-1">
            {(["charts", "days"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setExpandedView(v)}
                className={`px-3 py-1 text-[10px] rounded-full border transition-colors capitalize ${
                  expandedView === v
                    ? "border-[#F59E0B] text-[#F59E0B] bg-[#F59E0B]/10"
                    : "border-[#27272A] text-[#52525B] hover:text-[#A1A1AA]"
                }`}
              >
                {v}
              </button>
            ))}
          </div>

          {expandedView === "charts" ? (
            <WeekCharts start={start} end={end} />
          ) : (
            days
              .sort((a, b) => b.date.localeCompare(a.date))
              .map((day) => (
                <DayCard key={day.date} day={day} />
              ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Life tab ──────────────────────────────────────────────────────────────────

function LifeTab() {
  const { data: grid, isLoading: gridLoading } = useQuery({
    queryKey: ["life-grid"],
    queryFn: () => api.lifeGrid(),
    retry: false,
  });

  const { data: periods = [] } = useQuery({
    queryKey: ["life-periods"],
    queryFn: () => api.lifePeriods(),
  });

  const { data: events = [] } = useQuery({
    queryKey: ["life-events"],
    queryFn: () => api.lifeEvents(),
  });

  if (gridLoading) {
    return (
      <div className="mt-8 flex flex-col gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-8 bg-[#18181B] rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (!grid) {
    return (
      <div className="mt-8 border border-dashed border-[#27272A] rounded-xl px-6 py-12 text-center">
        <p className="text-sm text-[#71717A] mb-1">Profile not set up yet.</p>
        <p className="text-xs text-[#52525B]">
          Go to{" "}
          <a href="/life" className="text-[#F59E0B] underline">
            Life in Weeks
          </a>{" "}
          to add your birthdate.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <LifeGridClient grid={grid} periods={periods} events={events} />
    </div>
  );
}
