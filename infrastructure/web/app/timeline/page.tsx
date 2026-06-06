"use client";

import { useState, Suspense } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { format, subDays, parseISO, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachWeekOfInterval, eachMonthOfInterval } from "date-fns";
import { api, moodEmoji, type DaySummary } from "@/lib/api";
import { DayCard } from "@/components/DayCard";
import { LifeGridClient } from "@/app/life/LifeGridClient";

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
      <header className="pt-6 pb-5 max-w-5xl mx-auto">
        <p className="text-xs text-[#F59E0B] uppercase tracking-[0.2em] mb-1">Archive</p>
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

function WeeksTab() {
  const [mode, setMode] = useState<ReviewMode>("weeks");

  // Load last 6 months of day summaries
  const end = format(new Date(), "yyyy-MM-dd");
  const start = format(subDays(new Date(), 180), "yyyy-MM-dd");

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
      {/* Mode toggle */}
      <div className="flex gap-2 mb-5">
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

      {mode === "weeks" ? (
        <WeekReviewList days={days} />
      ) : (
        <MonthReviewList days={days} />
      )}
    </div>
  );
}

function avgMood(days: DaySummary[]): number | null {
  const moods = days.map((d) => d.mood).filter((m): m is number => m != null);
  return moods.length ? Math.round(moods.reduce((a, b) => a + b, 0) / moods.length) : null;
}

function WeekReviewList({ days }: { days: DaySummary[] }) {
  const dayMap = new Map(days.map((d) => [d.date, d]));

  // Build week buckets for last 26 weeks
  const weeks = eachWeekOfInterval(
    { start: subDays(new Date(), 180), end: new Date() },
    { weekStartsOn: 1 }
  ).reverse();

  return (
    <div className="flex flex-col gap-3">
      {weeks.map((weekStart) => {
        const ws = format(weekStart, "yyyy-MM-dd");
        const we = format(endOfWeek(weekStart, { weekStartsOn: 1 }), "yyyy-MM-dd");
        const weekDays = days.filter((d) => d.date >= ws && d.date <= we);
        if (weekDays.length === 0) return null;
        return <ReviewCard key={ws} label={`${format(weekStart, "d MMM")} – ${format(endOfWeek(weekStart, { weekStartsOn: 1 }), "d MMM")}`} days={weekDays} start={ws} end={we} />;
      })}
    </div>
  );
}

function MonthReviewList({ days }: { days: DaySummary[] }) {
  const months = eachMonthOfInterval(
    { start: subDays(new Date(), 180), end: new Date() }
  ).reverse();

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
            {mood != null && (
              <span className="text-sm font-medium text-[#A1A1AA]">
                {moodEmoji(mood)} {mood}/10
              </span>
            )}
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

      {/* Expanded: individual day cards */}
      {expanded && (
        <div className="border-t border-[#27272A]">
          {days
            .sort((a, b) => b.date.localeCompare(a.date))
            .map((day) => (
              <DayCard key={day.date} day={day} />
            ))}
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
