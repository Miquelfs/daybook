"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO, subDays } from "date-fns";
import Link from "next/link";
import {
  ComposedChart, Line, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, ReferenceLine,
} from "recharts";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const PERIODS = [
  { label: "2W", days: 14 },
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
];

type HealthDay = {
  date: string;
  energy: number | null;
  mood: number | null;
  fatigue_score: number | null;
  hrv_load: number | null;
  sleep_debt: number | null;
  tss_load: number | null;
  recovery_status: string | null;
};

const STATUS_COLOR: Record<string, string> = {
  recovering:   "#4ADE80",
  balanced:     "#FACC15",
  accumulating: "#F87171",
};

const TOOLTIP_STYLE = {
  contentStyle: { background: "#09090B", border: "1px solid #27272A", borderRadius: 8, fontSize: 12 },
  labelStyle: { color: "#A1A1AA" },
  itemStyle: { color: "#FAFAFA" },
};

function CustomDot(props: { cx?: number; cy?: number; payload?: HealthDay }) {
  const { cx, cy, payload } = props;
  if (!cx || !cy || !payload?.recovery_status) return null;
  const fill = STATUS_COLOR[payload.recovery_status] ?? "#71717A";
  return <circle cx={cx} cy={cy} r={4} fill={fill} stroke="none" />;
}

