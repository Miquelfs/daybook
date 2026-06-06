"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine,
} from "recharts";
import { format } from "date-fns";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Point = {
  date: string;
  pace_sec_km: number;
  hrv: number | null;
  sleep_score: number | null;
  sleep_seconds: number | null;
  distance_km: number;
};

type CorrelationData = {
  points: Point[];
  correlation: { hrv_vs_pace: number | null; sleep_vs_pace: number | null };
  sample_size: number;
};

function fmtPace(secKm: number) {
  const m = Math.floor(secKm / 60);
  const s = Math.round(secKm % 60);
  return `${m}:${String(s).padStart(2, "0")} /km`;
}

function rBadge(r: number | null) {
  if (r === null) return { label: "—", color: "text-[#52525B]", desc: "Not enough data" };
  const abs = Math.abs(r);
  const dir = r < 0 ? "↑ better HRV → faster" : "inverse";
  if (abs >= 0.5) return { label: r.toFixed(2), color: "text-emerald-400", desc: dir };
  if (abs >= 0.3) return { label: r.toFixed(2), color: "text-amber-400", desc: "moderate correlation" };
  return { label: r.toFixed(2), color: "text-[#71717A]", desc: "weak / no correlation" };
}

const TOOLTIP = {
  contentStyle: { background: "#09090B", border: "1px solid #27272A", borderRadius: 8, fontSize: 12 },
  labelStyle: { color: "#A1A1AA" },
  itemStyle: { color: "#FAFAFA" },
};

export default function CorrelationPage() {
  const { data } = useQuery<CorrelationData>({
    queryKey: ["health-correlation"],
    queryFn: () => fetch(`${BASE}/health/correlation?days=90`).then((r) => r.json()),
  });

  const points = data?.points ?? [];
  const corr = data?.correlation ?? { hrv_vs_pace: null, sleep_vs_pace: null };

  const hrvPoints = points.filter((p) => p.hrv !== null).map((p) => ({ x: p.hrv!, y: p.pace_sec_km, date: p.date, dist: p.distance_km }));
  const sleepPoints = points.filter((p) => p.sleep_score !== null).map((p) => ({ x: p.sleep_score!, y: p.pace_sec_km, date: p.date, dist: p.distance_km }));

  const hrvR = rBadge(corr.hrv_vs_pace);
  const sleepR = rBadge(corr.sleep_vs_pace);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const customTooltip = ({ payload }: any) => {
    if (!payload?.length) return null;
    const d = payload[0].payload as { x: number; y: number; date: string; dist: number };
    return (
      <div className="bg-[#09090B] border border-[#27272A] rounded-lg px-3 py-2 text-xs">
        <p className="text-[#A1A1AA]">{format(new Date(d.date), "d MMM yyyy")}</p>
        <p className="text-[#FAFAFA]">{fmtPace(d.y)} · {d.dist} km</p>
        <p className="text-[#71717A]">Value: {d.x}</p>
      </div>
    );
  };

  return (
    <main className="max-w-2xl mx-auto px-4 pb-20 pt-8">
      <div className="mb-6">
        <Link href="/health" className="text-xs text-[#71717A] hover:text-[#A1A1AA] uppercase tracking-widest inline-block mb-2">
          ← Health
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Recovery & Performance</h1>
        <p className="text-sm text-[#71717A] mt-0.5">Does sleep and HRV predict how fast you run?</p>
        {data && <p className="text-xs text-[#52525B] mt-1">{data.sample_size} runs · last 90 days</p>}
      </div>

      {/* Correlation badges */}
      <div className="grid grid-cols-2 gap-3 mb-8">
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-4">
          <p className="text-xs text-[#52525B] uppercase tracking-widest mb-2">HRV vs Pace</p>
          <p className={`text-2xl font-semibold tabular-nums ${hrvR.color}`}>{hrvR.label}</p>
          <p className="text-xs text-[#71717A] mt-1">Pearson r</p>
          <p className="text-xs text-[#52525B] mt-0.5">{hrvR.desc}</p>
        </div>
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-4">
          <p className="text-xs text-[#52525B] uppercase tracking-widest mb-2">Sleep Score vs Pace</p>
          <p className={`text-2xl font-semibold tabular-nums ${sleepR.color}`}>{sleepR.label}</p>
          <p className="text-xs text-[#71717A] mt-1">Pearson r</p>
          <p className="text-xs text-[#52525B] mt-0.5">{sleepR.desc}</p>
        </div>
      </div>

      {/* HRV scatter */}
      {hrvPoints.length >= 3 && (
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 pt-4 pb-2 mb-4">
          <p className="text-xs text-[#52525B] uppercase tracking-widest mb-3">HRV → Pace</p>
          <p className="text-xs text-[#71717A] mb-3">Higher HRV should mean faster pace (lower value = faster)</p>
          <ResponsiveContainer width="100%" height={180}>
            <ScatterChart margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#18181B" />
              <XAxis dataKey="x" type="number" name="HRV" tick={{ fill: "#52525B", fontSize: 10 }} axisLine={false} tickLine={false} label={{ value: "HRV (ms)", position: "insideBottom", fill: "#52525B", fontSize: 10, offset: -2 }} />
              <YAxis dataKey="y" type="number" name="Pace" tickFormatter={(v) => fmtPace(v)} tick={{ fill: "#52525B", fontSize: 10 }} axisLine={false} tickLine={false} reversed />
              <Tooltip content={customTooltip} cursor={{ strokeDasharray: "3 3" }} />
              <Scatter data={hrvPoints} fill="#60A5FA" stroke="#3B82F6" r={4} />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Sleep scatter */}
      {sleepPoints.length >= 3 && (
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 pt-4 pb-2 mb-4">
          <p className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Sleep Score → Pace</p>
          <p className="text-xs text-[#71717A] mb-3">Better sleep should mean faster pace (lower = faster)</p>
          <ResponsiveContainer width="100%" height={180}>
            <ScatterChart margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#18181B" />
              <XAxis dataKey="x" type="number" name="Sleep Score" tick={{ fill: "#52525B", fontSize: 10 }} axisLine={false} tickLine={false} label={{ value: "Sleep score", position: "insideBottom", fill: "#52525B", fontSize: 10, offset: -2 }} />
              <YAxis dataKey="y" type="number" name="Pace" tickFormatter={(v) => fmtPace(v)} tick={{ fill: "#52525B", fontSize: 10 }} axisLine={false} tickLine={false} reversed />
              <Tooltip content={customTooltip} cursor={{ strokeDasharray: "3 3" }} />
              <Scatter data={sleepPoints} fill="#A78BFA" stroke="#7C3AED" r={4} />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}

      {points.length < 3 && (
        <div className="text-center py-12 text-[#52525B] text-sm">
          Not enough data — need at least 3 runs with HRV or sleep logged the same day.
        </div>
      )}
    </main>
  );
}
