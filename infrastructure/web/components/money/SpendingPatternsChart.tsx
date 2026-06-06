"use client";

import { useQuery } from "@tanstack/react-query";
import { moneyApi, fmtAmount } from "@/lib/money-api";

const MAX_BAR_PX = 72;

export function SpendingPatternsChart() {
  const { data, isLoading } = useQuery({
    queryKey: ["money", "spending-patterns"],
    queryFn: () => moneyApi.spendingPatterns(),
  });

  if (isLoading) return <div className="h-32 bg-[#0D0D0F] rounded-xl animate-pulse" />;
  if (!data || data.by_day.length === 0) return <p className="text-xs text-[#52525B]">No pattern data.</p>;

  const maxDay = Math.max(...data.by_day.map((d) => d.total), 1);

  return (
    <div className="space-y-6">
      {/* Day of week bars — fixed pixel heights so bars are always visible */}
      <div>
        <p className="text-xs text-[#52525B] uppercase tracking-widest mb-3">By day of week</p>
        <div className="flex items-end gap-2" style={{ height: `${MAX_BAR_PX + 20}px` }}>
          {data.by_day.map((d) => {
            const px = Math.max((d.total / maxDay) * MAX_BAR_PX, d.total > 0 ? 3 : 0);
            return (
              <div key={d.day_name} className="flex flex-col items-center gap-1 flex-1">
                <div
                  className="w-full rounded-t bg-[#3B82F6]/60 hover:bg-[#3B82F6] transition-colors"
                  style={{ height: `${px}px` }}
                  title={fmtAmount(d.total)}
                />
                <span className="text-[9px] text-[#52525B]">{d.day_name.slice(0, 3)}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Week totals */}
      {data.by_week.length > 0 && (
        <div>
          <p className="text-xs text-[#52525B] uppercase tracking-widest mb-3">By week this month</p>
          <div className="flex flex-col divide-y divide-[#18181B]">
            {data.by_week.map((w) => (
              <div key={w.week_num} className="flex items-center justify-between py-2 text-xs">
                <span className="text-[#71717A]">Week {w.week_num}</span>
                <span className="text-[#A1A1AA] tabular-nums">{fmtAmount(w.total)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
