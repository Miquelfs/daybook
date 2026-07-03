"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { moneyApi, fmtAmount } from "@/lib/money-api";
import { CATEGORY_EMOJI } from "./CategoryPills";

export function CategoryStatsTable() {
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["money", "category-stats"],
    queryFn: () => moneyApi.categoryStats(),
  });

  if (isLoading) return <div className="h-32 bg-[#0D0D0F] rounded-xl animate-pulse" />;
  if (!data || data.length === 0) return <p className="text-xs text-[#52525B]">No category data.</p>;

  return (
    <div className="flex flex-col divide-y divide-[#18181B]">
      {data.map((cat) => {
        const isOpen = expanded === cat.category;
        const hasSubs = cat.subcategories.length > 0;
        return (
          <div key={cat.category} className="py-3">
            <button
              className="w-full text-left"
              onClick={() => setExpanded(isOpen ? null : cat.category)}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-base w-5 text-center">{CATEGORY_EMOJI[cat.category] ?? "📦"}</span>
                  <span className="text-sm text-[#D4D4D8]">{cat.category}</span>
                  {hasSubs && (
                    <span className="text-[10px] text-[#3F3F46]">{isOpen ? "▲" : "▼"}</span>
                  )}
                </div>
                <span className="text-sm font-semibold tabular-nums text-[#FAFAFA]">{fmtAmount(cat.total)}</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-[#52525B] tabular-nums">
                <span>{fmtAmount(cat.avg_per_month)}/mo</span>
                <span className="text-[#3F3F46]">·</span>
                <span>{cat.count} txns</span>
                <span className="text-[#3F3F46]">·</span>
                <span>{cat.pct_of_total.toFixed(1)}% of total</span>
              </div>
              <div className="mt-1.5 h-1 rounded-full bg-[#18181B]">
                <div
                  className="h-full rounded-full bg-[#3B82F6]/60"
                  style={{ width: `${Math.min(cat.pct_of_total * 2, 100)}%` }}
                />
              </div>
            </button>

            {/* Subcategory breakdown */}
            {isOpen && hasSubs && (
              <div className="mt-2 ml-7 flex flex-col gap-1">
                {cat.subcategories.map((s) => (
                  <div key={s.subcategory} className="flex items-center justify-between">
                    <span className="text-xs text-[#71717A]">{s.subcategory}</span>
                    <div className="flex items-center gap-2 tabular-nums">
                      <span className="text-[10px] text-[#52525B]">{s.count}×</span>
                      <span className="text-xs text-[#A1A1AA]">{fmtAmount(s.total)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Link to category detail */}
            {isOpen && (
              <Link
                href={`/money/category/${encodeURIComponent(cat.category)}`}
                className="mt-2 ml-7 text-[10px] text-[#F59E0B] hover:text-[#FCD34D] transition-colors inline-block"
              >
                View transactions →
              </Link>
            )}
          </div>
        );
      })}
    </div>
  );
}
