"use client";

import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { format, parseISO, subWeeks, subMonths } from "date-fns";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

type VolumeRow = { period_start: string; value: number };
type ProgressRow = { period_start: string; value: number; compare_value: number | null };

const METRICS = [
  { key: "distance", label: "Distance (km)" },
  { key: "time", label: "Time (h)" },
  { key: "elevation", label: "Elevation (m)" },
  { key: "tss", label: "TSS" },
];

const SPORTS = [
  { key: "", label: "All sports" },
  { key: "running", label: "Running" },
  { key: "cycling", label: "Cycling" },
  { key: "swimming", label: "Swimming" },
];

function fmtDate(d: string) {
  try { return format(parseISO(d), "d MMM"); } catch { return d; }
}

export function VolumeChart() {
  const [period, setPeriod] = useState<"week" | "month" | "year">("week");
  const [metric, setMetric] = useState("distance");
  const [data, setData] = useState<VolumeRow[]>([]);
  const [loading, setLoading] = useState(true);

  const weeks = period === "week" ? 26 : period === "month" ? 0 : 0;

  useEffect(() => {
    const end = format(new Date(), "yyyy-MM-dd");
    let start: string;
    let apiPeriod = period;
    if (period === "year") {
      start = format(subMonths(new Date(), 36), "yyyy-MM-dd");
      apiPeriod = "month"; // backend groups by month; we aggregate to year in display
    } else {
      start = format(period === "week" ? subWeeks(new Date(), 26) : subMonths(new Date(), 24), "yyyy-MM-dd");
    }
    setLoading(true);
    fetch(`${API}/training/volume?period=${apiPeriod}&metric=${metric}&start=${start}&end=${end}`)
      .then((r) => r.json())
      .then((rows) => {
        if (period === "year") {
          // Aggregate monthly rows into yearly buckets
          const yearly: Record<string, number> = {};
          for (const row of rows) {
            const yr = row.period_start.slice(0, 4);
            yearly[yr] = (yearly[yr] ?? 0) + (row.value ?? 0);
          }
          setData(Object.entries(yearly).sort().map(([yr, value]) => ({ period_start: `${yr}-01-01`, value: Math.round(value * 10) / 10 })));
        } else {
          setData(rows);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [period, metric]);

  const metricLabel = METRICS.find((m) => m.key === metric)?.label ?? metric;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1">
          {(["week", "month", "year"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1 rounded text-xs font-medium capitalize transition-colors ${
                period === p
                  ? "bg-blue-500 text-white"
                  : "bg-[#18181B] text-zinc-400 hover:text-white border border-[#27272A]"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
        <div className="flex gap-1 flex-wrap">
          {METRICS.map((m) => (
            <button
              key={m.key}
              onClick={() => setMetric(m.key)}
              className={`px-2.5 py-1 rounded text-xs transition-colors ${
                metric === m.key
                  ? "bg-zinc-600 text-white"
                  : "bg-[#18181B] text-zinc-400 hover:text-white border border-[#27272A]"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="h-[220px] flex items-center justify-center text-zinc-500 text-sm">Loading…</div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} barSize={period === "week" ? 6 : 14}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272A" vertical={false} />
            <XAxis
              dataKey="period_start"
              tickFormatter={(d) => period === "year" ? d.slice(0, 4) : fmtDate(d)}
              tick={{ fill: "#71717A", fontSize: 11 }}
              tickLine={false}
              interval={Math.max(0, Math.floor(data.length / 8) - 1)}
            />
            <YAxis tick={{ fill: "#71717A", fontSize: 11 }} tickLine={false} axisLine={false} />
            <Tooltip
              contentStyle={{ background: "#18181B", border: "1px solid #27272A", borderRadius: 6 }}
              labelStyle={{ color: "#A1A1AA", fontSize: 11 }}
              labelFormatter={fmtDate}
              formatter={(v: number) => [v, metricLabel]}
            />
            <Bar dataKey="value" fill="#3B82F6" radius={[2, 2, 0, 0]} name={metricLabel} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

export function ProgressComparisonChart() {
  const [sport, setSport] = useState("");
  const [metric, setMetric] = useState("distance");
  const [data, setData] = useState<ProgressRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Primary: last 12 weeks. Compare: same 12 weeks 1 year ago
  const now = new Date();
  const primaryEnd = format(now, "yyyy-MM-dd");
  const primaryStart = format(subWeeks(now, 12), "yyyy-MM-dd");
  const compareEnd = format(subWeeks(now, 52), "yyyy-MM-dd");
  const compareStart = format(subWeeks(now, 64), "yyyy-MM-dd");

  useEffect(() => {
    const params = new URLSearchParams({
      metric,
      start: primaryStart,
      end: primaryEnd,
      compare_start: compareStart,
      compare_end: compareEnd,
    });
    if (sport) params.set("sport", sport);
    setLoading(true);
    fetch(`${API}/training/progress?${params}`)
      .then((r) => r.json())
      .then((rows) => { setData(rows); setLoading(false); })
      .catch(() => setLoading(false));
  }, [sport, metric]);

  const metricLabel = METRICS.find((m) => m.key === metric)?.label ?? metric;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1 flex-wrap">
          {METRICS.map((m) => (
            <button
              key={m.key}
              onClick={() => setMetric(m.key)}
              className={`px-2.5 py-1 rounded text-xs transition-colors ${
                metric === m.key
                  ? "bg-zinc-600 text-white"
                  : "bg-[#18181B] text-zinc-400 hover:text-white border border-[#27272A]"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {SPORTS.map((s) => (
            <button
              key={s.key}
              onClick={() => setSport(s.key)}
              className={`px-2.5 py-1 rounded text-xs transition-colors ${
                sport === s.key
                  ? "bg-zinc-600 text-white"
                  : "bg-[#18181B] text-zinc-400 hover:text-white border border-[#27272A]"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-4 text-xs text-zinc-400">
        <span className="flex items-center gap-1.5"><span className="w-3 h-1 bg-blue-500 inline-block rounded" />Last 12 weeks</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-1 bg-zinc-600 inline-block rounded" />Year ago</span>
      </div>

      {loading ? (
        <div className="h-[220px] flex items-center justify-center text-zinc-500 text-sm">Loading…</div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} barSize={8} barGap={2}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272A" vertical={false} />
            <XAxis
              dataKey="period_start"
              tickFormatter={fmtDate}
              tick={{ fill: "#71717A", fontSize: 11 }}
              tickLine={false}
              interval={2}
            />
            <YAxis tick={{ fill: "#71717A", fontSize: 11 }} tickLine={false} axisLine={false} />
            <Tooltip
              contentStyle={{ background: "#18181B", border: "1px solid #27272A", borderRadius: 6 }}
              labelStyle={{ color: "#A1A1AA", fontSize: 11 }}
              labelFormatter={fmtDate}
              formatter={(v: number, name: string) => [
                v ?? "—",
                name === "value" ? "This period" : "Year ago",
              ]}
            />
            <Bar dataKey="value" fill="#3B82F6" radius={[2, 2, 0, 0]} name="value" />
            <Bar dataKey="compare_value" fill="#3F3F46" radius={[2, 2, 0, 0]} name="compare_value" />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
