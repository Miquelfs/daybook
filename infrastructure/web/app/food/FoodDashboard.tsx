"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid,
  ComposedChart, Line, Legend,
} from "recharts";
import { format, parseISO, subDays, addDays } from "date-fns";
import { ChevronLeft, ChevronRight, Trash2, Sparkles, AlertTriangle, UtensilsCrossed } from "lucide-react";
import {
  foodApi, type FoodEntry, type FoodSummary, type FoodTargetsResponse, type FoodCoach,
  type DeficitStreak, type Calibration,
} from "@/lib/food-api";
import { groupByMeal } from "@/lib/food-meals";
import { FoodEntryComposer } from "@/components/FoodEntryComposer";
import { WeightSection } from "@/components/health/WeightSection";
import { WaterTracker } from "@/components/WaterTracker";
import { HeartDot, HEART_META } from "@/components/HeartRatingBadge";
import { HeartHealthyPick } from "@/components/HeartHealthyPick";
import { FoodWellnessImpact } from "@/components/FoodWellnessImpact";
import { WeeklyMealPlan } from "@/components/WeeklyMealPlan";

const AMBER = "#F59E0B";
const GREEN = "#34D399";
const RED = "#F87171";
const TEAL = "#22D3EE";

// Weight change is judged against the cut goal: a loss (negative) is on-track
// (green), a gain (positive) is off-track (red), flat is neutral.
function kgColor(kg: number | null | undefined): string {
  if (kg == null || Math.abs(kg) < 0.1) return "#A1A1AA";
  return kg < 0 ? GREEN : RED;
}
function fmtKg(kg: number): string {
  return `${kg > 0 ? "+" : ""}${kg} kg`;
}

