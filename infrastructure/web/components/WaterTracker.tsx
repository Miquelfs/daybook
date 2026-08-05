"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Droplet, Plus, Minus } from "lucide-react";
import { foodApi, type WaterState } from "@/lib/food-api";

const BLUE = "#38BDF8";

// Hydration tracker. `compact` renders a slim inline version for the day view;
// the full version is a card for the Food dashboard.
export function WaterTracker({ date, compact = false }: { date: string; compact?: boolean }) {
  const qc = useQueryClient();
  const { data } = useQuery<WaterState>({
    queryKey: ["food-water", date],
    queryFn: () => foodApi.water(date),
    staleTime: 0,
  });

  const ml = data?.ml ?? 0;
  const goal = data?.goal_ml ?? 3000;
  const pct = goal > 0 ? Math.min(100, (ml / goal) * 100) : 0;
  const litres = (ml / 1000).toFixed(ml % 1000 === 0 ? 0 : 1);
  const goalL = (goal / 1000).toFixed(goal % 1000 === 0 ? 0 : 1);

  async function add(delta: number) {
    await foodApi.addWater(date, delta);
    qc.invalidateQueries({ queryKey: ["food-water", date] });
    qc.invalidateQueries({ queryKey: ["food-summary", date] });
  }

  const bar = (
    <div className="h-2 rounded-full bg-[#18181B] overflow-hidden">
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: BLUE }} />
    </div>
  );

  const addBtn = (label: string, delta: number) => (
    <button
      onClick={() => add(delta)}
      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-[#0EA5E9]/10 text-[#38BDF8] hover:bg-[#0EA5E9]/20 transition-colors whitespace-nowrap"
    >
      <Plus size={12} /> {label}
    </button>
  );

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <Droplet size={14} className="text-[#38BDF8] shrink-0" />
        <div className="flex-1 min-w-0">{bar}</div>
        <span className="text-xs tabular-nums text-[#A1A1AA] shrink-0">{litres}/{goalL}L</span>
        <div className="flex gap-1 shrink-0">
          {addBtn("250", 250)}
          {addBtn("500", 500)}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#0D0D0F] border border-[#27272A] rounded-2xl p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-[#52525B] uppercase tracking-widest flex items-center gap-1.5">
          <Droplet size={13} className="text-[#38BDF8]" /> Water
        </span>
        <span className="text-sm tabular-nums text-[#FAFAFA]">
          {litres}<span className="text-[#52525B]"> / {goalL} L</span>
        </span>
      </div>
      {bar}
      <div className="flex items-center gap-2">
        {addBtn("250 ml", 250)}
        {addBtn("500 ml", 500)}
        {addBtn("1 L", 1000)}
        {ml > 0 && (
          <button
            onClick={() => add(-250)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-[#18181B] text-[#71717A] hover:text-[#A1A1AA] transition-colors ml-auto"
          >
            <Minus size={12} /> 250
          </button>
        )}
      </div>
    </div>
  );
}
