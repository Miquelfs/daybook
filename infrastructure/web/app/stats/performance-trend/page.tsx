"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { format } from "date-fns";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const TOOLTIP = {
  contentStyle: { background: "#09090B", border: "1px solid #27272A", borderRadius: 8, fontSize: 12 },
  labelStyle: { color: "#A1A1AA" },
  itemStyle: { color: "#FAFAFA" },
};

const DISTANCES = ["400m", "1K", "1 mile", "5K", "10K", "Half Marathon", "Marathon"];

function fmtTime(s: number) {
  const t = Math.round(s);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  if (h) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

type Effort = {
  date: string;
  duration_seconds: number;
  activity_id: string;
  activity_name: string | null;
  is_pr: boolean;
};

export default function PerformanceTrendPage() {
  const [distance, setDistance] = useState("5K");

  const { data } = useQuery<{ distance_label: string; efforts: Effort[]; targets: string[] }>({
    queryKey: ["performance-trend", distance],
    queryFn: () =>
      fetch(`${BASE}/stats/performance-trend?distance_label=${encodeURIComponent(distance)}`).then((r) => r.json()),
  });

  const efforts = data?.efforts ?? [];

  const chartData = efforts.map((e, i) => ({
    x: i,
    y: Math.round(e.duration_seconds),
    date: e.date,
    name: e.activity_name ?? "Run",
    is_pr: e.is_pr,
    label: fmtTime(e.duration_seconds),
  }));

  const prEfforts = chartData.filter((d) => d.is_pr);
  const nonPrEfforts = chartData.filter((d) => !d.is_pr);

  const best = efforts.length > 0 ? Math.min(...efforts.map((e) => e.duration_seconds)) : null;

  return (
    <main className="max-w-2xl mx-auto px-4 pb-20 pt-8">
      <div className="mb-6">
        <Link href="/stats" className="text-xs text-[#71717A] hover:text-[#A1A1AA] uppercase tracking-widest inline-block mb-2">
          ← Stats
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Performance Trend</h1>
        <p className="text-sm text-[#71717A] mt-0.5">Are you getting faster over time?</p>
      </div>

      {/* Distance selector */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {DISTANCES.map((d) => (
          <button
            key={d}
            onClick={() => setDistance(d)}
            className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
              distance === d
                ? "bg-[#F59E0B] text-black border-[#F59E0B] font-medium"
                : "bg-transparent text-[#71717A] border-[#27272A] hover:border-[#3F3F46]"
            }`}
          >
            {d}
          </button>
        ))}
      </div>

      {/* PR callout */}
      {best !== null && (
        <div className="bg-[#0D0D0F] border border-[#F59E0B]/30 rounded-xl px-4 py-3 mb-6 flex items-center justify-between">
          <div>
            <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">All-time PR · {distance}</p>
            <p className="text-2xl font-semibold tabular-nums text-[#F59E0B]">{fmtTime(best)}</p>
          </div>
          <span className="text-3xl">🏆</span>
        </div>
      )}

      {efforts.length === 0 ? (
        <div className="text-center py-16 text-[#52525B] text-sm">
          No efforts found for {distance} — compute best efforts first.
        </div>
      ) : (
        <>
          {/* Scatter chart */}
          <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 pt-4 pb-2 mb-6">
            <p className="text-xs text-[#52525B] uppercase tracking-widest mb-3">All efforts — lower is faster</p>
            <ResponsiveContainer width="100%" height={180}>
              <ScatterChart margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#18181B" />
                <XAxis
                  dataKey="x"
                  type="number"
                  tick={false}
                  axisLine={false}
                  tickLine={false}
                  label={{ value: "effort #", position: "insideBottom", fill: "#52525B", fontSize: 10, offset: -2 }}
                />
                <YAxis
                  dataKey="y"
                  type="number"
                  tickFormatter={(v) => fmtTime(v)}
                  tick={{ fill: "#52525B", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  reversed
                />
                <Tooltip
                  {...TOOLTIP}
                  cursor={{ strokeDasharray: "3 3" }}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  content={(props: any) => {
                    const payload = props?.payload;
                    if (!payload?.length) return null;
                    const d = payload[0].payload as { date: string; label: string; name: string; is_pr: boolean };
                    return (
                      <div className="bg-[#09090B] border border-[#27272A] rounded-lg px-3 py-2 text-xs">
                        <p className="text-[#A1A1AA]">{format(new Date(d.date), "d MMM yyyy")}</p>
                        <p className="text-[#FAFAFA] font-semibold">{d.label}</p>
                        <p className="text-[#71717A]">{d.name}</p>
                        {d.is_pr && <p className="text-[#F59E0B] font-medium mt-1">PR at the time</p>}
                      </div>
                    );
                  }}
                />
                <Scatter data={nonPrEfforts} fill="#27272A" stroke="#3F3F46" r={4} />
                <Scatter data={prEfforts} fill="#F59E0B" stroke="#D97706" r={5} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>

          {/* List */}
          <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl divide-y divide-[#18181B]">
            {[...efforts].reverse().slice(0, 20).map((e) => (
              <div key={`${e.date}-${e.duration_seconds}`} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-xs text-[#52525B]">{format(new Date(e.date), "d MMM yyyy")}</p>
                  {e.activity_name && <p className="text-xs text-[#71717A]">{e.activity_name}</p>}
                </div>
                <div className="flex items-center gap-2">
                  {e.is_pr && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400 font-medium">PR</span>
                  )}
                  <span className="text-sm font-semibold tabular-nums text-[#FAFAFA]">{fmtTime(e.duration_seconds)}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
