"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO, addDays, differenceInCalendarDays } from "date-fns";
import { CalendarRange, ShoppingCart, Sparkles, Check } from "lucide-react";
import { foodApi, type WeeklyPlanResponse, type PlannedDay, type PlannedMeal } from "@/lib/food-api";

// Plan covers the next few days starting from the selected date.
const PLAN_DAYS = 3;

const MEALS: { key: keyof PlannedDay; emoji: string }[] = [
  { key: "breakfast", emoji: "🥣" },
  { key: "lunch", emoji: "🥗" },
  { key: "dinner", emoji: "🍽" },
  { key: "snack", emoji: "🍎" },
];

function MealLine({ meal, emoji }: { meal?: PlannedMeal; emoji: string }) {
  if (!meal) return null;
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs shrink-0">{emoji}</span>
      <span className="text-xs text-[#A1A1AA] flex-1 min-w-0">{meal.name}</span>
      <span className="text-[10px] text-[#3F3F46] tabular-nums shrink-0">
        {Math.round(meal.kcal)}·{Math.round(meal.protein_g)}P
      </span>
    </div>
  );
}

// A day's label + styling, worked out from its real date relative to the day
// you're viewing — so "Today"/"Tomorrow" always match the calendar, and past
// days (from a plan made earlier) dim out instead of misleading you.
function dayMeta(d: PlannedDay, ref: string): { label: string; today: boolean; past: boolean } {
  if (!d.date) return { label: d.day, today: false, past: false };
  const diff = differenceInCalendarDays(parseISO(d.date), parseISO(ref));
  if (diff === 0) return { label: "Today", today: true, past: false };
  if (diff === 1) return { label: "Tomorrow", today: false, past: false };
  if (diff === -1) return { label: "Yesterday", today: false, past: true };
  return { label: format(parseISO(d.date), "EEE d"), today: false, past: diff < 0 };
}

function DayBlock({ d, viewDate }: { d: PlannedDay; viewDate: string }) {
  const m = dayMeta(d, viewDate);
  return (
    <div className={`rounded-lg px-3 py-2.5 border ${
      m.today ? "bg-[#34D399]/[0.06] border-[#34D399]/40" : "bg-[#0D0D0F] border-[#27272A]"
    } ${m.past ? "opacity-45" : ""}`}>
      <div className="flex items-baseline justify-between mb-1.5">
        <span className={`text-xs font-semibold ${m.today ? "text-[#34D399]" : "text-[#E4E4E7]"}`}>
          {m.label}{m.today && <span className="ml-1.5 text-[9px] uppercase tracking-widest text-[#34D399]/70">eat this</span>}
        </span>
        {d.kcal != null && (
          <span className="text-[10px] text-[#52525B] tabular-nums">
            {Math.round(d.kcal)} kcal · {Math.round(d.protein_g ?? 0)}g P
          </span>
        )}
      </div>
      <div className="space-y-1">
        {MEALS.map((mm) => <MealLine key={mm.key} meal={d[mm.key] as PlannedMeal} emoji={mm.emoji} />)}
      </div>
    </div>
  );
}

