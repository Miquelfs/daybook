"use client";

import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  ScatterChart, Scatter, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Line, ComposedChart,
  BarChart, Bar, Cell,
} from "recharts";
import { format } from "date-fns";
import { correlationsApi } from "@/lib/correlations-api";
import type { MetricMeta, TopCorrelation, TagImpact, PrecomputedCorrelation } from "@/lib/correlations-api";
import { TrendingUp, Minus, BarChart2, GitCompare, Calendar, Zap, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { TagStatsDrawer } from "@/components/TagStatsDrawer";

const DAYS_OPTIONS = [
  { label: "30d", value: 30 },
  { label: "90d", value: 90 },
  { label: "180d", value: 180 },
  { label: "All", value: 365 },
];

const CATEGORY_ORDER = ["subjective", "health", "activity", "tags", "tag_values", "people"];
const CATEGORY_LABELS: Record<string, string> = {
  subjective: "Subjective",
  health: "Health",
  activity: "Activity",
  tags: "Tags",
  tag_values: "Tag Values",
  people: "People",
};

const TOOLTIP_STYLE = {
  contentStyle: { background: "#09090B", border: "1px solid #27272A", borderRadius: 8, fontSize: 12 },
  labelStyle: { color: "#A1A1AA" },
  itemStyle: { color: "#FAFAFA" },
};

type Tab = "discover" | "compare" | "weekly" | "period";

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
  const compareRef = useRef<HTMLDivElement>(null);

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
        <h1 className="text-2xl font-semibold tracking-tight">Insights</h1>
        <p className="text-sm text-[#71717A] mt-0.5">Patterns in your data.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 p-1 bg-[#0D0D0F] border border-[#27272A] rounded-xl">
        {(
          [
            { id: "discover" as Tab, label: "Discover", icon: BarChart2 },
            { id: "compare" as Tab, label: "Compare", icon: GitCompare },
            { id: "weekly" as Tab, label: "Weekly", icon: Calendar },
            { id: "period" as Tab, label: "Period", icon: Zap },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-xs font-medium transition-colors ${
              tab === id
                ? "bg-[#F59E0B] text-[#0D0D0F]"
                : "text-[#52525B] hover:text-[#A1A1AA]"
            }`}
          >
            <Icon size={12} />
            {label}
          </button>
        ))}
      </div>

      {/* ── DISCOVER TAB ── */}
      {tab === "discover" && (
        <div className="space-y-8">
          {/* Precomputed snapshot (weekly batch) */}
          {precomputed.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-[#52525B] uppercase tracking-widest">Weekly snapshot</p>
                {precomputedData?.computed_at && (
                  <p className="text-[10px] text-[#3F3F46]">
                    {format(new Date(precomputedData.computed_at), "d MMM")}
                  </p>
                )}
              </div>
              {/* Domain filter pills */}
              <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1 -mx-1 px-1">
                {["", "health", "activity", "tags", "people", "screen"].map((d) => (
                  <button
                    key={d}
                    onClick={() => setPrecomputedDomain(d)}
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
              <div className="space-y-2">
                {precomputed.map((c, i) => (
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
              </div>
            </div>
          )}

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
      {/* Tag stats drawer */}
      {selectedTagSlug && (
        <TagStatsDrawer slug={selectedTagSlug} onClose={() => setSelectedTagSlug(null)} />
      )}
    </main>
  );
}
