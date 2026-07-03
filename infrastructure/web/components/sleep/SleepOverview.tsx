"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, AreaChart, Area,
} from "recharts";
import { format, parseISO } from "date-fns";

const TOOLTIP_STYLE = {
  contentStyle: { background: "#18181B", border: "1px solid #27272A", borderRadius: 8, fontSize: 12 },
  labelStyle: { color: "#A1A1AA" },
  itemStyle: { color: "#FAFAFA" },
};

function fmtDuration(s: number | null): string {
  if (!s) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}

function Kpi({ label, value, sub, flag }: { label: string; value: string; sub?: string; flag?: "warn" | "ok" | null }) {
  const color = flag === "warn" ? "text-rose-400" : flag === "ok" ? "text-emerald-400" : "text-[#FAFAFA]";
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-[#52525B] uppercase tracking-widest">{label}</span>
      <span className={`text-2xl font-semibold tabular-nums ${color}`}>{value}</span>
      {sub && <span className="text-xs text-[#71717A]">{sub}</span>}
    </div>
  );
}

interface Props {
  summary: Record<string, number | null> | null;
  stages: Record<string, number | null>[];
}

export function SleepOverview({ summary, stages }: Props) {
  const avgDur = summary?.avg_duration_seconds ?? null;
  const avgScore = summary?.avg_score ?? null;
  const deepPct = summary?.avg_deep_pct ?? null;
  const remPct = summary?.avg_rem_pct ?? null;
  const spo2 = summary?.avg_spo2 ?? null;
  const debtSeconds = summary?.sleep_debt_seconds ?? null;
  const consistency = summary?.consistency_stdev_hours ?? null;

  const chartData = stages.map((r) => {
    const total = (r.duration_seconds as number) || 1;
    return {
      date: r.date,
      deep: r.deep_seconds ? Math.round((r.deep_seconds as number) / total * 100) : 0,
      rem: r.rem_seconds ? Math.round((r.rem_seconds as number) / total * 100) : 0,
      light: r.light_seconds ? Math.round((r.light_seconds as number) / total * 100) : 0,
      awake: r.awake_seconds ? Math.round((r.awake_seconds as number) / total * 100) : 0,
      score: r.score,
      heavyDay: r.heavy_training_day ? 1 : 0,
    };
  });

  // Debt chart — cumulative deficit per night
  const debtChart = stages.map((r) => {
    const dur = (r.duration_seconds as number) || 0;
    const deficit = Math.max(0, 8 * 3600 - dur) / 3600;
    return { date: r.date, deficit: parseFloat(deficit.toFixed(2)) };
  });

  return (
    <section>
      <p className="text-xs text-[#F59E0B] uppercase tracking-[0.2em] mb-4">Overview · last 30 nights</p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 mb-8">
        <Kpi label="Avg duration" value={fmtDuration(avgDur)} />
        <Kpi label="Avg score" value={avgScore ? `${avgScore}/100` : "—"} />
        <Kpi
          label="Deep sleep"
          value={deepPct ? `${deepPct}%` : "—"}
          sub="healthy ≥ 18%"
          flag={deepPct ? (deepPct >= 18 ? "ok" : "warn") : null}
        />
        <Kpi
          label="REM sleep"
          value={remPct ? `${remPct}%` : "—"}
          sub="healthy ≥ 20%"
          flag={remPct ? (remPct >= 20 ? "ok" : "warn") : null}
        />
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-[#18181B] rounded-xl p-4 border border-[#27272A]">
          <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">SpO₂ avg</p>
          <p className={`text-xl font-semibold ${spo2 && spo2 < 95 ? "text-rose-400" : "text-[#FAFAFA]"}`}>
            {spo2 ? `${spo2}%` : "—"}
          </p>
          {spo2 && spo2 < 95 && <p className="text-xs text-rose-400 mt-1">Below threshold</p>}
        </div>
        <div className="bg-[#18181B] rounded-xl p-4 border border-[#27272A]">
          <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Sleep debt</p>
          <p className="text-xl font-semibold text-[#FAFAFA]">{fmtDuration(debtSeconds)}</p>
          <p className="text-xs text-[#71717A] mt-1">vs 8h/night target</p>
        </div>
        <div className="bg-[#18181B] rounded-xl p-4 border border-[#27272A]">
          <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Consistency</p>
          <p className={`text-xl font-semibold ${consistency && consistency > 1.5 ? "text-amber-400" : "text-[#FAFAFA]"}`}>
            {consistency ? `±${consistency}h` : "—"}
          </p>
          <p className="text-xs text-[#71717A] mt-1">stdev duration</p>
        </div>
      </div>

      {/* Sleep stages stacked bar chart */}
      <div className="mb-8">
        <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-4">Sleep stages (% per night)</h2>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -25 }} barSize={6}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272A" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#52525B" }} tickFormatter={(d) => format(parseISO(d), "d MMM")} interval={6} />
            <YAxis tick={{ fontSize: 10, fill: "#52525B" }} unit="%" domain={[0, 100]} />
            <Tooltip {...TOOLTIP_STYLE} formatter={(v) => [`${v}%`]} labelFormatter={(d) => format(parseISO(String(d)), "d MMM yyyy")} />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: "#A1A1AA" }} />
            <Bar dataKey="deep" stackId="a" fill="#3B82F6" name="Deep" />
            <Bar dataKey="rem" stackId="a" fill="#8B5CF6" name="REM" />
            <Bar dataKey="light" stackId="a" fill="#52525B" name="Light" />
            <Bar dataKey="awake" stackId="a" fill="#F59E0B" name="Awake" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Sleep debt area chart */}
      <div>
        <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-4">Nightly deficit vs 8h target</h2>
        <ResponsiveContainer width="100%" height={120}>
          <AreaChart data={debtChart} margin={{ top: 4, right: 4, bottom: 0, left: -25 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272A" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#52525B" }} tickFormatter={(d) => format(parseISO(d), "d MMM")} interval={6} />
            <YAxis tick={{ fontSize: 10, fill: "#52525B" }} unit="h" />
            <Tooltip {...TOOLTIP_STYLE} formatter={(v) => [`${v}h short`]} labelFormatter={(d) => format(parseISO(String(d)), "d MMM yyyy")} />
            <Area type="monotone" dataKey="deficit" fill="#F59E0B22" stroke="#F59E0B" strokeWidth={1.5} name="Deficit" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
