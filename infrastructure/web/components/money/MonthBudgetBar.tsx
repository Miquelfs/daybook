"use client";

import type { CategoryBudget } from "@/lib/money-api";
import { CATEGORY_EMOJI } from "./CategoryPills";

interface Props {
  item: CategoryBudget;
}

export function MonthBudgetBar({ item }: Props) {
  const pct = item.budget > 0 ? Math.min((item.spent / item.budget) * 100, 100) : 0;
  const overBudget = item.spent > item.budget && item.budget > 0;
  const overPace = item.status === "Over Pace";

  const barColor = overBudget
    ? "bg-[#EF4444]"
    : overPace
    ? "bg-[#F59E0B]"
    : "bg-[#3B82F6]";

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <span>{CATEGORY_EMOJI[item.category] ?? "💳"}</span>
          <span className="text-[#D4D4D8]">{item.category}</span>
        </div>
        <div className="flex items-center gap-2 tabular-nums text-xs">
          <span className={overBudget ? "text-[#EF4444]" : "text-[#A1A1AA]"}>
            €{item.spent.toFixed(0)}
          </span>
          {item.budget > 0 && (
            <span className="text-[#3F3F46]">/ €{item.budget.toFixed(0)}</span>
          )}
        </div>
      </div>
      {item.budget > 0 && (
        <div className="h-1.5 rounded-full bg-[#18181B]">
          <div
            className={`h-full rounded-full transition-all ${barColor}`}
            style={{ width: `${Math.max(pct, 2)}%` }}
          />
        </div>
      )}
    </div>
  );
}
