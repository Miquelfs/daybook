"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, ChevronDown, Utensils } from "lucide-react";
import { foodApi, type FoodEntry, type FoodSummary } from "@/lib/food-api";
import { SectionLabel } from "@/components/MorningBrief";
import { WaterTracker } from "@/components/WaterTracker";

const TODAY = new Date().toISOString().slice(0, 10);

// The day's food log — a collapsible summary card + always-visible water nudge.
// Collapsed by default; expand to see and delete individual entries.
export function DayFood({ date }: { date: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: entries = [] } = useQuery<FoodEntry[]>({
    queryKey: ["day-food", date],
    queryFn: () => foodApi.listEntries({ date }),
    staleTime: 0,
    retry: 2,
  });

  const { data: summary } = useQuery<FoodSummary>({
    queryKey: ["food-summary", date],
    queryFn: () => foodApi.summary(date),
    staleTime: 0,
    retry: 1,
  });

  const hasWater = (summary?.water_ml ?? 0) > 0;
  // Keep the day view clean historically: only show for days with data, or today
  // (so today always gets a hydration + intake nudge).
  if (entries.length === 0 && !hasWater && date !== TODAY) return null;

  async function del(id: number) {
    await foodApi.delete(id);
    qc.invalidateQueries({ queryKey: ["day-food", date] });
    qc.invalidateQueries({ queryKey: ["food-summary", date] });
  }

  const eaten = summary?.consumed_kcal ?? 0;
  const target = summary?.target_kcal ?? null;
  const protein = summary?.consumed_protein_g ?? 0;
  const over = target != null && eaten > target;
  const pct = target && target > 0 ? Math.min(100, (eaten / target) * 100) : 0;

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <SectionLabel>Food &amp; water</SectionLabel>
      </div>

      <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl overflow-hidden">
        {/* Collapsible summary header */}
        <button
          onClick={() => setOpen((v) => !v)}
          className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-[#111113] transition-colors"
        >
          <Utensils size={15} className="text-[#52525B] shrink-0" />
          <div className="flex-1 min-w-0">
            {entries.length > 0 ? (
              <>
                <div className="flex items-baseline gap-2">
                  <span className={`text-sm font-semibold tabular-nums ${over ? "text-[#F87171]" : "text-[#FAFAFA]"}`}>
                    {Math.round(eaten)}
                    {target != null && <span className="text-[#52525B] font-normal"> / {Math.round(target)} kcal</span>}
                  </span>
                  <span className="text-xs text-[#52525B] tabular-nums">· {Math.round(protein)}g P · {entries.length} item{entries.length !== 1 ? "s" : ""}</span>
                </div>
                {target != null && (
                  <div className="h-1 rounded-full bg-[#18181B] overflow-hidden mt-1.5">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: over ? "#F87171" : "#F59E0B" }} />
                  </div>
                )}
              </>
            ) : (
              <span className="text-sm text-[#52525B]">No food logged{date === TODAY ? " yet today" : ""}</span>
            )}
          </div>
          <ChevronDown size={16} className={`text-[#52525B] shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>

        {/* Water — always visible (the whole point is to notice it) */}
        <div className="px-4 py-3 border-t border-[#18181B]">
          <WaterTracker date={date} compact />
        </div>

        {/* Expanded: entries + burn/net */}
        {open && entries.length > 0 && (
          <div className="px-4 pb-3 pt-1 border-t border-[#18181B] space-y-2">
            {entries.map((e) => (
              <div key={e.id} className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[#FAFAFA] truncate">{e.description}</p>
                  <p className="text-xs text-[#52525B] tabular-nums">
                    {Math.round(e.kcal)} kcal · {Math.round(e.protein_g)}P / {Math.round(e.carbs_g)}C / {Math.round(e.fat_g)}F
                    {e.sugar_g > 0 && ` · ${Math.round(e.sugar_g)}g sugar`}
                    {e.meal_type && <span className="text-[#3F3F46]"> · {e.meal_type}</span>}
                  </p>
                </div>
                <button onClick={() => del(e.id)} className="p-1.5 rounded-lg hover:bg-[#27272A] shrink-0">
                  <Trash2 size={14} className="text-[#52525B]" />
                </button>
              </div>
            ))}
            {summary?.net_vs_burn_kcal != null && (
              <p className="text-xs text-[#52525B] tabular-nums pt-1 border-t border-[#18181B]">
                Burned {Math.round(summary.burned_total_kcal ?? 0)} ·{" "}
                <span className={summary.net_vs_burn_kcal <= 0 ? "text-[#34D399]" : "text-[#F87171]"}>
                  net {summary.net_vs_burn_kcal > 0 ? "+" : ""}{Math.round(summary.net_vs_burn_kcal)} kcal
                </span>
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
