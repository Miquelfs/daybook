"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { format } from "date-fns";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type HeatmapResponse = {
  year: number;
  metric: string;
  unit: string;
  days: { date: string; value: number }[];
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const METRICS = [
  { key: "distance", label: "Distance" },
  { key: "time", label: "Time" },
  { key: "activities", label: "Activities" },
];

function colorForValue(value: number, max: number): string {
  if (!value || max === 0) return "#18181B";
  const intensity = Math.min(value / max, 1);
  if (intensity < 0.25) return "#78350F";
  if (intensity < 0.5) return "#B45309";
  if (intensity < 0.75) return "#D97706";
  return "#F59E0B";
}

export default function HeatmapPage() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [metric, setMetric] = useState("distance");

  const { data } = useQuery<HeatmapResponse>({
    queryKey: ["heatmap", year, metric],
    queryFn: () =>
      fetch(`${BASE}/stats/calendar-heatmap?year=${year}&metric=${metric}`).then((r) => r.json()),
  });

  const dayMap = new Map((data?.days ?? []).map((d) => [d.date, d.value]));
  const maxVal = Math.max(...(data?.days ?? []).map((d) => d.value), 1);

  // Build week columns for the year
  const startDate = new Date(year, 0, 1);
  const startDow = startDate.getDay(); // 0=Sun
  const totalDays = (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 366 : 365;

  // Pad the start so the grid lines up with day-of-week
  const cells: (string | null)[] = Array(startDow).fill(null);
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(year, 0, i + 1);
    cells.push(format(d, "yyyy-MM-dd"));
  }
  // Pad end to complete last week
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }

  // Month label positions
  const monthCols: { month: string; col: number }[] = [];
  for (let m = 0; m < 12; m++) {
    const firstDay = new Date(year, m, 1);
    const dayOfYear = Math.floor((firstDay.getTime() - startDate.getTime()) / 86400000);
    const col = Math.floor((dayOfYear + startDow) / 7);
    monthCols.push({ month: MONTHS[m], col });
  }

  return (
    <main className="max-w-2xl mx-auto px-4 pb-20 pt-8">
      <div className="mb-6">
        <Link href="/stats" className="text-xs text-[#71717A] hover:text-[#A1A1AA] uppercase tracking-widest inline-block mb-2">
          ← Stats
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Activity Heatmap</h1>
      </div>

      {/* Year nav */}
      <div className="flex items-center gap-4 mb-4">
        <button onClick={() => setYear((y) => y - 1)} className="text-[#52525B] hover:text-[#A1A1AA] text-lg">←</button>
        <span className="text-sm font-medium">{year}</span>
        {year < currentYear && (
          <button onClick={() => setYear((y) => y + 1)} className="text-[#52525B] hover:text-[#A1A1AA] text-lg">→</button>
        )}
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

      {/* Heatmap grid */}
      <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4 overflow-x-auto">
        {/* Month labels */}
        <div className="flex mb-1" style={{ gap: "2px" }}>
          {weeks.map((_, wi) => {
            const mc = monthCols.find((m) => m.col === wi);
            return (
              <div key={wi} style={{ width: 10, minWidth: 10 }} className="text-[8px] text-[#52525B] text-center overflow-hidden">
                {mc ? mc.month : ""}
              </div>
            );
          })}
        </div>

        {/* Cells — rows are days of week, cols are weeks */}
        {[0, 1, 2, 3, 4, 5, 6].map((dow) => (
          <div key={dow} className="flex" style={{ gap: "2px", marginBottom: "2px" }}>
            {weeks.map((week, wi) => {
              const dateStr = week[dow];
              if (!dateStr) {
                return <div key={wi} style={{ width: 10, height: 10, minWidth: 10 }} />;
              }
              const val = dayMap.get(dateStr) ?? 0;
              const color = colorForValue(val, maxVal);
              return (
                <div
                  key={wi}
                  title={val > 0 ? `${dateStr}: ${val.toFixed(1)} ${data?.unit ?? ""}` : dateStr}
                  style={{
                    width: 10,
                    height: 10,
                    minWidth: 10,
                    background: color,
                    borderRadius: 2,
                  }}
                />
              );
            })}
          </div>
        ))}

        {/* Legend */}
        <div className="flex items-center gap-2 mt-3 justify-end">
          <span className="text-[10px] text-[#52525B]">Less</span>
          {["#18181B", "#78350F", "#B45309", "#D97706", "#F59E0B"].map((c) => (
            <div key={c} style={{ width: 10, height: 10, background: c, borderRadius: 2 }} />
          ))}
          <span className="text-[10px] text-[#52525B]">More</span>
        </div>
      </div>

      {/* Summary */}
      <div className="mt-4 text-sm text-[#52525B] text-center">
        {data?.days?.length ?? 0} active days in {year}
      </div>
    </main>
  );
}
