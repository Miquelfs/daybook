"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine, Legend,
} from "recharts";
import { format, parseISO } from "date-fns";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const TOOLTIP = {
  contentStyle: { background: "#09090B", border: "1px solid #27272A", borderRadius: 8, fontSize: 12 },
  labelStyle: { color: "#A1A1AA" },
  itemStyle: { color: "#FAFAFA" },
};

type FitnessDay = {
  date: string;
  ctl: number;
  atl: number;
  tsb: number;
  tss: number;
};

export default function FitnessCurvePage() {
  const { data } = useQuery<{ days: FitnessDay[] }>({
    queryKey: ["fitness-curve"],
    queryFn: () => fetch(`${BASE}/stats/fitness-curve?days=180`).then((r) => r.json()),
  });

  const days = data?.days ?? [];
  const latest = days[days.length - 1];

  const tsbColor = (tsb: number) => {
    if (tsb > 10) return "text-emerald-400";
    if (tsb < -20) return "text-red-400";
    return "text-amber-400";
  };

  const tsbStatus = (tsb: number) => {
    if (tsb > 25) return "Peaked / Taper";
    if (tsb > 10) return "Fresh";
    if (tsb > -10) return "Optimal";
    if (tsb > -20) return "Productive";
    return "Overreaching";
  };

  return (
    <main className="max-w-2xl mx-auto px-4 pb-20 pt-8">
      <div className="mb-6">
        <Link href="/stats" className="text-xs text-[#71717A] hover:text-[#A1A1AA] uppercase tracking-widest inline-block mb-2">
          ← Stats
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Fitness Curve</h1>
        <p className="text-sm text-[#71717A] mt-0.5">CTL · ATL · TSB — last 180 days</p>
      </div>

      {/* Current state callout */}
      {latest && (
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-4 mb-6">
          <p className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Today</p>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-[#52525B] mb-1">Fitness (CTL)</p>
              <p className="text-xl font-semibold tabular-nums text-amber-400">{latest.ctl}</p>
            </div>
            <div>
              <p className="text-xs text-[#52525B] mb-1">Fatigue (ATL)</p>
              <p className="text-xl font-semibold tabular-nums text-red-400">{latest.atl}</p>
            </div>
            <div>
              <p className="text-xs text-[#52525B] mb-1">Form (TSB)</p>
              <p className={`text-xl font-semibold tabular-nums ${tsbColor(latest.tsb)}`}>
                {latest.tsb > 0 ? "+" : ""}{latest.tsb}
              </p>
            </div>
          </div>
          <p className={`text-sm mt-3 font-medium ${tsbColor(latest.tsb)}`}>{tsbStatus(latest.tsb)}</p>
        </div>
      )}

      {/* Chart */}
      {days.length > 0 && (
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 pt-4 pb-2 mb-4">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={days} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#18181B" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fill: "#52525B", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(d) => format(parseISO(d), "d MMM")}
                interval={29}
              />
              <YAxis tick={{ fill: "#52525B", fontSize: 11 }} axisLine={false} tickLine={false} />
              <ReferenceLine y={0} stroke="#3F3F46" strokeDasharray="4 2" />
              <Tooltip
                {...TOOLTIP}
                labelFormatter={(d) => format(parseISO(String(d)), "d MMM yyyy")}
              />
              <Legend
                wrapperStyle={{ fontSize: 11, color: "#71717A", paddingTop: 8 }}
                formatter={(value) => value.toUpperCase()}
              />
              <Line type="monotone" dataKey="ctl" stroke="#F59E0B" dot={false} strokeWidth={2} name="CTL" />
              <Line type="monotone" dataKey="atl" stroke="#EF4444" dot={false} strokeWidth={1.5} name="ATL" />
              <Line type="monotone" dataKey="tsb" stroke="#60A5FA" dot={false} strokeWidth={1.5} name="TSB" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="text-xs text-[#52525B] space-y-1 mt-4">
        <p><span className="text-amber-400">CTL</span> (Fitness) — 42-day exponential average of daily training load</p>
        <p><span className="text-red-400">ATL</span> (Fatigue) — 7-day exponential average of daily training load</p>
        <p><span className="text-blue-400">TSB</span> (Form) — CTL minus ATL. Positive = fresh, negative = tired</p>
      </div>
    </main>
  );
}
