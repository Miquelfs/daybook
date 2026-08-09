"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid,
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

const AMBER = "#F59E0B";
const GREEN = "#34D399";
const RED = "#F87171";
const TEAL = "#22D3EE";

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
  const [date, setDate] = useState(today);
  const [coaching, setCoaching] = useState(false);

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
    over: s.target_kcal != null && s.consumed_kcal > s.target_kcal,
  }));

  async function del(id: number) {
    await foodApi.delete(id);
    qc.invalidateQueries({ queryKey: ["day-food", date] });
    qc.invalidateQueries({ queryKey: ["food-summary", date] });
    qc.invalidateQueries({ queryKey: ["food-week"] });
  }

  async function generateCoach() {
    setCoaching(true);
    try {
      await foodApi.generateCoach(date);
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

  return (
    <div className="space-y-8">
      {/* Header + date nav — matches the other top-level screens */}
      <div>
        <Link href="/" className="text-xs text-[#71717A] hover:text-[#A1A1AA] uppercase tracking-widest inline-block mb-2">
          ← Today
        </Link>
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
            <span className="text-xs text-[#52525B] uppercase tracking-widest">Calories</span>
            <span className={`text-sm tabular-nums ${overTarget ? "text-[#F87171]" : "text-[#FAFAFA]"}`}>
              {Math.round(consumed)}{targetKcal != null && <span className="text-[#52525B]"> / {Math.round(targetKcal)}</span>}
            </span>
          </div>
          <Bar2 value={consumed} max={targetKcal ?? consumed} color={overTarget ? RED : AMBER} />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-[#52525B] uppercase tracking-widest">Protein</span>
            <span className="text-sm tabular-nums text-[#FAFAFA]">
              {Math.round(consumedProtein)}{proteinTarget != null && <span className="text-[#52525B]"> / {Math.round(proteinTarget)} g</span>}
            </span>
          </div>
          <Bar2 value={consumedProtein} max={proteinTarget ?? consumedProtein} color={GREEN} />
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

      {/* 7-day energy balance */}
      <div>
        <p className="text-xs text-[#52525B] uppercase tracking-widest mb-2">Last 7 days · eaten vs target</p>
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#18181B" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: "#52525B", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#52525B", fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: "#111113", border: "1px solid #27272A", borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: "#A1A1AA" }}
              />
              {targetKcal != null && (
                <ReferenceLine y={targetKcal} stroke="#3F3F46" strokeDasharray="4 4"
                  label={{ value: "target", fill: "#52525B", fontSize: 10, position: "insideTopRight" }} />
              )}
              <Bar dataKey="kcal" radius={[4, 4, 0, 0]}>
                {chartData.map((d, i) => (
                  <Cell key={i} fill={d.over ? RED : GREEN} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Expenditure calibration — predicted vs actual weight change */}
      {calib?.enough && calib.actual_kg != null && (
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4">
          <p className="text-xs text-[#52525B] uppercase tracking-widest mb-2">Calibration · last {calib.window_days}d</p>
          <div className="flex items-center justify-between text-sm tabular-nums">
            <span className="text-[#71717A]">Predicted <span className="text-[#A1A1AA]">{calib.predicted_kg} kg</span></span>
            <span className="text-[#71717A]">Actual <span className="text-[#FAFAFA] font-semibold">{calib.actual_kg} kg</span></span>
          </div>
          {calib.maintenance_adjust_kcal != null && Math.abs(calib.maintenance_adjust_kcal) >= 75 && (
            <p className="text-xs text-[#52525B] mt-2 pt-2 border-t border-[#18181B]">
              Your real maintenance looks{" "}
              <span className={calib.maintenance_adjust_kcal > 0 ? "text-[#34D399]" : "text-[#F87171]"}>
                ~{Math.abs(calib.maintenance_adjust_kcal)} kcal {calib.maintenance_adjust_kcal > 0 ? "higher" : "lower"}
              </span>{" "}
              than modeled — you can {calib.maintenance_adjust_kcal > 0 ? "eat a bit more" : "tighten the target"} and still hit your rate.
            </p>
          )}
        </div>
      )}

      {/* Weight — the fat-loss metric lives here now */}
      <WeightSection />

      {/* Targets editor */}
      <TargetsEditor date={date} targets={targets} onSaved={() => qc.invalidateQueries({ queryKey: ["food-targets", date] })} />

      {/* Add food */}
      <div>
        <p className="text-xs text-[#52525B] uppercase tracking-widest mb-2">Log food</p>
        <FoodEntryComposer date={date} />
      </div>

      {/* Entries grouped by meal */}
      {entries.length > 0 && (
        <div className="space-y-4">
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
                        <p className="text-sm font-medium text-[#FAFAFA] truncate">{e.description}</p>
                        <p className="text-xs text-[#52525B] tabular-nums">
                          {Math.round(e.kcal)} kcal · {Math.round(e.protein_g)}P / {Math.round(e.carbs_g)}C / {Math.round(e.fat_g)}F
                          {e.sugar_g > 0 && ` · ${Math.round(e.sugar_g)}g sugar`}
                        </p>
                      </div>
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
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-[#52525B] uppercase tracking-widest">Coach · what to eat next</p>
          <button onClick={generateCoach} disabled={coaching}
            className="flex items-center gap-1.5 text-xs text-[#F59E0B] hover:text-[#FBBF24] disabled:opacity-40">
            <Sparkles size={13} /> {coaching ? "Thinking…" : coach ? "Refresh" : "Suggest"}
          </button>
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
