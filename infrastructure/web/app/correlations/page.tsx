"use client";

import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  ScatterChart, Scatter, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Line, ComposedChart,
  BarChart, Bar, Cell,
} from "recharts";
import { format, parseISO } from "date-fns";
import { correlationsApi } from "@/lib/correlations-api";
import type { MetricMeta, TopCorrelation, TagImpact, PrecomputedCorrelation } from "@/lib/correlations-api";
import { TrendingUp, Minus, ArrowUpRight, ArrowDownRight, Plus, X, CheckCircle, Trash2, Sparkles, GitCompare, CalendarDays, BarChart2, Flame, FlaskConical } from "lucide-react";
import { TagStatsDrawer } from "@/components/TagStatsDrawer";
import { tagsApi, type Tag as TagType } from "@/lib/tags-api";

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
            const ds = d.toISOString().slice(0, 10);
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

const DAYS_OPTIONS = [
  { label: "30d", value: 30 },
  { label: "90d", value: 90 },
  { label: "180d", value: 180 },
  { label: "All", value: 365 },
];

const CATEGORY_ORDER = ["subjective", "health", "activity", "aviation", "environment", "tags", "tag_values", "people"];
const CATEGORY_LABELS: Record<string, string> = {
  subjective: "Subjective",
  health: "Health",
  activity: "Activity",
  aviation: "Aviation",
  environment: "Environment",
  tags: "Tags",
  tag_values: "Tag Values",
  people: "People",
};

const TOOLTIP_STYLE = {
  contentStyle: { background: "#09090B", border: "1px solid #27272A", borderRadius: 8, fontSize: 12 },
  labelStyle: { color: "#A1A1AA" },
  itemStyle: { color: "#FAFAFA" },
};

type Tab = "discover" | "compare" | "weekly" | "period" | "habits" | "experiments";

function rColor(r: number | null) {
  if (r === null) return "text-[#52525B]";
  const a = Math.abs(r);
  if (a >= 0.5) return "text-emerald-400";
  if (a >= 0.3) return "text-amber-400";
  return "text-[#71717A]";
}

function rBg(r: number | null) {
  if (r === null) return "bg-[#18181B]";
  const a = Math.abs(r);
  if (a >= 0.5) return "bg-emerald-400/10 border-emerald-400/30";
  if (a >= 0.3) return "bg-amber-400/10 border-amber-400/30";
  return "bg-[#18181B] border-[#27272A]";
}

function deltaColor(delta: number) {
  if (delta > 0.2) return "text-emerald-400";
  if (delta < -0.2) return "text-red-400";
  return "text-[#71717A]";
}

const PERIOD_METRICS = [
  { key: "mood",          label: "Mood" },
  { key: "energy",        label: "Energy" },
  { key: "stress",        label: "Stress" },
  { key: "sleep_quality", label: "Sleep Quality" },
  { key: "hrv_avg",       label: "HRV" },
  { key: "resting_hr",    label: "Resting HR" },
  { key: "steps",         label: "Steps" },
  { key: "screen_total",  label: "Screen Time" },
];

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function directionBadge(c: PrecomputedCorrelation) {
  if (c.direction === "new") return <span className="text-[10px] text-amber-400 font-semibold">✦ new</span>;
  if (c.direction === "stronger") return <span className="text-[10px] text-emerald-400 flex items-center gap-0.5"><ArrowUpRight size={10} />↑</span>;
  if (c.direction === "weaker") return <span className="text-[10px] text-red-400 flex items-center gap-0.5"><ArrowDownRight size={10} />↓</span>;
  return null;
}

