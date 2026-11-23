"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, format, parseISO } from "date-fns";
import { Check } from "lucide-react";
import { fmtAmount, moneyApi, type Cadence } from "@/lib/money-api";
import { statementsApi, type StmtPlan } from "@/lib/statements-api";
import { Block, Panel } from "@/components/ui/kit";

const btn = "inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-[#27272A] text-[#A1A1AA] hover:text-[#FAFAFA] disabled:opacity-50";

// The next date the bank will run it, from its usual day of the month (never in the past, so a
// new Daybook plan doesn't catch up on executions the statement already has).
function nextRun(p: StmtPlan): string {
  const today = new Date();
  const d = p.day_of_month ?? today.getDate();
  let next = new Date(today.getFullYear(), today.getMonth(), Math.min(d, 28));
  if (next <= today) next = new Date(today.getFullYear(), today.getMonth() + 1, Math.min(d, 28));
  if (p.cadence && p.cadence !== "monthly" && p.last) next = addDays(parseISO(p.last), p.cadence === "weekly" ? 7 : 14);
  return format(next < today ? addDays(today, 1) : next, "yyyy-MM-dd");
}

function issueText(p: StmtPlan, account: string): string {
  const bank = p.typical != null ? `${fmtAmount(p.typical)} ${p.cadence ?? ""}`.trim() : "";
  if (p.issues.includes("no_holding")) return `Not in your portfolio — add ${p.isin} as a holding, then a plan for it`;
  if (p.issues.includes("no_plan")) return `In your portfolio, but no plan: the bank buys ${bank}`;
  if (p.issues.includes("not_on_statement")) return `A Daybook plan paid from ${account}, but the statement never buys it — stopped, or another fund?`;
  const bits: string[] = [];
  if (p.issues.includes("account")) bits.push(`paid from ${p.plan!.source_account}, not ${account}`);
  if (p.issues.includes("amount")) bits.push(`${fmtAmount(p.plan!.amount_eur)} in Daybook, ${fmtAmount(p.typical ?? 0)} at the bank`);
  if (p.issues.includes("cadence")) bits.push(`${p.plan!.cadence} in Daybook, ${p.cadence} at the bank`);
  return bits.length ? bits.join(" · ") : `Set up right · ${bank}`;
}

// Savings plans on the statement (by ISIN) next to Daybook's DCA plans: each one should exist,
// be paid from this account, at the bank's amount and cadence — then its executions match by
// themselves, a few days or cents off included.
export function SavingsPlansCheck({ account, start, end, onChanged }: {
  account: string; start?: string; end?: string; onChanged: () => void;
}) {
  const qc = useQueryClient();
  const { data: plans = [] } = useQuery({
    queryKey: ["statements", "plans", account, start, end],
    queryFn: () => statementsApi.plans(account, start, end),
    enabled: !!account,
  });
  const done = () => { qc.invalidateQueries({ queryKey: ["statements"] }); qc.invalidateQueries({ queryKey: ["money"] }); onChanged(); };
  const fix = useMutation({
    mutationFn: async (p: StmtPlan) => {
      const patch: Record<string, unknown> = {};
      if (p.issues.includes("account")) patch.source_account = account;
      if (p.issues.includes("amount") && p.typical) patch.amount_eur = p.typical;
      if (p.issues.includes("cadence") && p.cadence) patch.cadence = p.cadence;
      if (p.cadence === "monthly" && p.day_of_month) patch.day_of_month = p.day_of_month;
      await moneyApi.patchPlan(p.plan!.id, patch);
      if (p.issues.includes("account")) await statementsApi.movePlanExecutions(p.plan!.id, account, start, end);
    },
    onSuccess: done,
  });
  const create = useMutation({
    mutationFn: (p: StmtPlan) => moneyApi.createPlan({
      holding_id: p.holding!.id, source_account: account, amount_eur: p.typical!, cadence: (p.cadence ?? "monthly") as Cadence,
      day_of_month: p.cadence === "monthly" || !p.cadence ? p.day_of_month : null,
      day_of_week: p.cadence === "weekly" || p.cadence === "biweekly" ? (parseISO(p.last!).getDay() + 6) % 7 : null,
      start_date: nextRun(p),
      notes: `From the ${account} statement (${p.isin})`,
    }),
    onSuccess: done,
  });
  const book = useMutation({
    mutationFn: ({ p, units }: { p: StmtPlan; units: boolean }) => statementsApi.bookPlanRuns(account, p.isin, units, start, end),
    onSuccess: done,
  });
  if (plans.length === 0) return null;
  const off = plans.filter((p) => p.issues.length).length;

  return (
    <Block title={`Savings plans · ${off ? `${off} to set up` : "all set up"}`}
           note="Each plan the bank runs should be a Daybook plan paid from this account, at its amount and cadence — then its executions match by ISIN, a few days or cents off included.">
      <Panel className="divide-y divide-[#18181B]">
        {plans.map((p) => (
          <div key={`${p.isin}-${p.plan?.id ?? ""}`} className="px-4 py-2.5">
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">{p.holding?.name ?? p.name}</p>
                <p className={`text-xs truncate ${p.issues.length ? "text-[#F59E0B]" : "text-[#71717A]"}`}>
                  {!p.issues.length && <Check size={11} className="inline mr-1 -mt-0.5" />}{issueText(p, account)}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm tabular-nums">{p.count ? `${p.count}×` : "—"}</p>
                <p className="text-[10px] text-[#52525B] tabular-nums">{p.isin}</p>
              </div>
            </div>
            {p.unbooked > 0 && p.holding && (
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                <span className="text-xs text-[#71717A]">{p.unbooked} run{p.unbooked === 1 ? "" : "s"} on the statement Daybook never booked ({fmtAmount(p.unbooked_total)})</span>
                <button className={btn} disabled={book.isPending} onClick={() => {
                  if (!confirm(`Book ${p.unbooked} run${p.unbooked === 1 ? "" : "s"} (${fmtAmount(p.unbooked_total)}) like plan executions on ${account}?`)) return;
                  const units = confirm(`Also add the units the bank bought to ${p.holding!.name}?\n\nOK = yes. Cancel = no — pick this if you already keep the holding's quantity in step with the app by hand.`);
                  book.mutate({ p, units });
                }}>Book them</button>
              </div>
            )}
            {p.issues.length > 0 && !p.issues.includes("not_on_statement") && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {p.plan && (
                  <button className={btn} disabled={fix.isPending} onClick={() => {
                    const moving = p.issues.includes("account")
                      ? ` Its executions in this period move from ${p.plan!.source_account} to ${account} too.` : "";
                    if (confirm(`Update the Daybook plan to the bank's?${moving}`)) fix.mutate(p);
                  }}>Use the bank&apos;s</button>
                )}
                {!p.plan && p.holding && p.typical && (
                  <button className={btn} disabled={create.isPending}
                          onClick={() => create.mutate(p)}>
                    Create plan · {fmtAmount(p.typical)} {p.cadence ?? "monthly"} from {nextRun(p)}
                  </button>
                )}
                {!p.holding && (
                  <Link href="/money/portfolio" className={btn}>Add the holding in Portfolio</Link>
                )}
              </div>
            )}
          </div>
        ))}
      </Panel>
      {(fix.error || create.error || book.error) && (
        <p className="text-xs text-rose-400 mt-2">{((fix.error || create.error || book.error) as Error).message}</p>
      )}
    </Block>
  );
}
