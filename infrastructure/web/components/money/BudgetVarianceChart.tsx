"use client";

import { useQuery } from "@tanstack/react-query";
import { moneyApi, fmtAmount } from "@/lib/money-api";

export function BudgetVarianceChart({ month }: { month?: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["money", "overview", month],
    queryFn: () => moneyApi.monthOverview(month),
  });

  if (isLoading) return <div className="h-24 bg-[#0D0D0F] rounded-xl animate-pulse" />;
  if (!data) return null;

  const budgeted = data.categories.filter((c) => c.budget > 0);
  if (budgeted.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {budgeted.map((cat) => {
        const pct = Math.min((cat.spent / cat.budget) * 100, 150); // cap at 150% for display
        const overBudget = cat.spent > cat.budget;
        const overPace = cat.status === "Over Pace";
        const barColor = overBudget
          ? "bg-[#EF4444]"
          : overPace
          ? "bg-[#F59E0B]"
          : "bg-[#22C55E]";

        return (
          <div key={cat.category}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-[#A1A1AA]">{cat.category}</span>
              <div className="flex items-center gap-2 tabular-nums">
                <span className={overBudget ? "text-[#EF4444]" : "text-[#52525B]"}>
                  {fmtAmount(cat.spent)}
                </span>
                <span className="text-[#3F3F46]">/ {fmtAmount(cat.budget)}</span>
                <span className={`w-10 text-right font-medium ${overBudget ? "text-[#EF4444]" : overPace ? "text-[#F59E0B]" : "text-[#22C55E]"}`}>
                  {pct.toFixed(0)}%
                </span>
              </div>
            </div>
            <div className="h-1.5 rounded-full bg-[#18181B] relative overflow-visible">
              <div
                className={`h-full rounded-full transition-all ${barColor}`}
                style={{ width: `${Math.min(pct * (100 / 150), 100)}%` }}
              />
              {/* 100% marker */}
              <div
                className="absolute top-0 bottom-0 w-px bg-[#52525B]/50"
                style={{ left: `${100 / 1.5}%` }}
              />
            </div>
          </div>
        );
      })}
      <p className="text-[9px] text-[#3F3F46] mt-1">Bar extends to 150% max · line marks 100% (budget limit)</p>
    </div>
  );
}
