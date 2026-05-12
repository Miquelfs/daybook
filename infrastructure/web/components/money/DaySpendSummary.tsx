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

  const expenses = transactions.filter(isExpense);
  const totalSpent = expenses.reduce((s, t) => s + Math.abs(t.amount), 0);

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

        {expenses.length === 0 ? (
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
              <span className="text-sm font-semibold text-[#FAFAFA]">{fmtAmount(totalSpent)}</span>
            </div>

            {/* Transaction list */}
            {expenses.map((t) => (
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
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="text-base w-6 text-center shrink-0">{emoji}</span>
      <span className="text-sm text-[#D4D4D8] flex-1 truncate">{t.name}</span>
      <span className="text-sm tabular-nums text-[#A1A1AA] shrink-0">
        -{fmtAmount(t.amount)}
      </span>
    </div>
  );
}
