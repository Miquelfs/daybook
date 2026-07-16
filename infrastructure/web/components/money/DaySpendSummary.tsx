"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { moneyApi, fmtAmount, isExpense, type Transaction } from "@/lib/money-api";
import { AddExpenseSheet } from "./AddExpenseSheet";
import { CATEGORY_EMOJI } from "./CategoryPills";
import { SectionLabel } from "@/components/MorningBrief";

interface Props {
  date: string;
}

export function DaySpendSummary({ date }: Props) {
  const [sheetOpen, setSheetOpen] = useState(false);

  const { data: transactions = [], isError: txnError } = useQuery({
    queryKey: ["money", "day", date],
    queryFn: () => moneyApi.transactions({ start: date, end: date, limit: 50 }),
  });

  const { data: meta, isError: metaError } = useQuery({
    queryKey: ["money", "meta"],
    queryFn: () => moneyApi.meta(),
  });

  // If money.db isn't initialized or API is down, render nothing silently
  if (txnError || metaError) return null;
  if (!meta) return null;

  // Portfolio movements (sells, DCA buys) and transfers are cash conversions,
  // not spending or income — keep them out of the day's totals. A sale's
  // proceeds are not a gain; the gain/loss lives in the portfolio's
  // "Realized gains" section.
  const ledger = transactions.filter(
    (t) => t.transaction_type !== "Finance" && t.transaction_type !== "Transfer"
  );
  const expenses = ledger.filter(isExpense);
  const incomes = ledger.filter((t) => !isExpense(t));
  const totalSpent = expenses.reduce((s, t) => s + Math.abs(t.amount), 0);
  const totalIncome = incomes.reduce((s, t) => s + t.amount, 0);
  const net = totalIncome - totalSpent;

  return (
    <>
      <section>
        <div className="flex items-center justify-between mb-3">
          <SectionLabel>Money</SectionLabel>
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="flex items-center gap-1 text-xs text-[#F59E0B] hover:text-[#FCD34D] transition-colors"
          >
            <Plus size={14} />
            Add
          </button>
        </div>

        {transactions.length === 0 ? (
          <div className="border border-dashed border-[#27272A] rounded-lg px-4 py-5 text-center">
            <p className="text-sm text-[#52525B]">No expenses today</p>
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              className="mt-2 text-xs text-[#F59E0B] hover:text-[#FCD34D] transition-colors"
            >
              + Add first expense
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {/* Total */}
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm text-[#71717A]">Total spent</span>
              <span className={`text-sm font-semibold ${net >= 0 ? "text-[#22C55E]" : "text-[#FAFAFA]"}`}>
                {net >= 0 ? "+" : ""}{fmtAmount(Math.abs(net))}
              </span>
            </div>

            {/* Transaction list — all transactions, correct sign */}
            {transactions.map((t) => (
              <TransactionRow key={t.id} t={t} />
            ))}
          </div>
        )}
      </section>

      {meta && (
        <AddExpenseSheet
          date={date}
          isOpen={sheetOpen}
          onClose={() => setSheetOpen(false)}
          meta={meta}
        />
      )}
    </>
  );
}

function TransactionRow({ t }: { t: Transaction }) {
  const emoji = CATEGORY_EMOJI[t.category ?? ""] ?? "💳";
  const isPositive = t.amount >= 0;
  // Sells/DCA buys and transfers move money between pockets — render them
  // muted and never green, so proceeds don't read as gains.
  const neutral = t.transaction_type === "Finance" || t.transaction_type === "Transfer";
  return (
    <div className={`flex items-center gap-3 py-1.5 ${neutral ? "opacity-60" : ""}`}>
      <span className="text-base w-6 text-center shrink-0">{emoji}</span>
      <span className="text-sm text-[#D4D4D8] flex-1 truncate">{t.name}</span>
      {neutral && (
        <span className="text-[9px] uppercase tracking-widest text-[#71717A] shrink-0">
          {t.transaction_type === "Finance" ? "portfolio" : "transfer"}
        </span>
      )}
      <span className={`text-sm tabular-nums shrink-0 ${neutral ? "text-[#A1A1AA]" : isPositive ? "text-[#22C55E]" : "text-[#A1A1AA]"}`}>
        {isPositive ? "+" : "-"}{fmtAmount(t.amount)}
      </span>
    </div>
  );
}
