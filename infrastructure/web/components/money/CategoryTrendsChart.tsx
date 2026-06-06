"use client";

import { useQuery } from "@tanstack/react-query";
import { moneyApi, fmtAmount } from "@/lib/money-api";
import { CATEGORY_EMOJI } from "./CategoryPills";

const PALETTE: Record<string, string> = {
  Restaurant:     "#F59E0B",
  Groceries:      "#10B981",
  Transportation: "#3B82F6",
  Home:           "#8B5CF6",
  Sports:         "#06B6D4",
  Trips:          "#F97316",
  Tech:           "#6366F1",
  Gifts:          "#EC4899",
  Personal:       "#84CC16",
  Alert:          "#EF4444",
};
const FALLBACK = "#52525B";

export function CategoryTrendsChart() {
  const { data, isLoading } = useQuery({
    queryKey: ["money", "categoryTrends"],
    queryFn: () => moneyApi.categoryTrends(12),
  });

  if (isLoading) return <p className="text-sm text-[#52525B] py-4 text-center">Loading…</p>;
  if (!data || data.months.length === 0) return (
    <p className="text-sm text-[#52525B] py-4 text-center">No historical data yet</p>
  );

  // Build lookup: month → { category → spent }
  const byMonth: Record<string, Record<string, number>> = {};
  for (const item of data.items) {
    if (!byMonth[item.month]) byMonth[item.month] = {};
    byMonth[item.month][item.category] = item.spent;
  }

  const maxTotal = Math.max(
    ...data.months.map((m) =>
      Object.values(byMonth[m] ?? {}).reduce((a, b) => a + b, 0)
    ),
    1
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {data.categories.map((cat) => (
          <div key={cat} className="flex items-center gap-1.5 text-xs text-[#71717A]">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: PALETTE[cat] ?? FALLBACK }}
            />
            {CATEGORY_EMOJI[cat] ?? "💳"} {cat}
          </div>
        ))}
      </div>

      {/* Bars */}
      <div className="flex flex-col gap-2">
        {data.months.map((month) => {
          const cats = byMonth[month] ?? {};
          const total = Object.values(cats).reduce((a, b) => a + b, 0);
          const label = new Date(month + "-15").toLocaleDateString("en-GB", {
            month: "short",
            year: "2-digit",
          });

          return (
            <div key={month} className="flex items-center gap-3">
              <span className="text-xs text-[#52525B] w-10 shrink-0">{label}</span>
              <div className="flex-1 flex h-5 rounded-full overflow-hidden bg-[#18181B]">
                {data.categories.map((cat) => {
                  const spent = cats[cat] ?? 0;
                  if (spent === 0) return null;
                  const pct = (spent / maxTotal) * 100;
                  return (
                    <div
                      key={cat}
                      title={`${cat}: ${fmtAmount(spent)}`}
                      style={{
                        width: `${pct}%`,
                        background: PALETTE[cat] ?? FALLBACK,
                      }}
                    />
                  );
                })}
              </div>
              <span className="text-xs text-[#52525B] tabular-nums w-16 text-right shrink-0">
                {fmtAmount(total)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
