"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { moneyApi, fmtAmount, type InvestmentPlan, type Holding } from "@/lib/money-api";
import { AddPlanDrawer } from "./AddPlanDrawer";

const CADENCE_LABEL: Record<string, string> = {
  weekly: "Weekly", biweekly: "Every 2 weeks",
  monthly: "Monthly", quarterly: "Quarterly", yearly: "Yearly",
};

interface Props {
  plans: InvestmentPlan[];
  holdings: Holding[];
  liquidAccounts: string[];
}

export function RecurringPlansSection({ plans, holdings, liquidAccounts }: Props) {
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const router = useRouter();

  async function pauseResume(plan: InvestmentPlan) {
    setBusy(true);
    try {
      await moneyApi.patchPlan(plan.id, { is_active: !plan.is_active });
      router.refresh();
    } finally { setBusy(false); }
  }

  async function deletePlan(plan: InvestmentPlan) {
    setBusy(true);
    try {
      await moneyApi.deletePlan(plan.id);
      setConfirmDeleteId(null);
      router.refresh();
    } finally { setBusy(false); }
  }

  async function runDue() {
    setBusy(true);
    setFlash(null);
    try {
      const res = await moneyApi.runDuePlans();
      const successCount = res.executed.filter(e => e.status === "success").length;
      setFlash(`Ran ${successCount} execution${successCount !== 1 ? "s" : ""}${res.executed.length > successCount ? ` (${res.executed.length - successCount} pending)` : ""}`);
      router.refresh();
    } catch {
      setFlash("Run failed — check logs");
    } finally {
      setBusy(false);
    }
  }

  const active = plans.filter(p => p.is_active);
  const monthlyTotal = active.reduce((s, p) => s + p.monthly_equivalent_eur, 0);

  return (
    <section className="mb-6">
      <div className="flex items-baseline justify-between mb-3 gap-3">
        <div className="flex items-baseline gap-3 min-w-0">
          <h2 className="text-xs text-[#52525B] uppercase tracking-widest">Recurring plans</h2>
          {monthlyTotal > 0 && (
            <span className="text-xs text-[#22C55E] tabular-nums whitespace-nowrap">
              {fmtAmount(monthlyTotal)}/mo equiv
            </span>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          {plans.length > 0 && (
            <button
              onClick={runDue}
              disabled={busy}
              className="text-xs font-medium px-3 py-1.5 rounded-full bg-[#3B82F6]/10 text-[#3B82F6] hover:bg-[#3B82F6]/20 transition-colors disabled:opacity-40"
              title="Execute any plans whose date has arrived"
            >
              Run due
            </button>
          )}
          <AddPlanDrawer holdings={holdings} accounts={liquidAccounts} />
        </div>
      </div>

      {flash && <p className="text-xs text-[#71717A] mb-2">{flash}</p>}

      {plans.length === 0 ? (
        <div className="border border-dashed border-[#27272A] rounded-xl px-4 py-6 text-center">
          <p className="text-xs text-[#71717A]">No recurring plans yet.</p>
          <p className="text-[10px] text-[#3F3F46] mt-1">Set up DCA once, Daybook keeps your portfolio in sync.</p>
        </div>
      ) : (
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl divide-y divide-[#18181B]">
          {plans.map(p => {
            const dueSoon = p.is_active && p.next_execution_date <= new Date(Date.now() + 3*86400_000).toISOString().slice(0, 10);
            return (
              <div key={p.id} className="px-4 py-3">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <Link
                    href={`/money/portfolio/holding/${encodeURIComponent(p.holding_id)}`}
                    className="text-sm font-medium text-[#FAFAFA] hover:text-[#22C55E]"
                  >
                    {p.ticker}
                  </Link>
                  <span className="text-xs text-[#71717A]">·</span>
                  <span className="text-xs text-[#D4D4D8] tabular-nums">{fmtAmount(p.amount_eur)}</span>
                  <span className="text-xs text-[#71717A]">·</span>
                  <span className="text-xs text-[#A1A1AA]">{CADENCE_LABEL[p.cadence] ?? p.cadence}</span>
                  {!p.is_active && <span className="text-[10px] uppercase text-[#71717A] bg-[#18181B] px-1.5 py-0.5 rounded">Paused</span>}
                </div>
                <p className="text-[11px] text-[#52525B] mt-0.5">
                  from {p.source_account} · {p.executions_count} executions ({fmtAmount(p.total_contributed_eur)} total)
                </p>
                <div className="flex items-center gap-3 mt-2">
                  <span className={`text-[11px] tabular-nums ${dueSoon ? "text-[#F59E0B]" : "text-[#71717A]"}`}>
                    Next: {p.next_execution_date}
                  </span>
                  <button
                    onClick={() => pauseResume(p)}
                    disabled={busy}
                    className="text-[11px] text-[#71717A] hover:text-[#D4D4D8] ml-auto"
                  >
                    {p.is_active ? "Pause" : "Resume"}
                  </button>
                  {confirmDeleteId === p.id ? (
                    <span className="flex items-center gap-2">
                      <button
                        onClick={() => deletePlan(p)}
                        disabled={busy}
                        className="text-[11px] text-[#EF4444] hover:text-[#FCA5A5]"
                      >
                        Confirm delete
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="text-[11px] text-[#52525B] hover:text-[#A1A1AA]"
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(p.id)}
                      disabled={busy}
                      title="Delete plan permanently — past purchases stay in the ledger"
                      className="text-[11px] text-[#3F3F46] hover:text-[#EF4444]"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
