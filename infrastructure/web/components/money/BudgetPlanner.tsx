"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Check, Loader } from "lucide-react";
import { moneyApi, fmtAmount, type BudgetPlan, type BudgetPlanRow } from "@/lib/money-api";
import { Section, StatTile } from "./ui";

const input =
  "w-24 bg-[#18181B] border border-[#27272A] rounded-lg px-2 py-1.5 text-sm text-right text-[#FAFAFA] tabular-nums focus:outline-none focus:border-[#F59E0B]";

// Savings goal + next month's budget per category, suggested from the last 12
// complete months (see domains/money/budgets.py plan()).
export function BudgetPlanner() {
  const qc = useQueryClient();
  const { data: plan, isLoading } = useQuery({ queryKey: ["money", "budget-plan"], queryFn: () => moneyApi.budgetPlan() });

  const [goal, setGoal] = useState("");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!plan) return;
    setGoal(String(plan.goal));
    setAmounts(Object.fromEntries(plan.rows.map((r) => [r.category, String(r.suggested)])));
  }, [plan]);

  const saveGoal = useMutation({
    mutationFn: () => moneyApi.saveMoneySettings({ savings_goal: Number(goal) || 0 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["money"] }),
  });
  const saveBudget = useMutation({
    mutationFn: (p: BudgetPlan) =>
      moneyApi.saveBudget(p.effective_month, Object.fromEntries(Object.entries(amounts).map(([k, v]) => [k, Number(v) || 0]))),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["money"] }),
  });

  if (isLoading || !plan) return <div className="h-64 bg-[#0D0D0F] rounded-xl animate-pulse" />;

  const total = Object.values(amounts).reduce((s, v) => s + (Number(v) || 0), 0);
  const leftover = plan.avg_income - total;
  const goalNum = Number(goal) || 0;
  const effective = format(parseISO(`${plan.effective_month}-01`), "MMMM");
  const fill = (pick: (r: BudgetPlanRow) => number) =>
    setAmounts(Object.fromEntries(plan.rows.map((r) => [r.category, String(pick(r))])));

  return (
    <>
      <Section title="Savings goal" hint="What you aim to keep each month. Trends counts a month as a win when you reach it.">
        <div className="flex items-center gap-2">
          <span className="text-[#71717A]">€</span>
          <input type="number" inputMode="decimal" value={goal} onChange={(e) => setGoal(e.target.value)} className={input} aria-label="Savings goal" />
          <span className="text-xs text-[#52525B]">per month</span>
          <button
            type="button"
            onClick={() => saveGoal.mutate()}
            disabled={saveGoal.isPending || goalNum === plan.goal}
            className="ml-auto text-xs px-3 py-1.5 rounded-lg bg-[#F59E0B] text-[#09090B] font-semibold disabled:opacity-40"
          >
            {saveGoal.isSuccess && goalNum === plan.goal ? "Saved" : "Save goal"}
          </button>
        </div>
      </Section>

      <Section
        title={`Budget for ${effective}`}
        hint="Suggested from your last 12 months: a regular category's typical month, an occasional one's monthly average — never above its current budget. Bills follow what you paid last month."
      >
        <div className="grid grid-cols-3 gap-3 mb-4">
          <StatTile label="Avg income" value={fmtAmount(plan.avg_income)} sub="last 12 months" />
          <StatTile label="This budget" value={fmtAmount(total)} sub={`now ${fmtAmount(plan.current_total)}`} />
          <StatTile
            label="Leaves"
            value={`${leftover < 0 ? "−" : ""}${fmtAmount(leftover)}`}
            sub={goalNum ? (leftover >= goalNum ? "meets your goal" : `${fmtAmount(goalNum - leftover)} short`) : "to save"}
            tone={leftover < 0 ? "bad" : goalNum && leftover < goalNum ? "warn" : "good"}
          />
        </div>

        <div className="flex gap-2 mb-3 text-xs">
          <button type="button" onClick={() => fill((r) => r.suggested)} className="px-3 py-1.5 rounded-full border border-[#27272A] text-[#A1A1AA] hover:text-[#FAFAFA]">
            Use suggestions
          </button>
          <button type="button" onClick={() => fill((r) => r.current)} className="px-3 py-1.5 rounded-full border border-[#27272A] text-[#A1A1AA] hover:text-[#FAFAFA]">
            Keep current
          </button>
        </div>

        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl divide-y divide-[#18181B]">
          {plan.rows.map((r) => (
            <PlanRow
              key={r.category}
              r={r}
              value={amounts[r.category] ?? ""}
              onChange={(v) => setAmounts((a) => ({ ...a, [r.category]: v }))}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={() => saveBudget.mutate(plan)}
          disabled={saveBudget.isPending}
          className="w-full mt-4 py-3 rounded-xl bg-[#F59E0B] text-[#09090B] font-semibold flex items-center justify-center gap-2 disabled:opacity-40"
        >
          {saveBudget.isPending ? <Loader size={16} className="animate-spin" /> : <Check size={16} />}
          {saveBudget.isSuccess ? `Saved — applies from ${effective}` : `Apply from ${effective}`}
        </button>
        {(saveBudget.error || saveGoal.error) && (
          <p className="text-xs text-[#EF4444] mt-2">{(saveBudget.error ?? saveGoal.error)?.message}</p>
        )}
      </Section>
    </>
  );
}

function PlanRow({ r, value, onChange }: { r: BudgetPlanRow; value: string; onChange: (v: string) => void }) {
  const max = Math.max(...r.history, 1);
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="text-base w-6 text-center shrink-0">{r.emoji}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-[#D4D4D8] truncate">
          {r.category}
          {r.fixed && <span className="ml-1.5 text-[10px] text-[#52525B] uppercase tracking-wider">bill</span>}
        </p>
        <p className="text-xs text-[#52525B] tabular-nums truncate">
          typical {fmtAmount(r.typical)} · now {r.current ? fmtAmount(r.current) : "—"} · last {fmtAmount(r.last)}
        </p>
      </div>
      {/* Last 12 months, one bar each — the tooltip carries the amount */}
      <div className="hidden sm:flex items-end gap-[2px] h-6 shrink-0" aria-hidden>
        {r.history.map((v, i) => (
          <span key={i} className="w-1 rounded-t-sm bg-[#71717A]" style={{ height: `${Math.max((v / max) * 100, v > 0 ? 8 : 0)}%` }} title={fmtAmount(v)} />
        ))}
      </div>
      <input
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={input}
        aria-label={`${r.category} budget`}
      />
    </div>
  );
}
