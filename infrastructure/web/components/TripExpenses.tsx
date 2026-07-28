"use client";

import { useQuery } from "@tanstack/react-query";
import { moneyApi, fmtAmount, isExpense } from "@/lib/money-api";
import { CATEGORY_EMOJI } from "./money/CategoryPills";
import { SectionLabel } from "@/components/MorningBrief";

/** Spending + income for a trip's whole date range, from the money ledger. */
export function TripExpenses({ start, end }: { start: string; end: string }) {
  const { data: transactions = [], isError } = useQuery({
    queryKey: ["money", "range", start, end],
    queryFn: () => moneyApi.transactions({ start, end, limit: 500 }),
  });

  if (isError) return null;

  // Exclude portfolio movements + transfers — cash conversions, not spend.
  const ledger = transactions.filter(
    (t) => t.transaction_type !== "Finance" && t.transaction_type !== "Transfer"
  );
  const expenses = ledger.filter(isExpense);
  const totalSpent = expenses.reduce((s, t) => s + Math.abs(t.amount), 0);

  if (ledger.length === 0) return null;

  // Category totals, biggest first.
  const byCat = new Map<string, number>();
  for (const t of expenses) {
    const c = t.category ?? "Other";
    byCat.set(c, (byCat.get(c) ?? 0) + Math.abs(t.amount));
  }
  const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <section>
      <SectionLabel>Spending</SectionLabel>
      <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-4">
        <div className="flex items-baseline justify-between mb-3">
          <span className="text-2xl font-semibold text-[#FAFAFA] tabular-nums">{fmtAmount(totalSpent)}</span>
          <span className="text-xs text-[#52525B]">{expenses.length} expense{expenses.length === 1 ? "" : "s"}</span>
        </div>
        <div className="flex flex-col gap-1.5">
          {cats.map(([cat, amount]) => {
            const pct = totalSpent > 0 ? (amount / totalSpent) * 100 : 0;
            return (
              <div key={cat} className="flex items-center gap-2">
                <span className="text-sm w-5 text-center shrink-0">{CATEGORY_EMOJI[cat] ?? "💳"}</span>
                <span className="text-xs text-[#D4D4D8] flex-1 truncate">{cat}</span>
                <div className="w-20 h-1.5 rounded-full bg-[#27272A] shrink-0">
                  <div className="h-full rounded-full bg-[#F59E0B]" style={{ width: `${Math.max(pct, 2)}%` }} />
                </div>
                <span className="text-xs text-[#A1A1AA] tabular-nums w-14 text-right shrink-0">{fmtAmount(amount)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
