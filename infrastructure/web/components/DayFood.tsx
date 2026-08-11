"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, ChevronDown, Utensils, ArrowUpRight, CalendarPlus, Check } from "lucide-react";
import { foodApi, type FoodEntry, type FoodSummary } from "@/lib/food-api";
import { groupByMeal } from "@/lib/food-meals";
import { SectionLabel } from "@/components/MorningBrief";
import { WaterTracker } from "@/components/WaterTracker";
import { HeartHealthyPick } from "@/components/HeartHealthyPick";
import { HeartDot } from "@/components/HeartRatingBadge";

const TODAY = new Date().toISOString().slice(0, 10);

// The day's food log — a collapsible summary card + always-visible water nudge.
// Collapsed by default; expand to see and delete individual entries.
export function DayFood({ date }: { date: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);

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

  // Re-log a past meal into today with one tap (macros + heart rating carry over).
  async function copyToToday(e: FoodEntry) {
    await foodApi.create({
      date: TODAY,
      description: e.description,
      meal_type: e.meal_type ?? undefined,
      source: e.source,
      kcal: e.kcal, protein_g: e.protein_g, carbs_g: e.carbs_g, fat_g: e.fat_g, sugar_g: e.sugar_g,
      saturated_fat_g: e.saturated_fat_g, fiber_g: e.fiber_g,
      heart_rating: e.heart_rating, heart_note: e.heart_note,
    });
    qc.invalidateQueries({ queryKey: ["day-food", TODAY] });
    qc.invalidateQueries({ queryKey: ["food-summary", TODAY] });
    qc.invalidateQueries({ queryKey: ["food-recent"] });
    setCopiedId(e.id);
    setTimeout(() => setCopiedId((c) => (c === e.id ? null : c)), 1500);
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
        <Link href="/food" className="flex items-center gap-0.5 text-xs text-[#71717A] hover:text-[#F59E0B] uppercase tracking-widest transition-colors">
          Open <ArrowUpRight size={12} />
        </Link>
      </div>

      {/* Heart-healthy meal of the day — only forward-looking (today) */}
      {date === TODAY && (
        <div className="mb-2">
          <HeartHealthyPick date={date} />
        </div>
      )}

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

        {/* Expanded: entries grouped by meal + burn/net */}
        {open && entries.length > 0 && (
          <div className="px-4 pb-3 pt-1 border-t border-[#18181B] space-y-3">
            {groupByMeal(entries).map((g) => (
              <div key={g.key} className="space-y-1.5">
                <p className="text-[10px] text-[#52525B] uppercase tracking-widest">{g.emoji} {g.label}</p>
                {g.items.map((e) => (
                  <div key={e.id} className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[#FAFAFA] truncate flex items-center gap-1.5">
                        {e.heart_rating && <HeartDot rating={e.heart_rating} title={e.heart_note ?? undefined} />}
                        {e.description}
                      </p>
                      <p className="text-xs text-[#52525B] tabular-nums">
                        {Math.round(e.kcal)} kcal · {Math.round(e.protein_g)}P / {Math.round(e.carbs_g)}C / {Math.round(e.fat_g)}F
                        {e.fiber_g != null && e.fiber_g > 0 && ` · ${Math.round(e.fiber_g)}g fibre`}
                        {e.saturated_fat_g != null && e.saturated_fat_g > 0 && ` · ${Math.round(e.saturated_fat_g)}g sat fat`}
                      </p>
                      {e.heart_rating && e.heart_rating !== "ok" && e.heart_note && (
                        <p className="text-[11px] text-[#71717A] mt-0.5">{e.heart_note}</p>
                      )}
                    </div>
                    {date !== TODAY && (
                      <button onClick={() => copyToToday(e)} title="Add to today"
                        className="p-1.5 rounded-lg hover:bg-[#27272A] shrink-0">
                        {copiedId === e.id
                          ? <Check size={14} className="text-[#34D399]" />
                          : <CalendarPlus size={14} className="text-[#52525B]" />}
                      </button>
                    )}
                    <button onClick={() => del(e.id)} className="p-1.5 rounded-lg hover:bg-[#27272A] shrink-0">
                      <Trash2 size={14} className="text-[#52525B]" />
                    </button>
                  </div>
                ))}
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
