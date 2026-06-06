"use client";

import { useQuery } from "@tanstack/react-query";
import { moneyApi, fmtAmount } from "@/lib/money-api";

export function CategoryStatsTable() {
  const { data, isLoading } = useQuery({
    queryKey: ["money", "category-stats"],
    queryFn: () => moneyApi.categoryStats(),
  });

  if (isLoading) return <div className="h-32 bg-[#0D0D0F] rounded-xl animate-pulse" />;
  if (!data || data.length === 0) return <p className="text-xs text-[#52525B]">No category data.</p>;

  return (
    <div className="flex flex-col divide-y divide-[#18181B]">
      {data.map((cat) => (
        <div key={cat.category} className="py-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-[#D4D4D8]">{cat.category}</span>
            <span className="text-sm font-semibold tabular-nums text-[#FAFAFA]">{fmtAmount(cat.total)}</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-[#52525B] tabular-nums">
            <span>{fmtAmount(cat.avg_per_month)}/mo</span>
            <span className="text-[#3F3F46]">·</span>
            <span>{cat.count} txns</span>
            <span className="text-[#3F3F46]">·</span>
            <span>{cat.pct_of_total.toFixed(1)}% of total</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-[#3F3F46] tabular-nums mt-0.5">
            <span>min {fmtAmount(cat.min_tx)}</span>
            <span className="text-[#27272A]">·</span>
            <span>max {fmtAmount(cat.max_tx)}</span>
          </div>
          <div className="mt-1.5 h-1 rounded-full bg-[#18181B]">
            <div className="h-full rounded-full bg-[#3B82F6]/60" style={{ width: `${Math.min(cat.pct_of_total * 2, 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
