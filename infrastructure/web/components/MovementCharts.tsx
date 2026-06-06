"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import type { MovementStats } from "@/lib/api";

interface Props {
  stats: MovementStats;
  year?: number;
}

function fmtKm(km: number): string {
  if (km >= 1000) return `${(km / 1000).toFixed(1)}k`;
  return `${Math.round(km)}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function WeeklyTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const date = new Date(d.week_start + "T12:00:00");
  const label = date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return (
    <div className="bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-xs shadow-lg">
      <p className="text-[#71717A] mb-1">Week of {label}</p>
      <p className="text-[#FAFAFA] font-semibold">{fmtKm(d.total_km)} km</p>
      <p className="text-[#52525B]">{d.days_with_data}d with data</p>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function MonthlyTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-xs shadow-lg">
      <p className="text-[#71717A] mb-1">{d.month}</p>
      <p className="text-[#FAFAFA] font-semibold">{fmtKm(d.total_km)} km</p>
      <p className="text-[#52525B]">{d.days_with_data}d with data</p>
    </div>
  );
}

export function MovementCharts({ stats, year }: Props) {
  const hasWeekly  = stats.weekly.length > 0;
  const hasMonthly = stats.monthly.length > 0;

  if (!hasWeekly && !hasMonthly) {
    return (
      <div className="border border-dashed border-[#27272A] rounded-xl px-4 py-10 text-center">
        <p className="text-sm text-[#52525B]">No movement data yet — run the location backfill to populate this.</p>
      </div>
    );
  }

  // Weekly avg for reference line
  const weeklyAvg =
    hasWeekly
      ? stats.weekly.reduce((s, w) => s + w.total_km, 0) / stats.weekly.length
      : 0;

  // For monthly view, shorten month labels
  const monthlyData = stats.monthly.map((m) => ({
    ...m,
    label: m.month.slice(0, 7), // "2026-05"
    shortLabel: new Date(m.month + "-01").toLocaleDateString("en-GB", { month: "short", year: "2-digit" }),
  }));

  return (
    <div className="flex flex-col gap-8">
      {/* Weekly bar chart */}
      {hasWeekly && (
        <section>
          <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-3">
            Weekly distance {year ? `(${year})` : "(last 2 years)"}
          </h2>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={stats.weekly} barCategoryGap="20%">
              <CartesianGrid vertical={false} stroke="#27272A" strokeDasharray="3 3" />
              <XAxis
                dataKey="week_start"
                tickFormatter={(v) =>
                  new Date(v + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })
                }
                tick={{ fill: "#52525B", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                interval={Math.floor(stats.weekly.length / 6)}
              />
              <YAxis
                tickFormatter={(v) => `${fmtKm(v)}`}
                tick={{ fill: "#52525B", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                width={36}
              />
              <Tooltip content={<WeeklyTooltip />} cursor={{ fill: "#27272A" }} />
              <ReferenceLine
                y={weeklyAvg}
                stroke="#F59E0B"
                strokeDasharray="4 2"
                strokeWidth={1}
              />
              <Bar dataKey="total_km" fill="#3B82F6" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <p className="text-xs text-[#52525B] mt-1 text-right">
            avg {fmtKm(weeklyAvg)} km/week
            <span className="ml-2 inline-block w-4 border-t border-dashed border-[#F59E0B] align-middle" />
          </p>
        </section>
      )}

      {/* Monthly bar chart */}
      {hasMonthly && (
        <section>
          <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-3">
            Monthly distance {year ? `(${year})` : ""}
          </h2>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={monthlyData} barCategoryGap="25%">
              <CartesianGrid vertical={false} stroke="#27272A" strokeDasharray="3 3" />
              <XAxis
                dataKey="shortLabel"
                tick={{ fill: "#52525B", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                interval={year ? 0 : Math.floor(monthlyData.length / 10)}
              />
              <YAxis
                tickFormatter={(v) => `${fmtKm(v)}`}
                tick={{ fill: "#52525B", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                width={36}
              />
              <Tooltip content={<MonthlyTooltip />} cursor={{ fill: "#27272A" }} />
              <Bar dataKey="total_km" fill="#6366F1" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </section>
      )}
    </div>
  );
}
