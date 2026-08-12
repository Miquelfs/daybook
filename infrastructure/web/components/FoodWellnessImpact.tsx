"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, ChevronDown, ArrowRight } from "lucide-react";
import { foodApi, type FoodWellnessImpact as Impact, type WellnessEffect } from "@/lib/food-api";

const LEVER_EMOJI: Record<string, string> = {
  sugar: "🍬", sat_fat: "🧈", fibre: "🌾", big_meal: "🍽", late: "🌙", indulgent: "⚠️",
};

function unitLabel(unit: string, v: number): string {
  if (unit === "%") return `${Math.round(v * 100)}%`;
  if (unit === "h") return `${Math.round(v)}:00`;
  return `${Math.round(v)}${unit}`;
}

// One wellness outcome under a lever: how the low→high shift moves it.
function EffectRow({ e }: { e: WellnessEffect }) {
  const sign = e.delta > 0 ? "+" : "";
  const color = e.good ? "text-[#34D399]" : "text-[#F87171]";
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-[#A1A1AA] flex-1 min-w-0 truncate">{e.label}</span>
      <span className="tabular-nums text-[#52525B]">{e.low_avg}</span>
      <ArrowRight size={11} className="text-[#3F3F46] shrink-0" />
      <span className="tabular-nums text-[#D4D4D8]">{e.high_avg}</span>
      <span className={`tabular-nums font-semibold w-12 text-right ${color}`}>
        {sign}{e.delta}
      </span>
    </div>
  );
}

// "How does eating this way change my energy, mood and stress?" — derived from
// days you already log (food macros/ratings × subjective energy/mood/stress).
export function FoodWellnessImpact({ date }: { date: string }) {
  const [open, setOpen] = useState(false);
  const { data } = useQuery<Impact>({
    queryKey: ["food-wellness-impact", date],
    queryFn: () => foodApi.wellnessImpact(date, 120),
    staleTime: 60 * 60 * 1000,
  });

  if (!data) return null;

  if (!data.enough) {
    return (
      <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3">
        <p className="text-[10px] uppercase tracking-widest text-[#8B5CF6] flex items-center gap-1.5">
          <Activity size={13} /> Food × how you feel
        </p>
        <p className="text-xs text-[#71717A] mt-1.5">
          Keep logging meals and your daily mood/energy — once there are enough days I&apos;ll
          show which foods lift or drain you.
        </p>
      </div>
    );
  }

  const h = data.headline!;

  return (
    <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl overflow-hidden">
      <button onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-[#111113] transition-colors">
        <Activity size={15} className="text-[#8B5CF6] shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-widest text-[#8B5CF6]">Food × how you feel</p>
          <p className="text-sm font-medium text-[#FAFAFA]">
            More <span className="text-[#C4B5FD]">{h.lever}</span> {h.verb} your{" "}
            <span className="text-[#C4B5FD]">{h.outcome}</span>
            <span className={`ml-1 tabular-nums ${h.good ? "text-[#34D399]" : "text-[#F87171]"}`}>
              ({h.verb === "raises" ? "+" : "−"}{h.delta})
            </span>
          </p>
          <p className="text-xs text-[#52525B]">from {data.days_analyzed} logged days · last {data.window_days}d</p>
        </div>
        <ChevronDown size={16} className={`text-[#52525B] shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="px-4 pb-3 pt-1 border-t border-[#18181B] space-y-3.5">
          <p className="text-[10px] text-[#52525B]">
            Your higher-vs-lower days for each lever, and how that moved each measure (avg, 1–10).
          </p>
          {data.levers.map((l) => (
            <div key={l.key}>
              <div className="flex items-baseline justify-between mb-1.5">
                <span className="text-xs font-medium text-[#E4E4E7]">
                  {LEVER_EMOJI[l.key] ?? "•"} High-{l.label} days
                </span>
                <span className="text-[10px] text-[#3F3F46] tabular-nums">
                  &gt; {unitLabel(l.unit, l.threshold)} · {l.days} days
                </span>
              </div>
              <div className="space-y-1 pl-0.5">
                {l.effects.map((e) => <EffectRow key={e.outcome} e={e} />)}
              </div>
            </div>
          ))}
          <p className="text-[10px] text-[#3F3F46] pt-1 border-t border-[#18181B]">
            Patterns in your own data — associations, not proof of cause.
          </p>
        </div>
      )}
    </div>
  );
}