// Consolidated shopping list with tick-off, persisted per plan in localStorage.
function ShoppingList({ startDate, plan }: { startDate: string; plan: WeeklyPlanResponse["plan"] }) {
  const storageKey = `daybook.shopping.${startDate}`;
  const [checked, setChecked] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      setChecked(raw ? new Set(JSON.parse(raw)) : new Set());
    } catch { setChecked(new Set()); }
  }, [storageKey]);

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      try { localStorage.setItem(storageKey, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }

  const cats = plan.shopping_list ?? [];
  const total = cats.reduce((a, c) => a + c.items.length, 0);
  const got = cats.reduce((a, c) => a + c.items.filter((_, i) => checked.has(`${c.category}:${i}`)).length, 0);

  if (total === 0) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-[#52525B] uppercase tracking-widest flex items-center gap-1.5">
          <ShoppingCart size={13} className="text-[#34D399]" /> Shopping list
        </p>
        <span className="text-[10px] text-[#71717A] tabular-nums">{got}/{total} in the basket</span>
      </div>
      <div className="space-y-3">
        {cats.map((c) => (
          <div key={c.category}>
            <p className="text-[10px] uppercase tracking-widest text-[#52525B] mb-1">{c.category}</p>
            <div className="flex flex-col gap-0.5">
              {c.items.map((it, i) => {
                const id = `${c.category}:${i}`;
                const on = checked.has(id);
                return (
                  <button key={id} onClick={() => toggle(id)}
                    className="flex items-center gap-2.5 text-left group py-0.5">
                    <span className={`w-4 h-4 rounded border shrink-0 flex items-center justify-center transition-colors
                      ${on ? "bg-[#34D399] border-[#34D399]" : "border-[#3F3F46] group-hover:border-[#52525B]"}`}>
                      {on && <Check size={11} className="text-black" strokeWidth={3} />}
                    </span>
                    <span className={`text-xs flex-1 min-w-0 ${on ? "text-[#3F3F46] line-through" : "text-[#D4D4D8]"}`}>
                      {it.name}
                    </span>
                    {it.qty && <span className="text-[10px] text-[#52525B] tabular-nums shrink-0">{it.qty}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// "What do I cook & buy this week?" — a 7-day heart-healthy, target-hitting plan
// plus one consolidated, tick-off shopping list. Turns today-only visibility into
// a whole week you can plan and shop for.
export function WeeklyMealPlan({ date }: { date: string }) {
  const qc = useQueryClient();
  const startDate = date;
  const [busy, setBusy] = useState(false);
  const [prefs, setPrefs] = useState("");
  const [showPrefs, setShowPrefs] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const { data, isLoading } = useQuery<WeeklyPlanResponse | null>({
    queryKey: ["food-weekly-plan", startDate],
    queryFn: async () => { try { return await foodApi.weeklyPlan(startDate); } catch { return null; } },
    staleTime: 5 * 60 * 1000,
  });

  async function generate() {
    setBusy(true);
    setErr(null);
    try {
      await foodApi.generateWeeklyPlan(startDate, prefs || undefined);
      qc.invalidateQueries({ queryKey: ["food-weekly-plan", startDate] });
    } catch {
      setErr("Couldn't build the plan just now — the AI planner may be busy. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  const plan = data?.plan ?? null;
  const planDays = plan?.days ?? [];
  // Prefer the plan's real coverage (it may have been generated a day or two ago);
  // fall back to the prospective next-N-days when nothing is stored yet.
  const firstDate = planDays[0]?.date;
  const lastDate = planDays[planDays.length - 1]?.date;
  const rangeLabel = firstDate && lastDate
    ? `${format(parseISO(firstDate), "d MMM")} – ${format(parseISO(lastDate), "d MMM")}`
    : `${format(parseISO(startDate), "d MMM")} – ${format(addDays(parseISO(startDate), PLAN_DAYS - 1), "d MMM")}`;

  return (
    <div>
      <div className="flex items-center justify-between mb-2 gap-2">
        <p className="text-xs text-[#52525B] uppercase tracking-widest shrink-0 flex items-center gap-1.5">
          <CalendarRange size={13} /> {plan ? "Meal plan" : `Next ${PLAN_DAYS} days`} · {rangeLabel}
        </p>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowPrefs((v) => !v)}
            className="text-[11px] text-[#52525B] hover:text-[#A1A1AA]">preferences</button>
          <button onClick={generate} disabled={busy}
            className="flex items-center gap-1.5 text-xs text-[#34D399] hover:text-[#6EE7B7] disabled:opacity-40">
            <Sparkles size={13} /> {busy ? "Planning…" : plan ? "Regenerate" : `Plan next ${PLAN_DAYS} days`}
          </button>
        </div>
      </div>

      {showPrefs && (
        <input value={prefs} onChange={(e) => setPrefs(e.target.value)}
          placeholder="e.g. vegetarian dinners, quick lunches, no fish on Fri"
          className="w-full mb-3 bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-xs text-[#FAFAFA] focus:outline-none focus:border-[#3F3F46]" />
      )}

      {err && (
        <p className="text-xs text-[#F87171] mb-2">{err}</p>
      )}

      {!plan && !busy && (
        <p className="text-xs text-[#3F3F46]">
          {isLoading ? "Loading…" : `Get the next ${PLAN_DAYS} days of heart-healthy meals that hit your target, plus one small shopping list for the supermarket.`}
        </p>
      )}

      {busy && !plan && (
        <p className="text-xs text-[#71717A]">Building your plan — this takes a few seconds…</p>
      )}

      {plan && (
        <div className="space-y-4">
          {data?.plan.note && <p className="text-xs text-[#71717A] italic">{data.plan.note}</p>}
          <div className="space-y-2">
            {planDays.map((d, i) => <DayBlock key={d.date ?? d.day ?? i} d={d} viewDate={startDate} />)}
          </div>
          <div className="pt-3 border-t border-[#18181B]">
            {/* Key the tick-list to the plan itself (its start date), so checks
                persist across the days it covers, not just the day you generated it. */}
            <ShoppingList startDate={data?.start_date ?? startDate} plan={plan} />
          </div>
          {data?.generated_at && (
            <p className="text-[10px] text-[#3F3F46]">
              Generated {format(parseISO(data.generated_at.replace("Z", "")), "d MMM HH:mm")}
              {data.model ? ` · ${data.model}` : ""}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
