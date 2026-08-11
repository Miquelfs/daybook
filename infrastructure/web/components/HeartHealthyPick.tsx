"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { HeartPulse, ChevronDown } from "lucide-react";
import { foodApi, type HeartSuggestion } from "@/lib/food-api";

const MEAL_EMOJI: Record<string, string> = {
  breakfast: "🥣", lunch: "🥗", dinner: "🍽", snack: "🍎",
};

// Cholesterol-friendly "meal of the day" for the food section: low saturated
// fat, low processed, high soluble fibre. Curated + deterministic, so it always
// shows (no AI dependency). General guidance, not medical advice.
export function HeartHealthyPick({ date }: { date: string }) {
  const [open, setOpen] = useState(false);
  const { data } = useQuery<HeartSuggestion>({
    queryKey: ["heart-suggestion", date],
    queryFn: () => foodApi.heartSuggestion(date),
    staleTime: 60 * 60 * 1000,
  });

  if (!data) return null;
  const hero = data.hero;

  return (
    <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl overflow-hidden">
      <button onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-[#111113] transition-colors">
        <HeartPulse size={15} className="text-[#F87171] shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-widest text-[#F87171]">Heart-healthy pick</p>
          <p className="text-sm font-medium text-[#FAFAFA] truncate">
            {MEAL_EMOJI[hero.meal_type] ?? "🍽"} {hero.name}
          </p>
          <p className="text-xs text-[#52525B] tabular-nums">
            ~{hero.kcal} kcal · {hero.fibre_g}g fibre · {hero.meal_type}
          </p>
        </div>
        <ChevronDown size={16} className={`text-[#52525B] shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="px-4 pb-3 pt-1 border-t border-[#18181B] space-y-3">
          <p className="text-xs text-[#A1A1AA] leading-relaxed">{hero.why}</p>

          <div>
            <p className="text-[10px] uppercase tracking-widest text-[#52525B] mb-1.5">
              A heart-healthy day · ~{data.total_fibre_g}g fibre
            </p>
            <div className="flex flex-col gap-1.5">
              {data.plate.map((m) => (
                <div key={m.meal_type} className="flex items-baseline gap-2">
                  <span className="text-sm shrink-0">{MEAL_EMOJI[m.meal_type] ?? "🍽"}</span>
                  <span className="text-xs text-[#A1A1AA] flex-1 min-w-0">{m.name}</span>
                  <span className="text-[11px] text-[#52525B] tabular-nums shrink-0">{m.kcal} kcal</span>
                </div>
              ))}
            </div>
          </div>

          <p className="text-xs text-[#71717A] leading-relaxed border-l-2 border-[#F87171]/30 pl-2.5">
            💡 {data.tip}
          </p>
          <p className="text-[10px] text-[#3F3F46]">General dietary guidance, not medical advice.</p>
        </div>
      )}
    </div>
  );
}
