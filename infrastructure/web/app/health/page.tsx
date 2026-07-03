"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Activity, Moon, Dumbbell, Flame, AlertTriangle } from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, ReferenceLine,
} from "recharts";
import { format, parseISO, subDays } from "date-fns";
import { HRContext } from "@/components/HRContext";
import { injuriesApi, type ActiveSummaryItem, ZONE_LABELS } from "@/lib/injuries-api";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type HealthSummary = {
  avg_hrv: number | null;
  avg_resting_hr: number | null;
  avg_sleep_seconds: number | null;
  avg_sleep_score: number | null;
  avg_stress: number | null;
  avg_battery_high: number | null;
  avg_steps: number | null;
  max_hrv: number | null;
  min_hrv: number | null;
  hrv_trend_7d: number | null;
  period_days: number;
};

type HealthDay = {
  date: string;
  hrv: number | null;
  hrv_weekly: number | null;
  sleep_seconds: number | null;
  deep_seconds: number | null;
  rem_seconds: number | null;
  sleep_score: number | null;
  resting_hr: number | null;
  stress_avg: number | null;
  body_battery_low: number | null;
  body_battery_high: number | null;
  steps: number | null;
  energy: number | null;
  mood: number | null;
};

const PERIODS = [
  { label: "2W", days: 14 },
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
];

function fmtSleep(s: number | null) {
  if (!s) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}

function KpiCard({ label, value, sub, trend }: { label: string; value: string; sub?: string; trend?: number | null }) {
  return (
    <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3">
      <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">{label}</p>
      <p className="text-xl font-semibold text-[#FAFAFA] tabular-nums">{value}</p>
      {trend !== undefined && trend !== null && (
        <p className={`text-xs mt-0.5 ${trend >= 0 ? "text-emerald-500" : "text-red-400"}`}>
          {trend >= 0 ? "↑" : "↓"} {Math.abs(trend)} vs prev week
        </p>
      )}
      {sub && !trend && <p className="text-xs text-[#52525B] mt-0.5">{sub}</p>}
    </div>
  );
}

const TOOLTIP_STYLE = {
  contentStyle: { background: "#09090B", border: "1px solid #27272A", borderRadius: 8, fontSize: 12 },
  labelStyle: { color: "#A1A1AA" },
  itemStyle: { color: "#FAFAFA" },
};