function Bar2({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-2 rounded-full bg-[#18181B] overflow-hidden">
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

// In (eaten) vs Out (Garmin burned), with the net deficit/surplus called out.
function EnergyBalance({
  eaten, burned, active, net,
}: {
  eaten: number;
  burned: number | null;
  active: number | null;
  net: number | null;
}) {
  const scale = Math.max(eaten, burned ?? 0, 1);
  const deficit = net != null && net <= 0;
  return (
    <div className="pt-3 border-t border-[#18181B]">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-[#52525B] uppercase tracking-widest">Energy balance</span>
        {net != null ? (
          <span className={`text-sm font-semibold tabular-nums ${deficit ? "text-[#34D399]" : "text-[#F87171]"}`}>
            {Math.abs(Math.round(net))} kcal {deficit ? "deficit" : "surplus"}
          </span>
        ) : (
          <span className="text-xs text-[#3F3F46]">no Garmin burn yet</span>
        )}
      </div>

      <div className="space-y-2">
        <div>
          <div className="flex justify-between text-[11px] mb-0.5">
            <span className="text-[#71717A]">Eaten (in)</span>
            <span className="tabular-nums text-[#A1A1AA]">{Math.round(eaten)}</span>
          </div>
          <Bar2 value={eaten} max={scale} color={AMBER} />
        </div>
        <div>
          <div className="flex justify-between text-[11px] mb-0.5">
            <span className="text-[#71717A]">Burned (out){active != null && <span className="text-[#3F3F46]"> · {Math.round(active)} active</span>}</span>
            <span className="tabular-nums text-[#A1A1AA]">{burned != null ? Math.round(burned) : "—"}</span>
          </div>
          <Bar2 value={burned ?? 0} max={scale} color={TEAL} />
        </div>
      </div>
    </div>
  );
}

export function FoodDashboard() {
  const qc = useQueryClient();
  const today = format(new Date(), "yyyy-MM-dd");
  const params = useSearchParams();
  const initialDate = params.get("date");
  const [date, setDate] = useState(
    initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate) ? initialDate : today
  );
  const [coaching, setCoaching] = useState(false);
  const [coachMeal, setCoachMeal] = useState("");
  const [chartMode, setChartMode] = useState<"target" | "balance">("target");

  const { data: coachResp } = useQuery<{ coach: FoodCoach } | null>({
    queryKey: ["food-coach", date],
    queryFn: async () => {
      try { return await foodApi.coach(date); } catch { return null; }
    },
    staleTime: 0,
  });
  const coach = coachResp?.coach ?? null;

  const { data: targets } = useQuery<FoodTargetsResponse>({
    queryKey: ["food-targets", date],
    queryFn: () => foodApi.targets({ date }),
    staleTime: 30_000,
  });

  const { data: summary } = useQuery<FoodSummary>({
    queryKey: ["food-summary", date],
    queryFn: () => foodApi.summary(date),
    staleTime: 0,
  });

  const { data: entries = [] } = useQuery<FoodEntry[]>({
    queryKey: ["day-food", date],
    queryFn: () => foodApi.listEntries({ date }),
    staleTime: 0,
  });

  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => format(subDays(parseISO(date), 6 - i), "yyyy-MM-dd")),
    [date]
  );

  const { data: week = [] } = useQuery<FoodSummary[]>({
    queryKey: ["food-week", date],
    queryFn: () => Promise.all(weekDates.map((d) => foodApi.summary(d))),
    staleTime: 0,
  });

  const { data: streak } = useQuery<DeficitStreak>({
    queryKey: ["food-streak", date],
    queryFn: () => foodApi.streak(date),
    staleTime: 30_000,
  });

  const { data: calib } = useQuery<Calibration>({
    queryKey: ["food-calibration", date],
    queryFn: () => foodApi.calibration(date, 14),
    staleTime: 60_000,
  });

  const activeTarget = targets?.active;
  const targetKcal = summary?.target_kcal ?? activeTarget?.target_kcal ?? null;
  const proteinTarget = summary?.protein_target_g ?? activeTarget?.protein_g ?? null;

  const chartData = week.map((s) => ({
    label: format(parseISO(s.date), "EEE d"),
    kcal: Math.round(s.consumed_kcal),
    burned: s.burned_total_kcal != null ? Math.round(s.burned_total_kcal) : null,
    over: s.target_kcal != null && s.consumed_kcal > s.target_kcal,
    surplus: s.burned_total_kcal != null && s.consumed_kcal > s.burned_total_kcal,
  }));
  const hasBurn = chartData.some((d) => d.burned != null);

  const waterGoal = week[week.length - 1]?.water_goal_ml ?? 3000;
  const waterWeek = week.map((s) => ({
    label: format(parseISO(s.date), "EEEEE"),
    ml: s.water_ml,
    hit: s.water_goal_ml > 0 && s.water_ml >= s.water_goal_ml,
  }));
  const waterAvg = waterWeek.length
    ? Math.round(waterWeek.reduce((a, d) => a + d.ml, 0) / waterWeek.length)
    : 0;
  const waterDaysHit = waterWeek.filter((d) => d.hit).length;
  // Scale bars against the goal (with headroom) so the goal line sits below the
  // top and days that beat it poke above the dashed target instead of clipping.
  const waterScale = Math.max(waterGoal, ...waterWeek.map((d) => d.ml), 1) * 1.12;
  const waterGoalLinePct = Math.min(100, (waterGoal / waterScale) * 100);

  async function del(id: number) {
    await foodApi.delete(id);
    qc.invalidateQueries({ queryKey: ["day-food", date] });
    qc.invalidateQueries({ queryKey: ["food-summary", date] });
    qc.invalidateQueries({ queryKey: ["food-week"] });
  }

  async function generateCoach() {
    setCoaching(true);
    try {
      await foodApi.generateCoach(date, undefined, coachMeal || undefined);
      qc.invalidateQueries({ queryKey: ["food-coach", date] });
    } catch {
      // leave prior coach output in place
    } finally {
      setCoaching(false);
    }
  }

  const consumed = summary?.consumed_kcal ?? 0;
  const consumedProtein = summary?.consumed_protein_g ?? 0;
  const overTarget = targetKcal != null && consumed > targetKcal;
  const targetIsSuggested = summary?.target_is_suggested ?? false;

  return (
    <div className="space-y-8">
      {/* Header + date nav — matches the other top-level screens */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <Link href="/" className="text-xs text-[#71717A] hover:text-[#A1A1AA] uppercase tracking-widest inline-block">
            ← Today
          </Link>
          <Link
            href="/food/library"
            className="inline-flex items-center gap-1 text-xs font-medium uppercase tracking-widest
                       text-[#34D399] hover:text-[#6EE7B7] bg-[#34D399]/10 hover:bg-[#34D399]/15
                       rounded-full px-2.5 py-1 transition-colors"
          >
            🥗 Foods →
          </Link>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">Food</h1>
              {streak && streak.current > 0 && (
                <span className="text-xs font-semibold text-[#F59E0B] bg-[#F59E0B]/10 rounded-full px-2 py-0.5 tabular-nums">
                  🔥 {streak.current}-day{streak.best > streak.current ? ` · best ${streak.best}` : ""}
                </span>
              )}
            </div>
            <p className="text-xs text-[#52525B] mt-0.5">{format(parseISO(date), "EEEE d MMM yyyy")}</p>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setDate(format(subDays(parseISO(date), 1), "yyyy-MM-dd"))} className="p-2 rounded-lg hover:bg-[#18181B]">
              <ChevronLeft size={16} className="text-[#71717A]" />
            </button>
            {date !== today && (
              <button onClick={() => setDate(today)} className="text-xs text-[#71717A] hover:text-[#A1A1AA] px-2">today</button>
            )}
            <button
              onClick={() => setDate(format(addDays(parseISO(date), 1), "yyyy-MM-dd"))}
              disabled={date >= today}
              className="p-2 rounded-lg hover:bg-[#18181B] disabled:opacity-30"
            >
              <ChevronRight size={16} className="text-[#71717A]" />
            </button>
          </div>
        </div>
      </div>

      {/* Today totals vs target + burn */}
      <div className="bg-[#0D0D0F] border border-[#27272A] rounded-2xl p-4 space-y-4">
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-[#52525B] uppercase tracking-widest">
              Calories
              {targetIsSuggested && targetKcal != null && (
                <span className="ml-1.5 normal-case tracking-normal text-[10px] text-[#3F3F46]">· suggested plan</span>
              )}
            </span>
            <span className={`text-sm tabular-nums ${overTarget ? "text-[#F87171]" : "text-[#FAFAFA]"}`}>
              {Math.round(consumed)}
              {targetKcal != null
                ? <span className="text-[#52525B]"> / {Math.round(targetKcal)}</span>
                : <span className="text-[#3F3F46]"> · no plan set</span>}
            </span>
          </div>
          <Bar2 value={consumed} max={targetKcal ?? 0} color={overTarget ? RED : AMBER} />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-[#52525B] uppercase tracking-widest">Protein</span>
            <span className="text-sm tabular-nums text-[#FAFAFA]">
              {Math.round(consumedProtein)}
              {proteinTarget != null
                ? <span className="text-[#52525B]"> / {Math.round(proteinTarget)} g</span>
                : <span className="text-[#3F3F46]"> · no plan set</span>}
            </span>
          </div>
          <Bar2 value={consumedProtein} max={proteinTarget ?? 0} color={GREEN} />
        </div>

        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs tabular-nums pt-1 border-t border-[#18181B]">
          <span className="text-[#A1A1AA]">Carbs {Math.round(summary?.consumed_carbs_g ?? 0)}g</span>
          <span className="text-[#A1A1AA]">Fat {Math.round(summary?.consumed_fat_g ?? 0)}g</span>
          <span className="text-[#A1A1AA]">Sugar {Math.round(summary?.consumed_sugar_g ?? 0)}g</span>
          {summary?.remaining_kcal != null && (
            <span className="text-[#71717A] ml-auto">{Math.round(summary.remaining_kcal)} kcal left</span>
          )}
        </div>

        {/* Energy balance: eaten (in) vs Garmin burned (out) */}
        <EnergyBalance
          eaten={consumed}
          burned={summary?.burned_total_kcal ?? null}
          active={summary?.burned_active_kcal ?? null}
          net={summary?.net_vs_burn_kcal ?? null}
        />
      </div>

      {/* Water */}
      <WaterTracker date={date} />

      {/* 7-day water trend — each day's litres, goal line, calm nudge */}
      {waterWeek.length > 0 && (
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-[#52525B] uppercase tracking-widest">💧 Water · last 7 days</p>
            <p className="text-[11px] text-[#71717A] tabular-nums">
              avg <span className="font-semibold text-[#22D3EE]">{(waterAvg / 1000).toFixed(1)}L</span>
              <span className="text-[#3F3F46]"> / {(waterGoal / 1000).toFixed(1)}L goal</span> · {waterDaysHit}/7 hit
            </p>
          </div>
          <div className="flex items-end justify-between gap-2 h-28">
            {waterWeek.map((d, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1 h-full">
                <span className={`text-[10px] tabular-nums ${d.ml > 0 ? "text-[#A1A1AA]" : "text-[#3F3F46]"}`}>
                  {d.ml > 0 ? (d.ml / 1000).toFixed(1) : "—"}
                </span>
                {/* relative so the dashed goal line can float over the bar track */}
                <div className="relative w-full flex-1 flex items-end bg-[#18181B] rounded-md overflow-hidden">
                  <div
                    className="absolute inset-x-0 border-t border-dashed border-[#3F3F46]/70 z-10"
                    style={{ bottom: `${waterGoalLinePct}%` }}
                    title={`goal ${(waterGoal / 1000).toFixed(1)} L`}
                  />
                  <div
                    className="w-full rounded-md transition-all"
                    style={{ height: `${Math.max(d.ml > 0 ? 6 : 0, (d.ml / waterScale) * 100)}%`, background: d.hit ? "#22D3EE" : "#0E7490" }}
                    title={`${(d.ml / 1000).toFixed(2)} L`}
                  />
                </div>
                <span className="text-[10px] text-[#52525B] capitalize">{d.label}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-1.5 mt-2">
            <span className="w-4 border-t border-dashed border-[#3F3F46]/70" />
            <span className="text-[10px] text-[#52525B]">{(waterGoal / 1000).toFixed(1)}L goal</span>
          </div>
          <p className="text-[11px] text-[#71717A] mt-3 pt-2.5 border-t border-[#18181B]">
            {waterAvg >= waterGoal
              ? "💪 You're hitting your hydration goal — keep it up."
              : `Averaging ${((waterGoal - waterAvg) / 1000).toFixed(1)}L under goal — a glass more per day gets you there.`}
          </p>
        </div>
      )}

      {/* 7-day chart — switch between eaten-vs-target and eaten-vs-burned balance */}
      <div>
        <div className="flex items-center justify-between mb-2 gap-2">
          <p className="text-xs text-[#52525B] uppercase tracking-widest">
            Last 7 days · {chartMode === "target" ? "eaten vs target" : "eaten vs burned"}
          </p>
          <div className="flex items-center gap-3">
            {chartMode === "target" && targetKcal != null && (
              <p className="text-[11px] text-[#71717A] tabular-nums hidden sm:block">
                target <span className="font-semibold text-[#E4E4E7]">{Math.round(targetKcal)}</span> kcal
              </p>
            )}
            {/* Segmented toggle */}
            <div className="flex rounded-lg bg-[#18181B] border border-[#27272A] p-0.5 text-[11px]">
              <button onClick={() => setChartMode("target")}
                className={`px-2.5 py-1 rounded-md transition-colors ${chartMode === "target" ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#71717A] hover:text-[#A1A1AA]"}`}>
                vs target
              </button>
              <button onClick={() => setChartMode("balance")} disabled={!hasBurn}
                title={hasBurn ? "" : "No Garmin burn data for these days"}
                className={`px-2.5 py-1 rounded-md transition-colors disabled:opacity-30 ${chartMode === "balance" ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#71717A] hover:text-[#A1A1AA]"}`}>
                vs burn
              </button>
            </div>
          </div>
        </div>
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            {chartMode === "target" ? (
              <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#18181B" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "#52525B", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#52525B", fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: "#111113", border: "1px solid #27272A", borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: "#A1A1AA" }}
                />
                {targetKcal != null && (
                  <ReferenceLine y={targetKcal} stroke="#71717A" strokeDasharray="4 4"
                    label={{ value: `${Math.round(targetKcal)} kcal`, fill: "#A1A1AA", fontSize: 10, position: "insideTopRight" }} />
                )}
                <Bar dataKey="kcal" radius={[4, 4, 0, 0]}>
                  {chartData.map((d, i) => (
                    <Cell key={i} fill={d.over ? RED : GREEN} />
                  ))}
                </Bar>
              </BarChart>
            ) : (
              <ComposedChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#18181B" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "#52525B", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#52525B", fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: "#111113", border: "1px solid #27272A", borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: "#A1A1AA" }}
                />
                <Legend wrapperStyle={{ fontSize: 10, color: "#71717A" }} iconType="plainline" />
                {/* Eaten bar coloured by whether the day was a deficit (≤ burn) or surplus */}
                <Bar dataKey="kcal" name="eaten" radius={[4, 4, 0, 0]}>
                  {chartData.map((d, i) => (
                    <Cell key={i} fill={d.surplus ? RED : GREEN} />
                  ))}
                </Bar>
                {/* Garmin burn as the reference line to beat */}
                <Line type="monotone" dataKey="burned" name="burned" stroke={TEAL}
                  strokeWidth={2} dot={{ r: 2.5, fill: TEAL }} connectNulls />
              </ComposedChart>
            )}
          </ResponsiveContainer>
        </div>
        {chartMode === "balance" && (
          <p className="text-[11px] text-[#52525B] mt-1.5">
            <span className="text-[#34D399]">Green</span> = ate under your Garmin burn (deficit) ·{" "}
            <span className="text-[#F87171]">red</span> = over (surplus). The{" "}
            <span className="text-[#22D3EE]">teal line</span> is calories burned.
          </p>
        )}
      </div>

      {/* Food × how you feel — which eating patterns move energy/mood/stress */}
      <FoodWellnessImpact date={date} />

      {/* Expenditure calibration — predicted vs actual weight change */}
      {calib?.enough && (
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4">
          <p className="text-xs text-[#52525B] uppercase tracking-widest mb-2">Calibration · last {calib.window_days}d</p>
          {calib.calibrated && calib.actual_kg != null ? (
            <>
              <div className="flex items-center justify-between text-sm tabular-nums">
                <span className="text-[#71717A]">Predicted{" "}
                  <span style={{ color: kgColor(calib.predicted_kg) }}>{fmtKg(calib.predicted_kg!)}</span>
                </span>
                <span className="text-[#71717A]">Actual{" "}
                  <span className="font-semibold" style={{ color: kgColor(calib.actual_kg) }}>{fmtKg(calib.actual_kg!)}</span>
                </span>
              </div>
              {/* On/off-track verdict: did the scale move the way the model predicted? */}
              {calib.actual_kg != null && calib.predicted_kg != null && (
                <p className="text-[11px] mt-1.5" style={{ color: kgColor(calib.actual_kg) }}>
                  {calib.actual_kg <= calib.predicted_kg + 0.3
                    ? "● On track — the scale matches or beats the plan."
                    : "● Off track — you're losing slower than the plan (or gaining)."}
                </p>
              )}
              {calib.weigh_in_span_days != null && (
                <p className="text-[10px] text-[#3F3F46] mt-1">over {calib.weigh_in_span_days} days between weigh-ins</p>
              )}
              {calib.maintenance_adjust_kcal != null && Math.abs(calib.maintenance_adjust_kcal) >= 75 && (
                <p className="text-xs text-[#52525B] mt-2 pt-2 border-t border-[#18181B]">
                  Your real maintenance looks{" "}
                  <span className={calib.maintenance_adjust_kcal > 0 ? "text-[#34D399]" : "text-[#F87171]"}>
                    ~{Math.abs(calib.maintenance_adjust_kcal)} kcal {calib.maintenance_adjust_kcal > 0 ? "higher" : "lower"}
                  </span>{" "}
                  than modeled — you can {calib.maintenance_adjust_kcal > 0 ? "eat a bit more" : "tighten the target"} and still hit your rate.
                </p>
              )}
            </>
          ) : (
            <div className="flex items-start gap-2">
              <AlertTriangle size={14} className="text-[#F59E0B] mt-0.5 shrink-0" />
              <p className="text-xs text-[#71717A]">
                Predicted <span style={{ color: kgColor(calib.predicted_kg) }}>{fmtKg(calib.predicted_kg!)}</span> from your intake vs Garmin burn — but
                I can&apos;t confirm it yet. Weigh in a couple of times a week (5+ days apart) and I&apos;ll calibrate your true
                maintenance against the scale.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Weight — the fat-loss metric lives here now */}
      <WeightSection />

      {/* Targets editor */}
      <TargetsEditor date={date} targets={targets} onSaved={() => qc.invalidateQueries({ queryKey: ["food-targets", date] })} />

      {/* Heart-healthy pick (today only) */}
      {date === today && <HeartHealthyPick date={date} />}

      {/* Weekly meal plan + one shopping list for the supermarket */}
      <WeeklyMealPlan date={date} />

      {/* Add food */}
      <div>
        <p className="text-xs text-[#52525B] uppercase tracking-widest mb-2">Log food</p>
        <FoodEntryComposer date={date} />
      </div>

      {/* Entries grouped by meal */}
      {entries.length > 0 && (
        <div className="space-y-4">
          <HeartBalance entries={entries} />
          {groupByMeal(entries).map((g) => {
            const gk = g.items.reduce((a, e) => a + e.kcal, 0);
            const gp = g.items.reduce((a, e) => a + e.protein_g, 0);
            return (
              <div key={g.key}>
                <div className="flex items-baseline justify-between mb-2">
                  <span className="text-xs text-[#52525B] uppercase tracking-widest">{g.emoji} {g.label}</span>
                  <span className="text-xs text-[#52525B] tabular-nums">{Math.round(gk)} kcal · {Math.round(gp)}g P</span>
                </div>
                <div className="flex flex-col gap-2">
                  {g.items.map((e) => (
                    <div key={e.id} className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[#FAFAFA] truncate flex items-center gap-1.5">
                          {e.heart_rating && <HeartDot rating={e.heart_rating} title={e.heart_note ?? undefined} />}
                          {e.description}
                        </p>
                        <p className="text-xs text-[#52525B] tabular-nums">
                          {Math.round(e.kcal)} kcal · {Math.round(e.protein_g)}P / {Math.round(e.carbs_g)}C / {Math.round(e.fat_g)}F
                          {e.fiber_g != null && e.fiber_g > 0 && ` · ${Math.round(e.fiber_g)}g fibre`}
                          {e.saturated_fat_g != null && e.saturated_fat_g > 0 && ` · ${Math.round(e.saturated_fat_g)}g sat fat`}
                        </p>
                        {e.heart_rating && (e.heart_rating === "limit" || e.heart_rating === "avoid") && e.heart_note && (
                          <p className="text-[11px] text-[#71717A] mt-0.5">{e.heart_note}</p>
                        )}
                      </div>
                      <EntryTime entry={e} date={date} />
                      <button onClick={() => del(e.id)} className="p-1.5 rounded-lg hover:bg-[#27272A] shrink-0">
                        <Trash2 size={14} className="text-[#52525B]" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* AI coach: what to eat next + foods to watch */}
      <div>
        <div className="flex items-center justify-between mb-2 gap-2">
          <p className="text-xs text-[#52525B] uppercase tracking-widest shrink-0">Coach · what to eat</p>
          <div className="flex items-center gap-2">
            <select
              value={coachMeal}
              onChange={(e) => setCoachMeal(e.target.value)}
              className="bg-[#18181B] border border-[#27272A] rounded-lg px-2 py-1 text-xs text-[#D4D4D8] focus:outline-none focus:border-[#3F3F46]"
            >
              <option value="">Next meal</option>
              {["breakfast", "lunch", "dinner", "snack"].map((m) => (
                <option key={m} value={m}>{m[0].toUpperCase() + m.slice(1)}</option>
              ))}
            </select>
            <button onClick={generateCoach} disabled={coaching}
              className="flex items-center gap-1.5 text-xs text-[#F59E0B] hover:text-[#FBBF24] disabled:opacity-40">
              <Sparkles size={13} /> {coaching ? "Thinking…" : coach ? "Refresh" : "Suggest"}
            </button>
          </div>
        </div>

        {!coach && !coaching && (
          <p className="text-xs text-[#3F3F46]">Tap Suggest for an AI meal recommendation and foods to watch, based on your target and recent eating.</p>
        )}

        {coach && (
          <div className="space-y-3">
            {coach.next_meal && (
              <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <UtensilsCrossed size={16} className="text-[#F59E0B] mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    {coach.meal_type && coach.meal_type !== "next" && (
                      <p className="text-[10px] uppercase tracking-widest text-[#F59E0B] mb-0.5">For {coach.meal_type}</p>
                    )}
                    <p className="text-sm font-semibold text-[#FAFAFA]">{coach.next_meal.name}</p>
                    {coach.next_meal.why && <p className="text-xs text-[#71717A] mt-0.5">{coach.next_meal.why}</p>}
                    {coach.alternatives && coach.alternatives.length > 0 && (
                      <p className="text-xs text-[#52525B] mt-1.5">
                        or: {coach.alternatives.map((a) => a.name).join(" · ")}
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-[#A1A1AA] tabular-nums shrink-0">
                    {Math.round(coach.next_meal.kcal)} kcal · {Math.round(coach.next_meal.protein_g)}P
                  </span>
                </div>
              </div>
            )}

            {coach.avoid && coach.avoid.length > 0 && (
              <div className="bg-[#F87171]/5 border border-[#F87171]/20 rounded-xl p-4 space-y-2">
                <p className="text-xs text-[#F87171] uppercase tracking-widest flex items-center gap-1.5">
                  <AlertTriangle size={12} /> Watch out
                </p>
                {coach.avoid.map((a, i) => (
                  <div key={i} className="text-sm">
                    <span className="text-[#FAFAFA] font-medium">{a.item}</span>
                    <span className="text-[#71717A]"> — {a.reason}</span>
                    {a.swap && <span className="text-[#34D399]"> → try {a.swap}</span>}
                  </div>
                ))}
              </div>
            )}

            {coach.tip && (
              <p className="text-xs text-[#71717A] italic">{coach.tip}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Day cholesterol balance: how many logged foods are heart-healthy vs to limit/avoid,
// plus the day's saturated-fat load and fibre — the "how am I doing for my LDL?" glance.
function HeartBalance({ entries }: { entries: FoodEntry[] }) {
  const counts = { good: 0, ok: 0, limit: 0, avoid: 0 };
  let sat = 0, fibre = 0, satKnown = false, fibreKnown = false;
  for (const e of entries) {
    if (e.heart_rating) counts[e.heart_rating] += 1;
    if (e.saturated_fat_g != null) { sat += e.saturated_fat_g; satKnown = true; }
    if (e.fiber_g != null) { fibre += e.fiber_g; fibreKnown = true; }
  }
  const total = entries.length;
  const flagged = counts.limit + counts.avoid;
  const segs: { rating: "good" | "ok" | "limit" | "avoid"; n: number }[] = [
    { rating: "good", n: counts.good }, { rating: "ok", n: counts.ok },
    { rating: "limit", n: counts.limit }, { rating: "avoid", n: counts.avoid },
  ].filter((s) => s.n > 0);

  const msg = flagged === 0
    ? "Great cholesterol day — nothing flagged."
    : `${flagged} food${flagged > 1 ? "s" : ""} to watch for your cholesterol today.`;

  return (
    <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-[#52525B] uppercase tracking-widest">Heart balance</span>
        <span className="text-xs text-[#71717A] tabular-nums">
          {satKnown && `${Math.round(sat)}g sat fat`}{satKnown && fibreKnown && " · "}
          {fibreKnown && `${Math.round(fibre)}g fibre`}
        </span>
      </div>
      <div className="flex h-2 rounded-full overflow-hidden bg-[#18181B]">
        {segs.map((s) => (
          <div key={s.rating} title={`${HEART_META[s.rating].label}: ${s.n}`}
            style={{ flex: s.n, background: HEART_META[s.rating].color }} />
        ))}
      </div>
      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-3">
          {segs.map((s) => (
            <span key={s.rating} className="inline-flex items-center gap-1 text-[11px] text-[#A1A1AA]">
              <HeartDot rating={s.rating} /> {s.n}
            </span>
          ))}
        </div>
        <span className={`text-[11px] ${flagged === 0 ? "text-[#34D399]" : "text-[#FBBF24]"}`}>{msg}</span>
      </div>
      {total === 0 && <p className="text-[11px] text-[#52525B]">No foods logged yet.</p>}
    </div>
  );
}

// Show + inline-edit when a food item was eaten (drives meal-time habits + the timeline).
function EntryTime({ entry, date }: { entry: FoodEntry; date: string }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const t = entry.eaten_at && entry.eaten_at.length >= 16 ? entry.eaten_at.slice(11, 16) : null;

  async function save(newT: string) {
    setEditing(false);
    if (!newT) return;
    await foodApi.update(entry.id, { eaten_at: `${date}T${newT}` });
    qc.invalidateQueries({ queryKey: ["day-food", date] });
    qc.invalidateQueries({ queryKey: ["wellness-timeline", date] });
  }

  if (editing) {
    return (
      <input type="time" defaultValue={t ?? ""} autoFocus
        onBlur={(e) => save(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") save((e.target as HTMLInputElement).value); }}
        className="w-[84px] shrink-0 bg-[#18181B] border border-[#27272A] rounded-lg px-2 py-1 text-xs text-[#FAFAFA] tabular-nums focus:outline-none focus:border-[#3F3F46]" />
    );
  }
  return (
    <button onClick={() => setEditing(true)}
      className="shrink-0 text-xs text-[#52525B] tabular-nums hover:text-[#A1A1AA] transition-colors">
      {t ?? "set time"}
    </button>
  );
}

function TargetsEditor({
  date, targets, onSaved,
}: {
  date: string;
  targets: FoodTargetsResponse | undefined;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const active = targets?.active;
  const sug = targets?.suggestion;
  const [targetKcal, setTargetKcal] = useState<string>("");
  const [proteinG, setProteinG] = useState<string>("");
  const [saving, setSaving] = useState(false);

  function openEditor() {
    setTargetKcal(String(active?.target_kcal ?? sug?.target_kcal ?? ""));
    setProteinG(String(active?.protein_g ?? sug?.protein_g ?? ""));
    setOpen(true);
  }

  async function save() {
    const tk = parseFloat(targetKcal);
    const pg = parseFloat(proteinG);
    if (!tk || !pg) return;
    setSaving(true);
    try {
      await foodApi.putTargets({
        effective_date: date,
        target_kcal: tk,
        protein_g: pg,
        maintenance_kcal: sug?.maintenance_kcal ?? undefined,
        deficit_kcal: sug?.maintenance_kcal ? sug.maintenance_kcal - tk : undefined,
        basis_weight_kg: sug?.basis_weight_kg ?? undefined,
      });
      onSaved();
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    "w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] tabular-nums focus:outline-none focus:border-[#3F3F46]";

  return (
    <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-[#52525B] uppercase tracking-widest">Daily target</p>
          <p className="text-sm text-[#FAFAFA] tabular-nums mt-0.5">
            {active
              ? `${Math.round(active.target_kcal)} kcal · ${Math.round(active.protein_g)}g protein`
              : sug?.target_kcal
              ? `suggested ${Math.round(sug.target_kcal)} kcal · ${sug.protein_g ? Math.round(sug.protein_g) : "?"}g protein`
              : "no Garmin data yet — set manually"}
          </p>
          {sug?.maintenance_kcal && (
            <p className="text-[11px] text-[#3F3F46] mt-0.5">maintenance ~{Math.round(sug.maintenance_kcal)} (Garmin 14-day avg)</p>
          )}
        </div>
        <button onClick={openEditor} className="text-xs text-[#71717A] hover:text-[#A1A1AA]">edit</button>
      </div>

      {open && (
        <div className="mt-3 pt-3 border-t border-[#18181B] space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] text-[#52525B] mb-1">Target kcal</label>
              <input type="number" value={targetKcal} onChange={(e) => setTargetKcal(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-[10px] text-[#52525B] mb-1">Protein g</label>
              <input type="number" value={proteinG} onChange={(e) => setProteinG(e.target.value)} className={inputCls} />
            </div>
          </div>
          {sug?.target_kcal && (
            <button
              onClick={() => { setTargetKcal(String(sug.target_kcal)); setProteinG(String(sug.protein_g ?? "")); }}
              className="text-[11px] text-[#71717A] hover:text-[#A1A1AA]"
            >
              use suggestion ({Math.round(sug.target_kcal)} / {sug.protein_g ? Math.round(sug.protein_g) : "?"}g)
            </button>
          )}
          <button onClick={save} disabled={saving}
            className="w-full bg-[#F59E0B] hover:bg-[#FBBF24] disabled:opacity-40 text-black font-semibold text-sm rounded-lg py-2 transition-colors">
            {saving ? "Saving…" : "Save target"}
          </button>
        </div>
      )}
    </div>
  );
}
