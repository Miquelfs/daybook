"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { CategoryBudget } from "@/lib/money-api";
import { CATEGORY_EMOJI } from "./CategoryPills";

interface Props {
  item: CategoryBudget;
}

export function MonthBudgetBar({ item }: Props) {
  const searchParams = useSearchParams();
  const month = searchParams.get("month") ?? "";
  const pct = item.budget > 0 ? Math.min((item.spent / item.budget) * 100, 100) : 0;
  const overBudget = item.spent > item.budget && item.budget > 0;
  const overPace = item.status === "Over Pace";

  const barColor = overBudget
    ? "bg-[#EF4444]"
    : overPace
    ? "bg-[#F59E0B]"
    : "bg-[#3B82F6]";

  const href = `/money/category/${encodeURIComponent(item.category)}${month ? `?month=${month}` : ""}`;

  return (
    <Link href={href} className="flex flex-col gap-1 group">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <span>{CATEGORY_EMOJI[item.category] ?? "💳"}</span>
          <span className="text-[#D4D4D8] group-hover:text-[#FAFAFA] transition-colors">{item.category}</span>
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
    </Link>
  );
}
