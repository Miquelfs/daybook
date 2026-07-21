"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";

type WeightEntry = { date: string; weight_kg: number; note: string | null };
type WeightData = {
  entries: WeightEntry[];
  stats: { latest: number; latest_date: string; change: number | null; min: number; max: number; count: number } | null;
};

const TODAY = new Date().toISOString().slice(0, 10);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function WeightTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-xs shadow-lg">
      <p className="text-[#71717A] mb-1">{d.date}</p>
      <p className="text-[#FAFAFA] font-semibold">{d.weight_kg} kg</p>
    </div>
  );
}

export function WeightSection() {
  const qc = useQueryClient();
  const [dateVal, setDateVal] = useState(TODAY);
  const [weightVal, setWeightVal] = useState("");

  const { data } = useQuery<WeightData>({
    queryKey: ["weight"],
    queryFn: () => fetch("/api/health/weight?days=730").then((r) => r.json()),
  });

  const add = useMutation({
    mutationFn: (body: { date: string; weight_kg: number }) =>
      fetch("/api/health/weight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["weight"] });
      setWeightVal("");
    },
  });

  const entries = data?.entries ?? [];
  const stats = data?.stats;

  function submit() {
    const w = parseFloat(weightVal);
    if (!w || w <= 0) return;
    add.mutate({ date: dateVal, weight_kg: Math.round(w * 10) / 10 });
  }

  return (
    <section className="mb-8">
      <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Weight</h2>

      <div className="flex gap-2 mb-4">
        <input
          type="date"
          value={dateVal}
          onChange={(e) => setDateVal(e.target.value)}
          className="bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B] transition-colors"
        />
        <input
          type="number"
          inputMode="decimal"
          step="0.1"
          placeholder="kg"
          value={weightVal}
          onChange={(e) => setWeightVal(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          className="w-24 bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder:text-[#3F3F46] outline-none focus:border-[#F59E0B] transition-colors"
        />
        <button
          onClick={submit}
          disabled={add.isPending || !weightVal}
          className="px-4 py-2 rounded-lg bg-[#F59E0B] text-[#18181B] text-sm font-medium hover:bg-[#FBBF24] transition-colors disabled:opacity-40"
        >
          {add.isPending ? "…" : "Log"}
        </button>
      </div>

      {stats ? (
        <>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3">
              <p className="text-[10px] text-[#52525B] uppercase tracking-widest mb-1">Latest</p>
              <p className="text-2xl font-semibold tabular-nums text-[#FAFAFA]">
                {stats.latest}<span className="text-sm text-[#71717A] ml-1">kg</span>
              </p>
            </div>
            <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3">
              <p className="text-[10px] text-[#52525B] uppercase tracking-widest mb-1">Change</p>
              <p className="text-2xl font-semibold tabular-nums text-[#A1A1AA]">
                {stats.change != null ? `${stats.change > 0 ? "+" : ""}${stats.change}` : "—"}
                <span className="text-sm text-[#71717A] ml-1">kg</span>
              </p>
            </div>
            <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3">
              <p className="text-[10px] text-[#52525B] uppercase tracking-widest mb-1">Range</p>
              <p className="text-2xl font-semibold tabular-nums text-[#A1A1AA]">{stats.min}–{stats.max}</p>
            </div>
          </div>

          {entries.length > 1 && (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={entries} margin={{ top: 5, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid vertical={false} stroke="#27272A" strokeDasharray="3 3" />
                <XAxis dataKey="date" tickFormatter={(v) => v.slice(5)} tick={{ fill: "#52525B", fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={30} />
                <YAxis domain={["dataMin - 1", "dataMax + 1"]} tick={{ fill: "#52525B", fontSize: 10 }} tickLine={false} axisLine={false} width={36} tickFormatter={(v) => String(Math.round(v))} />
                <Tooltip content={<WeightTooltip />} />
                <Line type="monotone" dataKey="weight_kg" stroke="#F59E0B" strokeWidth={2} dot={{ r: 2, fill: "#F59E0B" }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </>
      ) : (
        <p className="text-sm text-[#52525B]">No weigh-ins yet — log your first above.</p>
      )}
    </section>
  );
}