export default function CorrelationsPage() {
  const [tab, setTab] = useState<Tab>("discover");
  const [metricA, setMetricA] = useState<string>("");
  const [metricB, setMetricB] = useState<string>("");
  const [days, setDays] = useState(90);
  const [showTrendline, setShowTrendline] = useState(false);
  const [periodMetric, setPeriodMetric] = useState("mood");
  const [periodType, setPeriodType] = useState<"month" | "week" | "year">("month");
  const [precomputedDomain, setPrecomputedDomain] = useState("");
  const [selectedTagSlug, setSelectedTagSlug] = useState<string | null>(null);
  const [habitSortBy, setHabitSortBy] = useState("longest_streak");
  const [selectedHabitSlug, setSelectedHabitSlug] = useState<string | null>(null);
  const [precomputedVisible, setPrecomputedVisible] = useState(5);
  const compareRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  const { data: catalog } = useQuery({
    queryKey: ["corr-catalog"],
    queryFn: correlationsApi.catalog,
    staleTime: 5 * 60 * 1000,
  });

  const { data: topData } = useQuery({
    queryKey: ["corr-top", days],
    queryFn: () => correlationsApi.top(days),
    staleTime: 5 * 60 * 1000,
  });

  const { data: precomputedData } = useQuery({
    queryKey: ["corr-precomputed", precomputedDomain],
    queryFn: () => correlationsApi.precomputed(90, 30, precomputedDomain),
    staleTime: 60 * 60 * 1000,
  });

  const { data: weeklyData } = useQuery({
    queryKey: ["corr-weekly"],
    queryFn: correlationsApi.weeklyStats,
    staleTime: 10 * 60 * 1000,
  });

  const { data: result, isFetching } = useQuery({
    queryKey: ["corr-compute", metricA, metricB, days],
    queryFn: () => correlationsApi.compute(metricA, metricB, days),
    enabled: !!metricA && !!metricB && metricA !== metricB,
  });

  const { data: periodData, isFetching: periodFetching } = useQuery({
    queryKey: ["corr-period", periodMetric, periodType],
    queryFn: () => correlationsApi.compare(periodMetric, periodType),
    staleTime: 60 * 60 * 1000,
    enabled: tab === "period",
  });

  const { data: habitTags = [], isLoading: habitsLoading } = useQuery<TagStreak[]>({
    queryKey: ["tag-streaks"],
    queryFn: () => fetch(`${BASE_URL}/tags/streaks`).then(r => r.json()),
    enabled: tab === "habits",
  });

  const { data: habitDetail, isLoading: habitDetailLoading } = useQuery<TagDetail>({
    queryKey: ["tag-detail", selectedHabitSlug],
    queryFn: () => fetch(`${BASE_URL}/tags/${selectedHabitSlug}/stats`).then(r => r.json()),
    enabled: !!selectedHabitSlug,
  });

  const toggleNegative = useMutation({
    mutationFn: ({ id, is_negative }: { id: number; is_negative: boolean }) =>
      tagsApi.updateTag(id, { is_negative }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tag-streaks"] }),
  });

  const top = topData?.top_correlations ?? [];
  const precomputed = precomputedData?.correlations ?? [];

  function pickTop(c: TopCorrelation) {
    setMetricA(c.metric_a);
    setMetricB(c.metric_b);
    setTab("compare");
    setTimeout(() => compareRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
  }

  function pickTag(tag: TagImpact) {
    setMetricA(`tag:${tag.slug}`);
    setMetricB("mood");
    setTab("compare");
    setTimeout(() => compareRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
  }

  function allMetrics(): MetricMeta[] {
    if (!catalog) return [];
    return CATEGORY_ORDER.flatMap((cat) => catalog[cat] ?? []);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const customTooltip = ({ payload }: any) => {
    if (!payload?.length) return null;
    const d = payload[0].payload as { x: number; y: number; date: string };
    return (
      <div className="bg-[#09090B] border border-[#27272A] rounded-lg px-3 py-2 text-xs space-y-0.5">
        <p className="text-[#A1A1AA]">{format(new Date(d.date + "T12:00:00"), "d MMM yyyy")}</p>
        <p className="text-[#FAFAFA]">
          {result?.metric_a.label}: <span className="text-[#F59E0B]">{Number(d.x).toFixed(1)}</span>
        </p>
        <p className="text-[#FAFAFA]">
          {result?.metric_b.label}: <span className="text-[#F59E0B]">{Number(d.y).toFixed(1)}</span>
        </p>
      </div>
    );
  };

  const points = result?.points ?? [];

  const trendlinePoints = (() => {
    if (!showTrendline || !result?.trendline || points.length < 2) return null;
    const { slope, intercept } = result.trendline;
    const xs = points.map((p) => p.x);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    return [
      { x: xMin, y: slope * xMin + intercept },
      { x: xMax, y: slope * xMax + intercept },
    ];
  })();

  const weekdayData = weeklyData?.by_weekday ?? [];
  const maxMood = Math.max(...weekdayData.map((d) => d.avg_mood ?? 0), 1);

  return (
    <main className="max-w-2xl mx-auto px-4 pb-20 pt-8">
      {/* Header */}
      <div className="mb-6">
        <Link href="/" className="text-xs text-[#71717A] hover:text-[#A1A1AA] uppercase tracking-widest inline-block mb-2">← Today</Link>
        <h1 className="text-2xl font-semibold tracking-tight">Insights</h1>
        <p className="text-sm text-[#71717A] mt-0.5">Patterns in your data.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 mb-6 p-1 bg-[#0D0D0F] border border-[#27272A] rounded-lg overflow-x-auto">
        {(
          [
            { id: "discover" as Tab, label: "Discover", icon: <Sparkles size={13} /> },
            { id: "compare" as Tab, label: "Compare", icon: <GitCompare size={13} /> },
            { id: "weekly" as Tab, label: "Weekly", icon: <CalendarDays size={13} /> },
            { id: "period" as Tab, label: "Period", icon: <BarChart2 size={13} /> },
            { id: "habits" as Tab, label: "Habits", icon: <Flame size={13} /> },
            { id: "experiments" as Tab, label: "Experiments", icon: <FlaskConical size={13} /> },
          ] as const
        ).map(({ id, label, icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium whitespace-nowrap transition-colors ${
              tab === id ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"
            }`}
          >
            {icon}{label}
          </button>
        ))}
      </div>

      {/* ── DISCOVER TAB ── */}
      {tab === "discover" && (
        <div className="space-y-8">
          {/* Precomputed snapshot (weekly batch) */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-[#52525B] uppercase tracking-widest">Snapshot</p>
              {precomputedData?.computed_at && (
                <p className="text-[10px] text-[#3F3F46]">
                  Updated {format(new Date(precomputedData.computed_at), "d MMM · HH:mm")}
                </p>
              )}
            </div>
            {/* Domain filter pills */}
            <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1 -mx-1 px-1">
              {["", "health", "activity", "aviation", "environment", "tags", "people", "screen"].map((d) => (
                <button
                  key={d}
                  onClick={() => { setPrecomputedDomain(d); setPrecomputedVisible(5); }}
                  className={`shrink-0 px-2.5 py-1 rounded-full text-[10px] font-medium transition-colors ${
                    precomputedDomain === d
                      ? "bg-[#F59E0B]/20 text-[#F59E0B] border border-[#F59E0B]/40"
                      : "bg-[#18181B] border border-[#27272A] text-[#52525B] hover:text-[#A1A1AA]"
                  }`}
                >
                  {d === "" ? "All" : d.charAt(0).toUpperCase() + d.slice(1)}
                </button>
              ))}
            </div>
            {precomputed.length > 0 ? (
              <div className="space-y-2">
                {precomputed.slice(0, precomputedVisible).map((c, i) => (
                  <button
                    key={i}
                    onClick={() => { setMetricA(c.metric_a); setMetricB(c.metric_b); setTab("compare"); setTimeout(() => compareRef.current?.scrollIntoView({ behavior: "smooth" }), 100); }}
                    className="w-full flex items-center gap-3 px-4 py-3 bg-[#0D0D0F] border border-[#27272A] rounded-xl hover:border-[#3F3F46] transition-colors text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <p className="text-xs text-[#A1A1AA] truncate">{c.label_a}</p>
                        {c.lag === 1 && <span className="text-[9px] text-[#52525B] shrink-0">→next</span>}
                      </div>
                      <p className="text-[10px] text-[#52525B] truncate">{c.label_b}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {directionBadge(c)}
                      <div className="text-right">
                        <p className={`text-sm font-semibold tabular-nums ${rColor(c.r)}`}>
                          {c.r > 0 ? "+" : ""}{c.r.toFixed(2)}
                        </p>
                        {/* Strength bar */}
                        <div className="w-16 h-1 rounded-full bg-[#27272A] mt-1">
                          <div
                            className={`h-full rounded-full ${Math.abs(c.r) >= 0.5 ? "bg-emerald-400" : Math.abs(c.r) >= 0.3 ? "bg-amber-400" : "bg-[#52525B]"}`}
                            style={{ width: `${Math.min(Math.abs(c.r) * 100, 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
                {precomputed.length > precomputedVisible && (
                  <button
                    onClick={() => setPrecomputedVisible(v => v + 10)}
                    className="w-full py-2.5 text-xs text-[#52525B] hover:text-[#A1A1AA] border border-dashed border-[#27272A] hover:border-[#3F3F46] rounded-xl transition-colors"
                  >
                    Load {Math.min(precomputed.length - precomputedVisible, 10)} more correlations ({precomputed.length - precomputedVisible} remaining)
                  </button>
                )}
              </div>
            ) : precomputedDomain !== "" ? (
              <div className="border border-dashed border-[#27272A] rounded-xl px-4 py-8 text-center">
                <p className="text-sm text-[#52525B]">No {precomputedDomain} correlations in snapshot yet.</p>
                <p className="text-xs text-[#3F3F46] mt-1">Run the correlation job on Pi to populate this category.</p>
              </div>
            ) : null}
          </div>

          {/* Real-time top correlations strip */}
          {top.length > 0 && (
            <div>
              <p className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Top correlations</p>
              <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-thin">
                {top.map((c, i) => (
                  <button
                    key={i}
                    onClick={() => pickTop(c)}
                    className="shrink-0 flex flex-col items-start gap-1 px-4 py-3 rounded-xl border transition-all
                               hover:border-[#3F3F46] bg-[#0D0D0F] border-[#27272A] min-w-[140px]"
                  >
                    <p className="text-[10px] text-[#52525B] truncate w-full text-left">{c.label_a}</p>
                    <p className="text-[10px] text-[#3F3F46]">↕</p>
                    <p className="text-[10px] text-[#52525B] truncate w-full text-left">{c.label_b}</p>
                    <p className={`text-xl font-semibold tabular-nums mt-1 ${rColor(c.r)}`}>
                      {c.r.toFixed(2)}
                    </p>
                    <p className="text-[10px] text-[#52525B]">{c.interpretation}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* What makes you happier? */}
          {(weeklyData?.top_tags ?? []).length > 0 && (
            <div>
              <p className="text-xs text-[#52525B] uppercase tracking-widest mb-3">What makes you happier?</p>
              <div className="space-y-2">
                {(weeklyData?.top_tags ?? []).map((tag) => (
                  <div key={tag.slug} className="flex items-center gap-2">
                    <button
                      onClick={() => pickTag(tag)}
                      className="flex-1 flex items-center gap-3 px-4 py-3 bg-[#0D0D0F] border border-[#27272A]
                                 rounded-xl hover:border-[#3F3F46] transition-colors text-left"
                    >
                      <span className="text-xl shrink-0">{tag.icon ?? "🏷️"}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-[#FAFAFA] font-medium truncate">{tag.name}</p>
                        <p className="text-xs text-[#52525B]">{tag.usage} days tracked</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`text-sm font-semibold tabular-nums ${deltaColor(tag.delta)}`}>
                          {tag.delta > 0 ? "+" : ""}{tag.delta.toFixed(1)} mood
                        </p>
                        <p className="text-[10px] text-[#52525B]">vs without</p>
                      </div>
                    </button>
                    <button
                      onClick={() => setSelectedTagSlug(tag.slug)}
                      className="p-2.5 rounded-xl bg-[#0D0D0F] border border-[#27272A] text-[#52525B] hover:text-[#A1A1AA] hover:border-[#3F3F46] transition-colors shrink-0"
                      title="Tag stats"
                    >
                      <TrendingUp size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {top.length === 0 && (weeklyData?.top_tags ?? []).length === 0 && (
            <div className="border border-dashed border-[#27272A] rounded-lg px-4 py-12 text-center">
              <p className="text-sm text-[#52525B]">Not enough data yet to discover patterns.</p>
              <p className="text-xs text-[#3F3F46] mt-1">Keep logging daily entries.</p>
            </div>
          )}
        </div>
      )}

      {/* ── COMPARE TAB ── */}
      {tab === "compare" && (
        <div ref={compareRef} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] text-[#52525B] mb-1.5 uppercase">X axis</p>
              <select
                value={metricA}
                onChange={(e) => setMetricA(e.target.value)}
                className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2.5 text-sm
                           text-[#FAFAFA] focus:outline-none focus:border-[#F59E0B] transition-colors"
              >
                <option value="">Select metric…</option>
                {catalog && CATEGORY_ORDER.map((cat) => {
                  const metrics = catalog[cat];
                  if (!metrics?.length) return null;
                  return (
                    <optgroup key={cat} label={CATEGORY_LABELS[cat] ?? cat}>
                      {metrics.map((m) => (
                        <option key={m.key} value={m.key}>{m.label}</option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
            </div>

            <div>
              <p className="text-[10px] text-[#52525B] mb-1.5 uppercase">Y axis</p>
              <select
                value={metricB}
                onChange={(e) => setMetricB(e.target.value)}
                className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2.5 text-sm
                           text-[#FAFAFA] focus:outline-none focus:border-[#F59E0B] transition-colors"
              >
                <option value="">Select metric…</option>
                {catalog && CATEGORY_ORDER.map((cat) => {
                  const metrics = catalog[cat];
                  if (!metrics?.length) return null;
                  return (
                    <optgroup key={cat} label={CATEGORY_LABELS[cat] ?? cat}>
                      {metrics.map((m) => (
                        <option key={m.key} value={m.key}>{m.label}</option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
            </div>
          </div>

          {/* Time range + trendline */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex gap-1">
              {DAYS_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  onClick={() => setDays(o.value)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    days === o.value
                      ? "bg-[#F59E0B] text-[#0D0D0F]"
                      : "bg-[#18181B] border border-[#27272A] text-[#52525B] hover:text-[#A1A1AA]"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowTrendline((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                showTrendline
                  ? "border-[#F59E0B] text-[#F59E0B] bg-[#F59E0B]/10"
                  : "border-[#27272A] text-[#52525B] hover:text-[#71717A]"
              }`}
            >
              <TrendingUp size={11} />
              Trendline
            </button>
          </div>

          {isFetching && (
            <div className="text-center py-8 text-xs text-[#52525B]">Computing…</div>
          )}

          {!isFetching && result && (
            <div className="space-y-4">
              <div className={`flex items-start gap-4 p-4 rounded-xl border ${rBg(result.r)}`}>
                <div>
                  <p className={`text-3xl font-semibold tabular-nums ${rColor(result.r)}`}>
                    {result.r !== null ? result.r.toFixed(2) : "—"}
                  </p>
                  <p className="text-xs text-[#52525B] mt-0.5">Pearson r</p>
                </div>
                <div className="flex-1">
                  <p className="text-sm text-[#A1A1AA] font-medium">{result.interpretation}</p>
                  <p className="text-xs text-[#52525B] mt-0.5">
                    {result.n} data points
                    {result.p_value !== null && result.p_value < 0.05 && (
                      <span className="ml-1.5 text-emerald-500">· p&lt;0.05 significant</span>
                    )}
                  </p>
                </div>
              </div>

              {points.length >= 3 ? (
                <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 pt-4 pb-2">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs text-[#52525B] uppercase tracking-widest">
                      {result.metric_a.label} → {result.metric_b.label}
                    </p>
                    {trendlinePoints && (
                      <div className="flex items-center gap-1 text-[10px] text-[#F59E0B]/60">
                        <Minus size={10} className="text-[#F59E0B]" style={{ strokeDasharray: "3 2" }} />
                        trendline
                      </div>
                    )}
                  </div>
                  <ResponsiveContainer width="100%" height={220}>
                    <ComposedChart margin={{ top: 4, right: 4, bottom: 20, left: -10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#18181B" />
                      <XAxis
                        dataKey="x"
                        type="number"
                        name={result.metric_a.label}
                        tick={{ fill: "#52525B", fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                        label={{
                          value: `${result.metric_a.label} (${result.metric_a.unit})`,
                          position: "insideBottom",
                          fill: "#52525B",
                          fontSize: 10,
                          offset: -12,
                        }}
                      />
                      <YAxis
                        dataKey="y"
                        type="number"
                        name={result.metric_b.label}
                        tick={{ fill: "#52525B", fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip content={customTooltip} cursor={{ strokeDasharray: "3 3" }} />
                      <Scatter data={points} fill="#60A5FA" stroke="#3B82F6" r={4} />
                      {trendlinePoints && (
                        <Line
                          data={trendlinePoints}
                          type="linear"
                          dataKey="y"
                          dot={false}
                          stroke="#F59E0B"
                          strokeWidth={1.5}
                          strokeDasharray="4 2"
                        />
                      )}
                    </ComposedChart>
                  </ResponsiveContainer>
                  <p className="text-[10px] text-[#3F3F46] text-center mt-1">
                    Y: {result.metric_b.label} ({result.metric_b.unit})
                  </p>
                </div>
              ) : (
                <div className="border border-dashed border-[#27272A] rounded-lg px-4 py-8 text-center">
                  <p className="text-sm text-[#52525B]">
                    {result.n === 0
                      ? "No overlapping data for these two metrics."
                      : `Only ${result.n} overlapping data points — need at least 3.`}
                  </p>
                </div>
              )}
            </div>
          )}

          {!isFetching && !result && metricA && metricB && metricA !== metricB && (
            <div className="text-center py-12 text-xs text-[#52525B]">Select two different metrics to compare.</div>
          )}

          {(!metricA || !metricB) && !isFetching && (
            <div className="border border-dashed border-[#27272A] rounded-lg px-4 py-8 text-center">
              <p className="text-sm text-[#52525B]">Select two metrics above to see how they correlate.</p>
              <p className="text-xs text-[#3F3F46] mt-1">Includes tags and people as 0/1 variables.</p>
            </div>
          )}
        </div>
      )}

      {/* ── PERIOD TAB ── */}
      {tab === "period" && (
        <div className="space-y-5">
          {/* Metric picker */}
          <div className="flex gap-2 flex-wrap">
            {PERIOD_METRICS.map((m) => (
              <button
                key={m.key}
                onClick={() => setPeriodMetric(m.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  periodMetric === m.key
                    ? "bg-[#F59E0B] text-[#0D0D0F]"
                    : "bg-[#18181B] border border-[#27272A] text-[#52525B] hover:text-[#A1A1AA]"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* Period type */}
          <div className="flex gap-1">
            {(["month", "week", "year"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriodType(p)}
                className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors border ${
                  periodType === p
                    ? "border-[#F59E0B] text-[#F59E0B] bg-[#F59E0B]/10"
                    : "border-[#27272A] text-[#52525B] hover:text-[#A1A1AA]"
                }`}
              >
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>

          {periodFetching && (
            <div className="text-center py-8 text-xs text-[#52525B]">Loading…</div>
          )}

          {!periodFetching && periodData && (
            <div className="space-y-3">
              {/* Main comparison card */}
              <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4">
                <p className="text-xs text-[#52525B] uppercase tracking-widest mb-4">{periodData.label}</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-[10px] text-[#52525B] mb-1">
                      This {periodData.period}
                      {periodData.current.start && (
                        <span className="ml-1 text-[#3F3F46]">
                          ({periodData.current.start.slice(5).replace("-", "/")})
                        </span>
                      )}
                    </p>
                    <p className="text-3xl font-semibold tabular-nums text-[#FAFAFA]">
                      {periodData.current.avg ?? "—"}
                    </p>
                    {periodData.current.stddev != null && (
                      <p className="text-[10px] text-[#52525B] mt-0.5">±{periodData.current.stddev} σ</p>
                    )}
                  </div>
                  <div>
                    <p className="text-[10px] text-[#52525B] mb-1">
                      Last {periodData.period}
                      {periodData.prior.start && (
                        <span className="ml-1 text-[#3F3F46]">
                          ({periodData.prior.start.slice(5).replace("-", "/")})
                        </span>
                      )}
                    </p>
                    <p className="text-3xl font-semibold tabular-nums text-[#71717A]">
                      {periodData.prior.avg ?? "—"}
                    </p>
                    {periodData.prior.stddev != null && (
                      <p className="text-[10px] text-[#52525B] mt-0.5">±{periodData.prior.stddev} σ</p>
                    )}
                  </div>
                </div>

                {periodData.pct_change != null && (
                  <div className={`mt-4 flex items-center gap-1.5 text-sm font-semibold ${
                    periodData.pct_change > 0 ? "text-emerald-400" : periodData.pct_change < 0 ? "text-red-400" : "text-[#71717A]"
                  }`}>
                    {periodData.pct_change > 0 ? <ArrowUpRight size={14} /> : periodData.pct_change < 0 ? <ArrowDownRight size={14} /> : null}
                    {periodData.pct_change > 0 ? "+" : ""}{periodData.pct_change}% vs last {periodData.period}
                  </div>
                )}
              </div>

              {/* Same period last year */}
              {periodData.same_period_last_year.avg != null && (
                <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] text-[#52525B] mb-1">
                      Same {periodData.period} last year
                      {periodData.same_period_last_year.start && (
                        <span className="ml-1 text-[#3F3F46]">
                          ({periodData.same_period_last_year.start.slice(0, 7)})
                        </span>
                      )}
                    </p>
                    <p className="text-2xl font-semibold tabular-nums text-[#71717A]">
                      {periodData.same_period_last_year.avg}
                    </p>
                  </div>
                  {periodData.current.avg != null && (
                    <div className="text-right">
                      <p className="text-[10px] text-[#52525B] mb-1">YoY change</p>
                      <p className={`text-sm font-semibold ${
                        periodData.current.avg > periodData.same_period_last_year.avg ? "text-emerald-400" :
                        periodData.current.avg < periodData.same_period_last_year.avg ? "text-red-400" : "text-[#71717A]"
                      }`}>
                        {periodData.current.avg > periodData.same_period_last_year.avg ? "+" : ""}
                        {(periodData.current.avg - periodData.same_period_last_year.avg).toFixed(1)} {periodData.unit}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {!periodFetching && !periodData && (
            <div className="border border-dashed border-[#27272A] rounded-lg px-4 py-12 text-center">
              <p className="text-sm text-[#52525B]">Select a metric above.</p>
            </div>
          )}
        </div>
      )}

      {/* ── WEEKLY TAB ── */}
      {tab === "weekly" && (
        <div className="space-y-6">
          {weekdayData.length > 0 ? (
            <>
              {/* Best day highlight */}
              {weeklyData?.best_weekday_mood && (
                <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-4 flex items-center gap-4">
                  <span className="text-3xl">😄</span>
                  <div>
                    <p className="text-xs text-[#52525B] uppercase tracking-widest mb-0.5">Best day for mood</p>
                    <p className="text-lg font-semibold text-[#FAFAFA]">{weeklyData.best_weekday_mood}</p>
                  </div>
                  {weeklyData?.best_weekday_energy && weeklyData.best_weekday_energy !== weeklyData.best_weekday_mood && (
                    <div className="ml-auto text-right">
                      <p className="text-xs text-[#52525B] uppercase tracking-widest mb-0.5">Best for energy</p>
                      <p className="text-sm font-medium text-[#A1A1AA]">{weeklyData.best_weekday_energy}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Mood by weekday bar chart */}
              <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 pt-4 pb-3">
                <p className="text-xs text-[#52525B] uppercase tracking-widest mb-4">Avg mood by day</p>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={weekdayData} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#18181B" vertical={false} />
                    <XAxis
                      dataKey="weekday"
                      tick={{ fill: "#52525B", fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v: string) => v.slice(0, 3)}
                    />
                    <YAxis
                      domain={[0, 10]}
                      tick={{ fill: "#52525B", fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      {...TOOLTIP_STYLE}
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      formatter={(val: any) => [val != null ? Number(val).toFixed(1) : "—", "Avg mood"]}
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      labelFormatter={(label: any) => String(label)}
                    />
                    <Bar dataKey="avg_mood" radius={[4, 4, 0, 0]}>
                      {weekdayData.map((entry, i) => (
                        <Cell
                          key={i}
                          fill={
                            entry.weekday === weeklyData?.best_weekday_mood
                              ? "#F59E0B"
                              : "#3B82F6"
                          }
                          opacity={entry.n < 3 ? 0.3 : 0.8}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Tag impact table */}
              {(weeklyData?.top_tags ?? []).length > 0 && (
                <div>
                  <p className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Tag impact on mood</p>
                  <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl overflow-hidden">
                    <div className="grid grid-cols-4 px-4 py-2 border-b border-[#27272A]">
                      <p className="text-[10px] text-[#52525B] uppercase col-span-2">Tag</p>
                      <p className="text-[10px] text-[#52525B] uppercase text-center">With / Without</p>
                      <p className="text-[10px] text-[#52525B] uppercase text-right">Delta</p>
                    </div>
                    {(weeklyData?.top_tags ?? []).map((tag) => (
                      <div key={tag.slug} className="grid grid-cols-4 items-center px-4 py-3 border-b border-[#18181B] last:border-0">
                        <div className="col-span-2 flex items-center gap-2 min-w-0">
                          <span className="text-base shrink-0">{tag.icon ?? "🏷️"}</span>
                          <div className="min-w-0">
                            <p className="text-sm text-[#FAFAFA] truncate">{tag.name}</p>
                            <p className="text-[10px] text-[#52525B]">{tag.usage}d</p>
                          </div>
                        </div>
                        <p className="text-xs text-[#A1A1AA] text-center tabular-nums">
                          {tag.avg_mood_with.toFixed(1)} / {tag.avg_mood_without.toFixed(1)}
                        </p>
                        <p className={`text-sm font-semibold tabular-nums text-right ${deltaColor(tag.delta)}`}>
                          {tag.delta > 0 ? "+" : ""}{tag.delta.toFixed(1)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Energy by weekday */}
              <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 pt-4 pb-3">
                <p className="text-xs text-[#52525B] uppercase tracking-widest mb-4">Avg energy by day</p>
                <ResponsiveContainer width="100%" height={130}>
                  <BarChart data={weekdayData} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#18181B" vertical={false} />
                    <XAxis
                      dataKey="weekday"
                      tick={{ fill: "#52525B", fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v: string) => v.slice(0, 3)}
                    />
                    <YAxis
                      domain={[0, 10]}
                      tick={{ fill: "#52525B", fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      {...TOOLTIP_STYLE}
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      formatter={(val: any) => [val != null ? Number(val).toFixed(1) : "—", "Avg energy"]}
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      labelFormatter={(label: any) => String(label)}
                    />
                    <Bar dataKey="avg_energy" radius={[4, 4, 0, 0]}>
                      {weekdayData.map((entry, i) => (
                        <Cell
                          key={i}
                          fill={
                            entry.weekday === weeklyData?.best_weekday_energy
                              ? "#10B981"
                              : "#6366F1"
                          }
                          opacity={entry.n < 3 ? 0.3 : 0.75}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          ) : (
            <div className="border border-dashed border-[#27272A] rounded-lg px-4 py-12 text-center">
              <p className="text-sm text-[#52525B]">Not enough mood data yet for weekly patterns.</p>
            </div>
          )}
        </div>
      )}
      {/* ── HABITS TAB ── */}
      {tab === "habits" && (
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
                <div>
                  <h2 className="text-xl font-semibold">{habitDetail.name}</h2>
                  <p className="text-sm text-[#71717A]">{habitDetail.total_days_all} days tagged</p>
                </div>
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
            </div>
          )}
        </div>
      )}

      {/* Tag stats drawer */}
      {selectedTagSlug && (
        <TagStatsDrawer slug={selectedTagSlug} onClose={() => setSelectedTagSlug(null)} />
      )}

      {/* ── EXPERIMENTS TAB ── */}
      {tab === "experiments" && <ExperimentsTab />}

    </main>
  );
}


const TODAY = new Date().toISOString().slice(0, 10);

// ═══════════════════════════════════════════════════════════════════════════════
// EXPERIMENTS TAB
// ═══════════════════════════════════════════════════════════════════════════════


interface Experiment {
  id: string;
  title: string;
  hypothesis: string;
  protocol: string | null;
  tag: string | null;
  metric: string | null;
  outcome_threshold: number | null;
  start_date: string;
  end_date: string | null;
  status: string;
  result: string | null;
  effect_size: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface ExperimentResult {
  treatment_n: number;
  control_n: number;
  treatment_mean: number | null;
  control_mean: number | null;
  delta: number | null;
  effect_size: number | null;
  metric_label: string;
  outcome_type: string;
}

const OUTCOME_METRICS = [
  { key: "energy",        label: "Energy (1-10)",        hasThreshold: true  },
  { key: "mood",          label: "Mood (1-10)",           hasThreshold: true  },
  { key: "sleep_quality", label: "Sleep quality (1-10)", hasThreshold: true  },
  { key: "stress",        label: "Stress (1-10)",         hasThreshold: true  },
  { key: "hrv_avg",       label: "HRV (ms)",              hasThreshold: false },
  { key: "sleep_duration",label: "Sleep duration (hours)",hasThreshold: false },
  { key: "resting_hr",    label: "Resting HR (bpm)",      hasThreshold: false },
  { key: "battery_high",  label: "Body battery (peak)",   hasThreshold: false },
  { key: "steps",         label: "Steps",                 hasThreshold: false },
];

const EXP_STATUS_STYLE = {
  active:    { dot: "bg-green-400",  text: "text-green-400" },
  concluded: { dot: "bg-blue-400",   text: "text-blue-400"  },
  abandoned: { dot: "bg-[#52525B]",  text: "text-[#71717A]" },
};

function effectLabel(d: number | null) {
  if (d == null) return null;
  const a = Math.abs(d);
  if (a > 0.8) return { text: "Large effect", color: "text-green-400" };
  if (a > 0.5) return { text: "Medium effect", color: "text-yellow-400" };
  if (a > 0.2) return { text: "Small effect", color: "text-[#A1A1AA]" };
  return { text: "Negligible", color: "text-[#52525B]" };
}

function ExperimentResultBadge({ id }: { id: string }) {
  const { data, isLoading } = useQuery<ExperimentResult>({
    queryKey: ["exp-compute", id],
    queryFn: async () => {
      const res = await fetch(`/api/experiments/${id}/compute`);
      if (!res.ok) throw new Error();
      return res.json();
    },
    staleTime: 60_000,
    retry: false,
  });

  if (isLoading) return <span className="text-xs text-[#52525B]">Computing…</span>;
  if (!data || data.treatment_n === 0) return <span className="text-xs text-[#52525B]">No treatment days yet — tag some days first</span>;

  const effect = effectLabel(data.effect_size);
  const positive = (data.delta ?? 0) > 0;
  const isRate = data.outcome_type === "tag_rate" || data.outcome_type === "metric_threshold";

  return (
    <div className="bg-[#18181B] rounded-lg px-3 py-2 space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-[#71717A]">{data.metric_label}</span>
        {effect && <span className={`font-medium ${effect.color}`}>{effect.text}</span>}
      </div>
      <div className="flex items-center justify-around">
        <div className="text-center">
          <p className="text-lg font-bold tabular-nums text-[#FAFAFA]">
            {data.treatment_mean != null ? (isRate ? `${Math.round(data.treatment_mean * 100)}%` : data.treatment_mean) : "—"}
          </p>
          <p className="text-[10px] text-[#52525B]">With tag ({data.treatment_n}d)</p>
        </div>
        <div className={`text-xl font-bold tabular-nums ${positive ? "text-green-400" : "text-red-400"}`}>
          {data.delta != null ? `${positive ? "+" : ""}${isRate ? Math.round(data.delta * 100) + "%" : data.delta}` : "—"}
        </div>
        <div className="text-center">
          <p className="text-lg font-bold tabular-nums text-[#FAFAFA]">
            {data.control_mean != null ? (isRate ? `${Math.round(data.control_mean * 100)}%` : data.control_mean) : "—"}
          </p>
          <p className="text-[10px] text-[#52525B]">Without ({data.control_n}d)</p>
        </div>
      </div>
      {data.effect_size != null && (
        <p className="text-[10px] text-[#52525B]">
          {data.outcome_type === "tag_rate" ? `Cohen's h = ${data.effect_size}` : `Cohen's d = ${data.effect_size}`}
        </p>
      )}
    </div>
  );
}

function ExperimentsTab() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [concluding, setConcluding] = useState<Experiment | null>(null);
  const [statusFilter, setStatusFilter] = useState("active");

  const { data: experiments = [] } = useQuery<Experiment[]>({
    queryKey: ["experiments", statusFilter],
    queryFn: async () => {
      const qs = statusFilter === "all" ? "" : `?status=${statusFilter}`;
      const res = await fetch(`/api/experiments${qs}`);
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 10_000,
  });

  function invalidate() { qc.invalidateQueries({ queryKey: ["experiments"] }); }

  async function del(id: string) {
    if (!confirm("Delete this experiment?")) return;
    await fetch(`/api/experiments/${id}`, { method: "DELETE" });
    invalidate();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-1 bg-[#0D0D0F] border border-[#27272A] rounded-lg p-0.5">
          {["active", "concluded", "all"].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)} className={`px-3 py-1 rounded text-xs font-medium capitalize transition-colors ${statusFilter === s ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"}`}>{s}</button>
          ))}
        </div>
        <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 bg-[#18181B] border border-[#27272A] hover:border-[#3F3F46] rounded-lg px-3 py-1.5 text-xs transition-colors">
          <Plus size={12} /> New
        </button>
      </div>

      <div className="space-y-3">
        {experiments.length === 0 && (
          <div className="text-center py-12 space-y-2">
            <p className="text-4xl">🧪</p>
            <p className="text-[#A1A1AA] text-sm">No {statusFilter === "all" ? "" : statusFilter} experiments</p>
            <p className="text-[#52525B] text-xs">Pick a habit tag + an outcome → let your own data tell you if it works</p>
          </div>
        )}
        {experiments.map(exp => {
          const s = EXP_STATUS_STYLE[exp.status as keyof typeof EXP_STATUS_STYLE] ?? EXP_STATUS_STYLE.active;
          const metricLabel = exp.metric?.startsWith("tag:")
            ? `#${exp.metric.slice(4)} rate`
            : (OUTCOME_METRICS.find(m => m.key === exp.metric)?.label ?? exp.metric);
          return (
            <div key={exp.id} className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${s.dot}`} />
                    {exp.tag && <span className="text-xs bg-[#27272A] text-[#A1A1AA] px-2 py-0.5 rounded-full">#{exp.tag}</span>}
                    {exp.metric && <span className="text-xs text-[#52525B]">→ {metricLabel}{exp.outcome_threshold != null ? ` ≥ ${exp.outcome_threshold}` : ""}</span>}
                  </div>
                  <p className="text-sm font-medium text-[#FAFAFA]">{exp.title}</p>
                  <p className="text-xs text-[#71717A] italic">{exp.hypothesis}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {exp.status === "active" && (
                    <button onClick={() => setConcluding(exp)} className="p-1.5 rounded-lg text-[#52525B] hover:text-green-400 transition-colors" title="Conclude"><CheckCircle size={14} /></button>
                  )}
                  <button onClick={() => del(exp.id)} className="p-1.5 rounded-lg text-[#52525B] hover:text-red-400 transition-colors" title="Delete"><Trash2 size={14} /></button>
                </div>
              </div>

              {exp.status === "active" && exp.tag && exp.metric && (
                <ExperimentResultBadge id={exp.id} />
              )}

              {exp.result && (
                <div className="bg-[#18181B] rounded-lg px-3 py-2 space-y-1">
                  <p className="text-xs text-[#A1A1AA]">{exp.result}</p>
                  {exp.effect_size != null && (() => {
                    const ef = effectLabel(exp.effect_size);
                    return <p className={`text-xs font-medium ${ef?.color}`}>{ef?.text} · d={exp.effect_size}</p>;
                  })()}
                </div>
              )}

              <p className="text-xs text-[#52525B]">
                {format(parseISO(exp.start_date), "d MMM yyyy")}
                {exp.end_date ? ` → ${format(parseISO(exp.end_date), "d MMM yyyy")}` : " → ongoing"}
              </p>
            </div>
          );
        })}
      </div>

      {showAdd && <ExperimentSheet onClose={() => setShowAdd(false)} onSaved={invalidate} />}
      {concluding && <ExperimentConcludeSheet experiment={concluding} onClose={() => setConcluding(null)} onSaved={invalidate} />}
    </div>
  );
}

function ExperimentSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    title: "",
    hypothesis: "",
    protocol: "",
    tag: "",
    outcomeType: "metric" as "metric" | "tag" | "threshold",
    metric: "",
    outcomeTag: "",
    threshold: "",
    start_date: TODAY,
    end_date: "",
  });
  const [saving, setSaving] = useState(false);

  const { data: allTags = [] } = useQuery<TagType[]>({
    queryKey: ["tags"],
    queryFn: async () => {
      const res = await fetch("/api/tags");
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 5 * 60_000,
  });

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm(f => ({ ...f, [k]: e.target.value }));

  const selectedMetric = OUTCOME_METRICS.find(m => m.key === form.metric);

  function buildMetricPayload(): { metric: string | null; outcome_threshold: number | null } {
    if (form.outcomeType === "tag") {
      return { metric: form.outcomeTag ? `tag:${form.outcomeTag}` : null, outcome_threshold: null };
    }
    if (form.outcomeType === "threshold" && form.metric && form.threshold) {
      return { metric: form.metric, outcome_threshold: Number(form.threshold) };
    }
    return { metric: form.metric || null, outcome_threshold: null };
  }

  async function save() {
    if (!form.title.trim() || !form.hypothesis.trim()) return;
    setSaving(true);
    const { metric, outcome_threshold } = buildMetricPayload();
    try {
      const res = await fetch("/api/experiments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(),
          hypothesis: form.hypothesis.trim(),
          protocol: form.protocol.trim() || null,
          tag: form.tag || null,
          metric,
          outcome_threshold,
          start_date: form.start_date,
          end_date: form.end_date || null,
        }),
      });
      if (!res.ok) throw new Error();
      onSaved(); onClose();
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end justify-center" onClick={onClose}>
      <div className="w-full max-w-lg bg-[#0D0D0F] border border-[#27272A] rounded-t-2xl p-6 space-y-4 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">New experiment</h2>
          <button onClick={onClose}><X size={18} className="text-[#52525B]" /></button>
        </div>

        <input autoFocus placeholder="Title *" value={form.title} onChange={set("title")} className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder:text-[#3F3F46] outline-none focus:border-[#F59E0B]" />
        <textarea rows={2} placeholder="Hypothesis: If I do X, then Y will change because Z *" value={form.hypothesis} onChange={set("hypothesis")} className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder:text-[#3F3F46] outline-none focus:border-[#F59E0B] resize-none" />
        <textarea rows={2} placeholder="Protocol (optional): exactly what, how often, how long" value={form.protocol} onChange={set("protocol")} className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder:text-[#3F3F46] outline-none focus:border-[#F59E0B] resize-none" />

        {/* Compliance tag */}
        <div>
          <label className="text-xs text-[#71717A] mb-1.5 block">Compliance tag — tag days when you do the intervention</label>
          <select value={form.tag} onChange={set("tag")} className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B]">
            <option value="">Select a tag…</option>
            {allTags.map(t => (
              <option key={t.id} value={t.slug}>{t.icon ? `${t.icon} ` : ""}{t.name}</option>
            ))}
          </select>
        </div>

        {/* Outcome type */}
        <div>
          <label className="text-xs text-[#71717A] mb-1.5 block">What are you measuring?</label>
          <div className="flex gap-1 bg-[#111] border border-[#27272A] rounded-lg p-0.5">
            {([
              { key: "metric",    label: "Mean metric" },
              { key: "threshold", label: "Metric threshold" },
              { key: "tag",       label: "Another tag" },
            ] as const).map(({ key, label }) => (
              <button key={key} type="button" onClick={() => setForm(f => ({ ...f, outcomeType: key }))}
                className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${form.outcomeType === key ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"}`}>
                {label}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-[#52525B] mt-1">
            {form.outcomeType === "metric" && "Compare average value on treatment vs. control days"}
            {form.outcomeType === "threshold" && "Compare % of days where metric hits a target (e.g. energy ≥ 7)"}
            {form.outcomeType === "tag" && "Compare how often another tag appears on treatment vs. control days"}
          </p>
        </div>

        {/* Metric picker */}
        {(form.outcomeType === "metric" || form.outcomeType === "threshold") && (
          <div className={`grid gap-3 ${form.outcomeType === "threshold" ? "grid-cols-2" : "grid-cols-1"}`}>
            <div>
              <label className="text-xs text-[#71717A] mb-1 block">Metric</label>
              <select value={form.metric} onChange={set("metric")} className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B]">
                <option value="">Select…</option>
                {OUTCOME_METRICS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
              </select>
            </div>
            {form.outcomeType === "threshold" && (
              <div>
                <label className="text-xs text-[#71717A] mb-1 block">Target (≥)</label>
                <input type="number" step="0.5" placeholder="e.g. 7" value={form.threshold} onChange={set("threshold")} className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B]" />
              </div>
            )}
          </div>
        )}

        {/* Tag outcome picker */}
        {form.outcomeType === "tag" && (
          <div>
            <label className="text-xs text-[#71717A] mb-1 block">Outcome tag</label>
            <select value={form.outcomeTag} onChange={set("outcomeTag")} className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B]">
              <option value="">Select a tag…</option>
              {allTags.filter(t => t.slug !== form.tag).map(t => (
                <option key={t.id} value={t.slug}>{t.icon ? `${t.icon} ` : ""}{t.name}</option>
              ))}
            </select>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-[#71717A] mb-1 block">Start date</label>
            <input type="date" value={form.start_date} onChange={set("start_date")} className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B]" />
          </div>
          <div>
            <label className="text-xs text-[#71717A] mb-1 block">End date</label>
            <input type="date" value={form.end_date} onChange={set("end_date")} className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B]" />
          </div>
        </div>

        {form.tag && (
          <p className="text-xs text-[#52525B]">
            Tag <span className="text-[#A1A1AA]">#{form.tag}</span> on days you do the intervention. Days without the tag become the control group automatically.
          </p>
        )}

        <button onClick={save} disabled={saving || !form.title.trim() || !form.hypothesis.trim()} className="w-full bg-[#F59E0B] text-black font-semibold rounded-xl py-3 text-sm disabled:opacity-40">
          {saving ? "Saving…" : "Start experiment"}
        </button>
      </div>
    </div>
  );
}

function ExperimentConcludeSheet({ experiment, onClose, onSaved }: { experiment: Experiment; onClose: () => void; onSaved: () => void }) {
  const [result, setResult] = useState(experiment.result ?? "");
  const [saving, setSaving] = useState(false);

  async function conclude(status: "concluded" | "abandoned") {
    setSaving(true);
    try {
      await fetch(`/api/experiments/${experiment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, result: result.trim() || null, end_date: experiment.end_date ?? TODAY }),
      });
      onSaved(); onClose();
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end justify-center" onClick={onClose}>
      <div className="w-full max-w-lg bg-[#0D0D0F] border border-[#27272A] rounded-t-2xl p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Conclude: {experiment.title}</h2>
          <button onClick={onClose}><X size={18} className="text-[#52525B]" /></button>
        </div>
        <p className="text-xs text-[#71717A] italic">{experiment.hypothesis}</p>
        {experiment.tag && experiment.metric && <ExperimentResultBadge id={experiment.id} />}
        <textarea autoFocus rows={3} placeholder="Your conclusion — did the hypothesis hold?" value={result} onChange={e => setResult(e.target.value)} className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder:text-[#3F3F46] outline-none focus:border-[#F59E0B] resize-none" />
        <div className="flex gap-3">
          <button onClick={() => conclude("abandoned")} disabled={saving} className="flex-1 bg-[#18181B] border border-[#27272A] text-[#71717A] rounded-xl py-3 text-sm hover:text-[#A1A1AA]">Abandon</button>
          <button onClick={() => conclude("concluded")} disabled={saving} className="flex-1 bg-[#F59E0B] text-black font-semibold rounded-xl py-3 text-sm disabled:opacity-40">{saving ? "Saving…" : "Conclude"}</button>
        </div>
      </div>
    </div>
  );
}
