"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Cell, PieChart, Pie, Legend,
} from "recharts";
import { format, parseISO, subDays } from "date-fns";
import { activityIcon, fmtDuration, fmtDistance } from "@/lib/api";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type TrainingSummary = {
  activity_count: number;
  total_km: number | null;
  total_hours: number | null;
  total_elevation_m: number | null;
  avg_hr: number | null;
  total_tss: number | null;
  prev_activity_count: number;
  prev_total_km: number | null;
  period_days: number;
};

type WeeklyRow = {
  week: string;
  week_start: string;
  activity_type: string;
  count: number;
  km: number;
  hours: number;
  elevation_m: number;
  tss: number;
};

type SportRow = {
  sport: string;
  count: number;
  km: number;
  hours: number;
  elevation_m: number;
  avg_hr: number | null;
};

type PR = {
  id: number;
  activity_id: string;
  date: string;
  activity_type: string;
  activity_name: string;
  segment_name: string;
  segment_distance_m: number | null;
  duration_seconds: number;
  avg_heart_rate: number | null;
};

type Activity = {
  id: string;
  date: string;
  activity_type: string | null;
  name: string | null;
  duration_seconds: number | null;
  distance_meters: number | null;
  elevation_gain_meters: number | null;
  avg_heart_rate: number | null;
  training_stress_score: number | null;
  has_polyline: number;
};

const PERIODS = [
  { label: "4W", weeks: 4 },
  { label: "3M", weeks: 12 },
  { label: "6M", weeks: 24 },
];

const SPORT_COLORS: Record<string, string> = {
  running: "#F59E0B",
  cycling: "#3B82F6",
  swimming: "#06B6D4",
  walking: "#22C55E",
  hiking: "#84CC16",
  other: "#71717A",
};

function sportColor(sport: string) {
  const s = sport.toLowerCase();
  for (const [k, v] of Object.entries(SPORT_COLORS)) {
    if (s.includes(k)) return v;
  }
  return SPORT_COLORS.other;
}

function KpiCard({ label, value, sub, delta }: { label: string; value: string; sub?: string; delta?: number | null }) {
  return (
    <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3">
      <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">{label}</p>
      <p className="text-xl font-semibold text-[#FAFAFA] tabular-nums">{value}</p>
      {delta !== undefined && delta !== null && (
        <p className={`text-xs mt-0.5 ${delta >= 0 ? "text-emerald-500" : "text-red-400"}`}>
          {delta >= 0 ? "↑" : "↓"} {Math.abs(Math.round(delta))} vs prev
        </p>
      )}
      {sub && delta === undefined && <p className="text-xs text-[#52525B] mt-0.5">{sub}</p>}
    </div>
  );
}

const TOOLTIP_STYLE = {
  contentStyle: { background: "#09090B", border: "1px solid #27272A", borderRadius: 8, fontSize: 12 },
  labelStyle: { color: "#A1A1AA" },
  itemStyle: { color: "#FAFAFA" },
};

