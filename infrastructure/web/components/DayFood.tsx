"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { foodApi, type FoodEntry, type FoodSummary } from "@/lib/food-api";
import { SectionLabel } from "@/components/MorningBrief";

// The day's food log + intake-vs-target/burn snapshot. Read-only add happens via
// the day FAB (food mode) and the /food dashboard.
export function DayFood({ date }: { date: string }) {
  const qc = useQueryClient();

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

  if (entries.length === 0) return null;

  async function del(id: number) {
    await foodApi.delete(id);
    qc.invalidateQueries({ queryKey: ["day-food", date] });
    qc.invalidateQueries({ queryKey: ["food-summary", date] });
  }

  const overTarget =
    summary?.target_kcal != null && summary.consumed_kcal > summary.target_kcal;

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <SectionLabel>Food</SectionLabel>
      </div>

      {summary && (
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3 mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm tabular-nums">
          <span className={overTarget ? "text-[#F87171] font-semibold" : "text-[#FAFAFA] font-semibold"}>
            {Math.round(summary.consumed_kcal)}
            {summary.target_kcal != null && (
              <span className="text-[#52525B] font-normal"> / {Math.round(summary.target_kcal)} kcal</span>
            )}
          </span>
          <span className="text-[#A1A1AA]">
            {Math.round(summary.consumed_protein_g)}
            {summary.protein_target_g != null && (
              <span className="text-[#52525B]">/{Math.round(summary.protein_target_g)}</span>
            )}
            <span className="text-[#52525B]"> P</span>
          </span>
          {summary.burned_total_kcal != null && (
            <span className="text-[#52525B]">burned {Math.round(summary.burned_total_kcal)}</span>
          )}
          {summary.net_vs_burn_kcal != null && (
            <span className={summary.net_vs_burn_kcal <= 0 ? "text-[#34D399]" : "text-[#F87171]"}>
              net {summary.net_vs_burn_kcal > 0 ? "+" : ""}{Math.round(summary.net_vs_burn_kcal)}
            </span>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {entries.map((e) => (
          <div
            key={e.id}
            className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3 flex items-center gap-3"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[#FAFAFA] truncate">{e.description}</p>
              <p className="text-xs text-[#52525B] tabular-nums">
                {Math.round(e.kcal)} kcal · {Math.round(e.protein_g)}P / {Math.round(e.carbs_g)}C / {Math.round(e.fat_g)}F
                {e.meal_type && <span className="text-[#3F3F46]"> · {e.meal_type}</span>}
              </p>
            </div>
            <button onClick={() => del(e.id)} className="p-1.5 rounded-lg hover:bg-[#27272A] transition-colors shrink-0">
              <Trash2 size={14} className="text-[#52525B]" />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
