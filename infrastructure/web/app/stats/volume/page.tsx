"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const TOOLTIP = {
  contentStyle: { background: "#09090B", border: "1px solid #27272A", borderRadius: 8, fontSize: 12 },
  labelStyle: { color: "#A1A1AA" },
  itemStyle: { color: "#FAFAFA" },
};

type Period = {
  period: string;
  period_label: string;
  distance_km: number;
  moving_time_seconds: number;
  elevation_gain_meters: number;
  activity_count: number;
};

const METRICS = [
  { key: "distance_km", label: "Distance", unit: "km", fmt: (v: number) => `${v.toFixed(1)} km` },
  { key: "moving_time_seconds", label: "Time", unit: "h", fmt: (v: number) => `${(v / 3600).toFixed(1)}h` },
  { key: "elevation_gain_meters", label: "Elevation", unit: "m", fmt: (v: number) => `${Math.round(v)} m` },
];

const GROUPINGS = [
  { key: "weekly", label: "Weekly", periods: 52 },
  { key: "monthly", label: "Monthly", periods: 24 },
];

export default function VolumePage() {
  const [metric, setMetric] = useState("distance_km");
  const [grouping, setGrouping] = useState("weekly");

  const { data: rows = [] } = useQuery<Period[]>({
    queryKey: ["volume", grouping],
    queryFn: () =>
      fetch(`${BASE}/stats/volume?grouping=${grouping}&periods=${grouping === "weekly" ? 52 : 24}`).then((r) => r.json()),
  });

  const currentMetric = METRICS.find((m) => m.key === metric)!;
  const total = rows.reduce((s, r) => s + (r[metric as keyof Period] as number), 0);
  const totalActivities = rows.reduce((s, r) => s + r.activity_count, 0);
  const avg = rows.length > 0 ? total / rows.length : 0;

  const chartData = rows.map((r) => ({
    label: r.period_label,
    value: metric === "moving_time_seconds"
      ? parseFloat(((r[metric as keyof Period] as number) / 3600).toFixed(2))
      : r[metric as keyof Period],
  }));

  return (
    <main className="max-w-2xl mx-auto px-4 pb-20 pt-8">
      <div className="mb-6">
        <Link href="/stats" className="text-xs text-[#71717A] hover:text-[#A1A1AA] uppercase tracking-widest inline-block mb-2">
          ← Stats
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Volume</h1>
      </div>

      {/* Grouping toggle */}
      <div className="flex gap-2 mb-4">
        {GROUPINGS.map((g) => (
          <button
            key={g.key}
            onClick={() => setGrouping(g.key)}
            className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
              grouping === g.key
                ? "bg-[#F59E0B] text-black border-[#F59E0B] font-medium"
                : "bg-transparent text-[#71717A] border-[#27272A] hover:border-[#3F3F46]"
            }`}
          >
            {g.label}
          </button>
        ))}
      </div>

      {/* Metric toggle */}
      <div className="flex gap-2 mb-6">
        {METRICS.map((m) => (
          <button
            key={m.key}
            onClick={() => setMetric(m.key)}
            className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
              metric === m.key
                ? "border-[#F59E0B] text-[#F59E0B]"
                : "bg-transparent text-[#71717A] border-[#27272A] hover:border-[#3F3F46]"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-3 py-3">
          <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Total</p>
          <p className="text-lg font-semibold tabular-nums">{currentMetric.fmt(total)}</p>
        </div>
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-3 py-3">
          <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Avg / period</p>
          <p className="text-lg font-semibold tabular-nums">{currentMetric.fmt(avg)}</p>
        </div>
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-3 py-3">
          <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Activities</p>
          <p className="text-lg font-semibold tabular-nums">{totalActivities}</p>
        </div>
      </div>

      {/* Bar chart */}
      <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 pt-4 pb-2">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#18181B" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: "#52525B", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              interval={grouping === "weekly" ? 7 : 1}
            />
            <YAxis
              tick={{ fill: "#52525B", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) =>
                metric === "moving_time_seconds" ? `${v}h` : metric === "elevation_gain_meters" ? `${v}m` : `${v}`
              }
            />
            <Tooltip
              {...TOOLTIP}
              formatter={(v) => [
                metric === "moving_time_seconds"
                  ? `${Number(v).toFixed(1)}h`
                  : metric === "elevation_gain_meters"
                  ? `${Math.round(Number(v))} m`
                  : `${Number(v).toFixed(1)} km`,
                currentMetric.label,
              ]}
            />
            <Bar dataKey="value" fill="#F59E0B" radius={[2, 2, 0, 0]} maxBarSize={20} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </main>
  );
}