export default function LoadIndexPage() {
  const [periodDays, setPeriodDays] = useState(30);

  const end = format(new Date(), "yyyy-MM-dd");
  const start = format(subDays(new Date(), periodDays - 1), "yyyy-MM-dd");

  const { data: trend = [] } = useQuery<HealthDay[]>({
    queryKey: ["health-trends-load", start, end],
    queryFn: () =>
      fetch(`${BASE}/health/trends?start=${start}&end=${end}`).then((r) => r.json()),
  });

  const fmtDate = (d: unknown) => typeof d === "string" ? format(parseISO(d), "d MMM") : String(d);

  // Only rows where we have fatigue_score
  const loadRows = trend.filter((d) => d.fatigue_score != null);
  const coverage = loadRows.length;
  const avgFatigue = coverage
    ? Math.round(loadRows.reduce((s, d) => s + (d.fatigue_score ?? 0), 0) / coverage)
    : null;

  // Correlation: fatigue_score (inverted, since high fatigue → low energy) vs energy
  const pairs = trend.filter((d) => d.fatigue_score != null && d.energy != null);
  let pearsonNote = "";
  if (pairs.length >= 5) {
    const xs = pairs.map((d) => d.fatigue_score!);
    const ys = pairs.map((d) => d.energy!);
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    const cov = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
    const sdx = Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0));
    const sdy = Math.sqrt(ys.reduce((s, y) => s + (y - my) ** 2, 0));
    const r = sdx && sdy ? -(cov / (sdx * sdy)) : 0; // negated: fatigue ↑ → energy ↓
    pearsonNote = `r = ${r.toFixed(2)} (fatigue vs energy, n=${pairs.length})`;
  }

  const statusCounts = loadRows.reduce<Record<string, number>>((acc, d) => {
    if (d.recovery_status) acc[d.recovery_status] = (acc[d.recovery_status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <main className="max-w-2xl mx-auto px-4 pb-20 pt-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-start justify-between">
          <div>
            <Link href="/health" className="text-xs text-[#71717A] hover:text-[#A1A1AA] uppercase tracking-widest inline-block mb-2">
              ← Health
            </Link>
            <h1 className="text-2xl font-semibold tracking-tight">Load Index</h1>
            <p className="text-sm text-[#71717A] mt-0.5">H1 validation — fatigue model vs. felt energy</p>
          </div>
          <div className="flex gap-1 bg-[#0D0D0F] border border-[#27272A] rounded-lg p-1">
            {PERIODS.map((p) => (
              <button
                key={p.days}
                onClick={() => setPeriodDays(p.days)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  periodDays === p.days ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Sub-nav */}
        <div className="flex gap-2 mt-4 flex-wrap">
          <Link href="/health" className="text-xs px-3 py-1.5 rounded-full border border-[#27272A] text-[#71717A] hover:text-[#A1A1AA] transition-colors">Overview</Link>
          <Link href="/health/sleep" className="text-xs px-3 py-1.5 rounded-full border border-[#27272A] text-[#71717A] hover:text-[#A1A1AA] transition-colors">Sleep</Link>
          <Link href="/training" className="text-xs px-3 py-1.5 rounded-full border border-[#27272A] text-[#71717A] hover:text-[#A1A1AA] transition-colors">Training</Link>
          <Link href="/health/streaks" className="text-xs px-3 py-1.5 rounded-full border border-[#27272A] text-[#71717A] hover:text-[#A1A1AA] transition-colors">Streaks</Link>
          <Link href="/health/injuries" className="text-xs px-3 py-1.5 rounded-full border border-[#27272A] text-[#71717A] hover:text-[#A1A1AA] transition-colors">Injuries</Link>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-3 gap-3 mb-8">
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3">
          <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Avg Fatigue</p>
          <p className="text-xl font-semibold tabular-nums">{avgFatigue ?? "—"}<span className="text-sm text-[#52525B]">/100</span></p>
        </div>
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3">
          <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Coverage</p>
          <p className="text-xl font-semibold tabular-nums">{coverage}<span className="text-sm text-[#52525B]"> days</span></p>
        </div>
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3">
          <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Correlation</p>
          <p className="text-sm font-semibold text-[#A1A1AA]">{pearsonNote ? pearsonNote.split(" ")[2] : "—"}</p>
          <p className="text-xs text-[#52525B]">fatigue↔energy</p>
        </div>
      </div>

      {/* Recovery status breakdown */}
      {Object.keys(statusCounts).length > 0 && (
        <div className="flex gap-3 mb-8">
          {Object.entries(statusCounts).map(([status, count]) => (
            <div key={status} className="flex-1 bg-[#0D0D0F] border border-[#27272A] rounded-xl px-3 py-3 text-center">
              <div className="w-2 h-2 rounded-full mx-auto mb-1" style={{ background: STATUS_COLOR[status] ?? "#71717A" }} />
              <p className="text-lg font-bold tabular-nums" style={{ color: STATUS_COLOR[status] ?? "#71717A" }}>{count}</p>
              <p className="text-xs text-[#52525B] capitalize">{status}</p>
            </div>
          ))}
        </div>
      )}

      {/* Main chart: fatigue + energy + mood */}
      <section className="mb-8">
        <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-4">Fatigue score vs. felt energy</h2>
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4">
          {trend.length === 0 ? (
            <p className="text-sm text-[#52525B] text-center py-8">No data for this period</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={trend} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <CartesianGrid stroke="#18181B" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={fmtDate}
                  tick={{ fill: "#52525B", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                {/* Left axis: fatigue 0-100 */}
                <YAxis yAxisId="fatigue" domain={[0, 100]} tick={{ fill: "#52525B", fontSize: 11 }} tickLine={false} axisLine={false} />
                {/* Right axis: energy/mood 1-10 */}
                <YAxis yAxisId="felt" orientation="right" domain={[1, 10]} tick={{ fill: "#52525B", fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip
                  {...TOOLTIP_STYLE}
                  formatter={(val, name) =>
                    name === "fatigue_score" ? [`${val}/100`, "Fatigue"] :
                    name === "energy" ? [`${val}/10`, "Energy"] :
                    [`${val}/10`, "Mood"]
                  }
                  labelFormatter={fmtDate}
                />
                <ReferenceLine yAxisId="fatigue" y={33} stroke="#27272A" strokeDasharray="3 3" />
                <ReferenceLine yAxisId="fatigue" y={66} stroke="#27272A" strokeDasharray="3 3" />
                <Bar
                  yAxisId="fatigue"
                  dataKey="fatigue_score"
                  name="fatigue_score"
                  fill="#818CF8"
                  opacity={0.5}
                  radius={[2, 2, 0, 0]}
                />
                <Line
                  yAxisId="felt"
                  dataKey="energy"
                  name="energy"
                  stroke="#4ADE80"
                  dot={<CustomDot />}
                  strokeWidth={2}
                  connectNulls
                />
                <Line
                  yAxisId="felt"
                  dataKey="mood"
                  name="mood"
                  stroke="#F59E0B"
                  dot={false}
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                  connectNulls
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
          <p className="text-xs text-[#52525B] mt-3">
            Bars = computed fatigue (0-100, left axis). Green line = reported energy, amber dashes = mood (right axis, 1-10).
            Dot colour: <span style={{ color: "#4ADE80" }}>● recovering</span> · <span style={{ color: "#FACC15" }}>● balanced</span> · <span style={{ color: "#F87171" }}>● accumulating</span>
          </p>
          {pearsonNote && (
            <p className="text-xs text-[#52525B] mt-1">{pearsonNote}</p>
          )}
        </div>
      </section>

      {/* Component breakdown chart */}
      <section className="mb-8">
        <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-4">Load components</h2>
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4">
          <ResponsiveContainer width="100%" height={180}>
            <ComposedChart data={trend} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid stroke="#18181B" vertical={false} />
              <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill: "#52525B", fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis domain={[0, 25]} tick={{ fill: "#52525B", fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip
                {...TOOLTIP_STYLE}
                formatter={(val, name) =>
                  name === "hrv_load" ? [`${Number(val).toFixed(1)}/25`, "HRV load"] :
                  name === "sleep_debt" ? [`${Number(val).toFixed(1)}/25`, "Sleep debt"] :
                  [`${Number(val).toFixed(1)}/25`, "Training stress"]
                }
                labelFormatter={fmtDate}
              />
              <Bar yAxisId={undefined} dataKey="hrv_load" name="hrv_load" fill="#818CF8" stackId="a" radius={[0,0,0,0]} />
              <Bar yAxisId={undefined} dataKey="sleep_debt" name="sleep_debt" fill="#FACC15" stackId="a" opacity={0.8} />
              <Bar yAxisId={undefined} dataKey="tss_load" name="tss_load" fill="#F87171" stackId="a" opacity={0.7} radius={[2,2,0,0]} />
            </ComposedChart>
          </ResponsiveContainer>
          <p className="text-xs text-[#52525B] mt-2">
            Stacked: <span style={{ color: "#818CF8" }}>■ HRV</span> · <span style={{ color: "#FACC15" }}>■ sleep debt</span> · <span style={{ color: "#F87171" }}>■ training</span> — each component capped at 25
          </p>
        </div>
      </section>

      {/* Explanation */}
      <section className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4 space-y-2">
        <h3 className="text-xs text-[#52525B] uppercase tracking-widest">How the model works</h3>
        <p className="text-sm text-[#A1A1AA]">Fatigue score = sum of four components (0–25 each):</p>
        <ul className="text-xs text-[#71717A] space-y-1 ml-3">
          <li><span className="text-[#818CF8]">HRV load</span> — how far today's HRV is below the 7-day rolling average</li>
          <li><span className="text-yellow-400">Sleep debt</span> — cumulative deficit over 3 nights vs. 8h target</li>
          <li><span className="text-red-400">Training stress</span> — exercise load from activities</li>
          <li><span className="text-[#52525B]">Timezone penalty</span> — timezone displacement (duty days abroad)</li>
        </ul>
        <p className="text-xs text-[#52525B] pt-1">{"< 33 recovering · 33-66 balanced · > 66 accumulating"}</p>
        <p className="text-xs text-[#52525B]">The model is validated when the correlation between fatigue and felt energy is strong (r {"< -0.5"}). If it's weak, the weights need tuning.</p>
      </section>
    </main>
  );
}