export default function HealthPage() {
  const [days, setDays] = useState(30);

  const end = format(new Date(), "yyyy-MM-dd");
  const start = format(subDays(new Date(), days - 1), "yyyy-MM-dd");

  const { data: summary } = useQuery<HealthSummary>({
    queryKey: ["health-summary", days],
    queryFn: () => fetch(`${BASE}/health/summary?days=${days}`).then(r => r.json()),
  });

  const { data: trend = [] } = useQuery<HealthDay[]>({
    queryKey: ["health-trends", start, end],
    queryFn: () => fetch(`${BASE}/health/trends?start=${start}&end=${end}`).then(r => r.json()),
  });

  const { data: activeInjuries = [] } = useQuery<ActiveSummaryItem[]>({
    queryKey: ["injuries-active-summary"],
    queryFn: injuriesApi.activeSummary,
  });

  const fmtDate = (d: string) => format(parseISO(d), "d MMM");

  return (
    <main className="max-w-2xl mx-auto px-4 pb-20 pt-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <Link href="/" className="text-xs text-[#71717A] hover:text-[#A1A1AA] uppercase tracking-widest inline-block mb-2">
              ← Today
            </Link>
            <h1 className="text-2xl font-semibold tracking-tight">Health</h1>
            <p className="text-sm text-[#71717A] mt-0.5">Recovery & wellness trends</p>
          </div>
          {/* Period selector */}
          <div className="flex gap-1 bg-[#0D0D0F] border border-[#27272A] rounded-lg p-1 mt-1">
            {PERIODS.map(p => (
              <button
                key={p.days}
                onClick={() => setDays(p.days)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  days === p.days ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        {/* Sub-nav */}
        <div className="flex gap-0 bg-[#0D0D0F] border border-[#27272A] rounded-lg p-1 mt-4 w-full overflow-x-auto">
          <span className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-[#27272A] text-[#FAFAFA] whitespace-nowrap">
            <Activity size={13} />Overview
          </span>
          <Link href="/training" className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-[#52525B] hover:text-[#A1A1AA] transition-colors whitespace-nowrap">
            <Dumbbell size={13} />Training
          </Link>
          <Link href="/health/sleep" className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-[#52525B] hover:text-[#A1A1AA] transition-colors whitespace-nowrap">
            <Moon size={13} />Sleep
          </Link>
          <Link href="/health/streaks" className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-[#52525B] hover:text-[#A1A1AA] transition-colors whitespace-nowrap">
            <Flame size={13} />Streaks
          </Link>
          <Link href="/health/injuries" className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-[#52525B] hover:text-[#A1A1AA] transition-colors whitespace-nowrap">
            <AlertTriangle size={13} />Injuries
          </Link>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-3 gap-3 mb-8">
        <KpiCard
          label="HRV"
          value={summary?.avg_hrv ? `${summary.avg_hrv}` : "—"}
          sub={`${summary?.min_hrv ?? "—"}–${summary?.max_hrv ?? "—"} range`}
          trend={summary?.hrv_trend_7d}
        />
        <KpiCard
          label="Resting HR"
          value={summary?.avg_resting_hr ? `${summary.avg_resting_hr} bpm` : "—"}
          sub="avg"
        />
        <KpiCard
          label="Sleep"
          value={fmtSleep(summary?.avg_sleep_seconds ?? null)}
          sub={summary?.avg_sleep_score ? `score ${summary.avg_sleep_score}` : undefined}
        />
        <KpiCard
          label="Stress"
          value={summary?.avg_stress ? `${summary.avg_stress}` : "—"}
          sub="avg daily"
        />
        <KpiCard
          label="Body Battery"
          value={summary?.avg_battery_high ? `${summary.avg_battery_high}` : "—"}
          sub="avg peak"
        />
        <KpiCard
          label="Steps"
          value={summary?.avg_steps ? `${Math.round(summary.avg_steps).toLocaleString()}` : "—"}
          sub="avg/day"
        />
      </div>

      {/* Injury alert banner */}
      {activeInjuries.length > 0 && (
        <Link href="/health/injuries" className="block mb-6">
          <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl px-4 py-3 flex items-center justify-between hover:bg-orange-500/15 transition-colors">
            <div className="flex items-center gap-3">
              <span className="text-orange-400 text-base">⚠</span>
              <div>
                <p className="text-sm font-medium text-orange-300">
                  {activeInjuries.filter(i => i.status === "active").length > 0
                    ? `${activeInjuries.filter(i => i.status === "active").length} active injur${activeInjuries.filter(i => i.status === "active").length === 1 ? "y" : "ies"}`
                    : `${activeInjuries.length} recovering`}
                  {activeInjuries.filter(i => i.status === "active").length > 0 && activeInjuries.filter(i => i.status === "recovering").length > 0
                    ? ` · ${activeInjuries.filter(i => i.status === "recovering").length} recovering`
                    : ""}
                </p>
                <p className="text-xs text-orange-500/80 mt-0.5">
                  {activeInjuries.slice(0, 2).map(i =>
                    `${ZONE_LABELS[i.zone] ?? i.zone}${i.side ? ` (${i.side})` : ""} ${i.pain_scale}/10`
                  ).join(" · ")}
                  {activeInjuries.length > 2 ? ` · +${activeInjuries.length - 2} more` : ""}
                </p>
              </div>
            </div>
            <span className="text-orange-500/60 text-xs">View →</span>
          </div>
        </Link>
      )}

      {/* HRV Trend */}
      <section className="mb-8">
        <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-4">HRV trend</h2>
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4">
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={trend} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid stroke="#18181B" vertical={false} />
              <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill: "#52525B", fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fill: "#52525B", fontSize: 11 }} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
              <Tooltip {...TOOLTIP_STYLE} formatter={(v) => [`${v}`, "HRV"]} labelFormatter={(d) => fmtDate(String(d))} />
              {summary?.avg_hrv && <ReferenceLine y={summary.avg_hrv} stroke="#52525B" strokeDasharray="3 3" />}
              <Line dataKey="hrv_weekly" stroke="#52525B" dot={false} strokeDasharray="3 3" strokeWidth={1} name="7d avg" />
              <Line dataKey="hrv" stroke="#F59E0B" dot={false} strokeWidth={2} name="HRV" connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <HRContext days={days} />

      {/* Sleep */}
      <section className="mb-8">
        <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-4">Sleep duration</h2>
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4">
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={trend} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid stroke="#18181B" vertical={false} />
              <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill: "#52525B", fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fill: "#52525B", fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={v => `${Math.floor(v / 3600)}h`} />
              <Tooltip {...TOOLTIP_STYLE} formatter={(v) => [fmtSleep(typeof v === "number" ? v : null), "Sleep"]} labelFormatter={(d) => fmtDate(String(d))} />
              <Bar dataKey="sleep_seconds" fill="#3B82F6" radius={[2, 2, 0, 0]} name="Sleep" maxBarSize={20} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Resting HR */}
      <section className="mb-8">
        <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-4">Resting heart rate</h2>
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4">
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={trend} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid stroke="#18181B" vertical={false} />
              <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill: "#52525B", fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fill: "#52525B", fontSize: 11 }} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
              <Tooltip {...TOOLTIP_STYLE} formatter={(v) => [`${v} bpm`, "Resting HR"]} labelFormatter={(d) => fmtDate(String(d))} />
              <Line dataKey="resting_hr" stroke="#EF4444" dot={false} strokeWidth={2} connectNulls name="Resting HR" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Body Battery */}
      <section className="mb-8">
        <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-4">Body battery</h2>
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4">
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={trend} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid stroke="#18181B" vertical={false} />
              <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill: "#52525B", fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fill: "#52525B", fontSize: 11 }} tickLine={false} axisLine={false} domain={[0, 100]} />
              <Tooltip {...TOOLTIP_STYLE} labelFormatter={(d) => fmtDate(String(d))} />
              <Bar dataKey="body_battery_high" fill="#22C55E" radius={[2, 2, 0, 0]} name="Peak" maxBarSize={20} />
              <Bar dataKey="body_battery_low" fill="#EF4444" radius={[2, 2, 0, 0]} name="Low" maxBarSize={20} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Stress + Mood */}
      <section className="mb-8">
        <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-4">Stress & mood</h2>
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4">
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={trend} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid stroke="#18181B" vertical={false} />
              <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill: "#52525B", fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fill: "#52525B", fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip {...TOOLTIP_STYLE} labelFormatter={(d) => fmtDate(String(d))} />
              <Line dataKey="stress_avg" stroke="#F59E0B" dot={false} strokeWidth={2} name="Stress" connectNulls />
              <Line dataKey="mood" stroke="#A78BFA" dot={false} strokeWidth={2} name="Mood" connectNulls />
              <Line dataKey="energy" stroke="#22C55E" dot={false} strokeWidth={2} name="Energy" connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>
    </main>
  );
}