export default function TrainingPage() {
  const [weeks, setWeeks] = useState(12);
  const [sportFilter, setSportFilter] = useState<string | null>(null);

  const end = format(new Date(), "yyyy-MM-dd");
  const start = format(subDays(new Date(), weeks * 7), "yyyy-MM-dd");
  const days = weeks * 7;

  const { data: summary } = useQuery<TrainingSummary>({
    queryKey: ["training-summary", days],
    queryFn: () => fetch(`${BASE}/training/summary?days=${days}`).then(r => r.json()),
  });

  const { data: weekly = [] } = useQuery<WeeklyRow[]>({
    queryKey: ["training-weekly", start, end],
    queryFn: () => fetch(`${BASE}/training/weekly?start=${start}&end=${end}`).then(r => r.json()),
  });

  const { data: sports = [] } = useQuery<SportRow[]>({
    queryKey: ["training-sports", start, end],
    queryFn: () => fetch(`${BASE}/training/sport-breakdown?start=${start}&end=${end}`).then(r => r.json()),
  });

  const { data: prs = [] } = useQuery<PR[]>({
    queryKey: ["training-prs"],
    queryFn: () => fetch(`${BASE}/training/personal-records?limit=15`).then(r => r.json()),
  });

  const { data: activities = [] } = useQuery<Activity[]>({
    queryKey: ["training-activities", start, end, sportFilter],
    queryFn: () => {
      const params = new URLSearchParams({ start, end, limit: "30" });
      if (sportFilter) params.set("sport", sportFilter);
      return fetch(`${BASE}/training/activities?${params}`).then(r => r.json());
    },
  });

  // Aggregate weekly data by week for the bar chart
  const weeklyAgg = Object.values(
    weekly.reduce<Record<string, { week: string; week_start: string; km: number; tss: number; hours: number }>>(
      (acc, r) => {
        if (!acc[r.week]) acc[r.week] = { week: r.week, week_start: r.week_start, km: 0, tss: 0, hours: 0 };
        acc[r.week].km += r.km;
        acc[r.week].tss += r.tss;
        acc[r.week].hours += r.hours;
        return acc;
      },
      {}
    )
  ).sort((a, b) => a.week.localeCompare(b.week));

  const kmDelta = summary && summary.prev_total_km
    ? (summary.total_km ?? 0) - summary.prev_total_km
    : null;

  return (
    <main className="max-w-2xl mx-auto px-4 pb-20 pt-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <Link href="/health" className="text-xs text-[#71717A] hover:text-[#A1A1AA] uppercase tracking-widest inline-block mb-2">
              ← Health
            </Link>
            <h1 className="text-2xl font-semibold tracking-tight">Training</h1>
            <p className="text-sm text-[#71717A] mt-0.5">Load, sport breakdown & PRs</p>
          </div>
          <Link href="/stats" className="text-xs text-[#F59E0B] hover:text-[#FCD34D] uppercase tracking-widest mt-1">
            Stats →
          </Link>
        </div>
        <div className="flex gap-1 bg-[#0D0D0F] border border-[#27272A] rounded-lg p-1 w-fit">
          {PERIODS.map(p => (
            <button
              key={p.weeks}
              onClick={() => setWeeks(p.weeks)}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                weeks === p.weeks ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-3 gap-3 mb-8">
        <KpiCard
          label="Distance"
          value={summary?.total_km ? `${summary.total_km} km` : "—"}
          delta={kmDelta}
        />
        <KpiCard
          label="Time"
          value={summary?.total_hours ? `${summary.total_hours}h` : "—"}
          sub="moving"
        />
        <KpiCard
          label="Activities"
          value={summary?.activity_count?.toString() ?? "—"}
          delta={summary ? summary.activity_count - summary.prev_activity_count : null}
        />
        <KpiCard
          label="Elevation"
          value={summary?.total_elevation_m ? `${summary.total_elevation_m.toLocaleString()} m` : "—"}
          sub="total gain"
        />
        <KpiCard
          label="Avg HR"
          value={summary?.avg_hr ? `${summary.avg_hr} bpm` : "—"}
          sub="across workouts"
        />
        <KpiCard
          label="TSS"
          value={summary?.total_tss ? `${summary.total_tss}` : "—"}
          sub="training stress"
        />
      </div>

      {/* Weekly km */}
      <section className="mb-8">
        <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-4">Weekly distance (km)</h2>
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4">
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={weeklyAgg} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid stroke="#18181B" vertical={false} />
              <XAxis
                dataKey="week_start"
                tickFormatter={d => format(parseISO(d), "d MMM")}
                tick={{ fill: "#52525B", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis tick={{ fill: "#52525B", fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip {...TOOLTIP_STYLE} formatter={(v) => [`${v} km`, "Distance"]} labelFormatter={(d) => format(parseISO(String(d)), "d MMM")} />
              <Bar dataKey="km" fill="#F59E0B" radius={[3, 3, 0, 0]} maxBarSize={28} name="km" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Sport breakdown */}
      <section className="mb-8">
        <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-4">Sport breakdown</h2>
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4 flex gap-4 items-center">
          <div style={{ width: 160, height: 160, flexShrink: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={sports} dataKey="km" nameKey="sport" cx="50%" cy="50%" outerRadius={70} innerRadius={40} strokeWidth={0}>
                  {sports.map(s => <Cell key={s.sport} fill={sportColor(s.sport)} />)}
                </Pie>
                <Tooltip {...TOOLTIP_STYLE} formatter={(v) => [`${v} km`, "Distance"]} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-col gap-2 flex-1 min-w-0">
            {sports.map(s => (
              <div key={s.sport} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: sportColor(s.sport) }} />
                  <span className="text-xs text-[#A1A1AA] capitalize truncate">{s.sport}</span>
                </div>
                <div className="flex gap-3 text-xs text-[#52525B] tabular-nums flex-shrink-0">
                  <span>{s.km} km</span>
                  <span>{s.count}×</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Personal Records */}
      {prs.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-4">Recent personal records</h2>
          <div className="flex flex-col divide-y divide-[#18181B]">
            {prs.map(pr => (
              <Link
                key={pr.id}
                href={`/activity/${pr.activity_id}`}
                className="flex items-center justify-between py-3 hover:bg-[#0D0D0F] rounded-lg px-2 -mx-2 transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-sm text-[#FAFAFA] truncate">{pr.segment_name}</p>
                  <p className="text-xs text-[#52525B] mt-0.5">
                    {format(parseISO(pr.date), "d MMM")} · {activityIcon(pr.activity_type)} {pr.activity_name}
                    {pr.segment_distance_m ? ` · ${(pr.segment_distance_m / 1000).toFixed(1)} km` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                  <span className="text-xs bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded px-1.5 py-0.5">PR</span>
                  <span className="text-sm font-medium tabular-nums text-[#FAFAFA]">{fmtDuration(pr.duration_seconds)}</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Activity log */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs text-[#52525B] uppercase tracking-widest">Activities</h2>
          <div className="flex gap-1">
            {[null, "running", "cycling", "swimming", "walking"].map(s => (
              <button
                key={s ?? "all"}
                onClick={() => setSportFilter(s)}
                className={`px-2 py-1 rounded text-xs transition-colors ${
                  sportFilter === s ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"
                }`}
              >
                {s ? activityIcon(s) : "All"}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col divide-y divide-[#18181B]">
          {activities.map(a => (
            <Link
              key={a.id}
              href={`/activity/${a.id}`}
              className="flex items-center justify-between py-3 hover:bg-[#0D0D0F] rounded-lg px-2 -mx-2 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-lg">{activityIcon(a.activity_type)}</span>
                <div className="min-w-0">
                  <p className="text-sm text-[#FAFAFA] truncate">{a.name ?? a.activity_type ?? "Activity"}</p>
                  <p className="text-xs text-[#52525B]">{format(parseISO(a.date), "EEE d MMM")}</p>
                </div>
              </div>
              <div className="flex gap-3 text-xs text-[#A1A1AA] tabular-nums flex-shrink-0 ml-3">
                {a.distance_meters ? <span>{fmtDistance(a.distance_meters)}</span> : null}
                {a.duration_seconds ? <span>{fmtDuration(a.duration_seconds)}</span> : null}
                {a.elevation_gain_meters ? <span>↑{Math.round(a.elevation_gain_meters)}m</span> : null}
                {a.avg_heart_rate ? <span>♥ {Math.round(a.avg_heart_rate)}</span> : null}
              </div>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
