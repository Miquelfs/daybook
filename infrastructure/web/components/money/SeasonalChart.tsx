"use client";

import { fmtAmount, type SeasonalData } from "@/lib/money-api";

const MAX_BAR_PX = 88;

// Average spend by calendar month across all completed history.
export function SeasonalChart({ data }: { data: SeasonalData }) {
  const withData = data.months.filter((m) => m.n_years > 0);
  if (withData.length === 0) {
    return <p className="text-xs text-[#52525B]">Not enough history yet.</p>;
  }
  const max = Math.max(...withData.map((m) => m.avg_expenses), 1);

  return (
    <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-4">
      <div className="flex items-end gap-[3px]" style={{ height: `${MAX_BAR_PX + 34}px` }}>
        {data.months.map((m) => {
          const px = m.n_years > 0 ? Math.max((m.avg_expenses / max) * MAX_BAR_PX, 3) : 0;
          const isHi = m.label === data.most_expensive;
          const isLo = m.label === data.cheapest;
          return (
            <div
              key={m.month_num}
              className="flex flex-col items-center justify-end gap-1 flex-1 h-full"
              title={m.n_years > 0 ? `${m.label}: ${fmtAmount(m.avg_expenses)} avg (${m.n_years} mo)` : `${m.label}: no history`}
            >
              {/* Direct labels only on the extremes */}
              {(isHi || isLo) && m.n_years > 0 && (
                <span className={`text-[9px] tabular-nums ${isHi ? "text-[#FAFAFA]" : "text-[#71717A]"}`}>
                  {Math.round(m.avg_expenses)}
                </span>
              )}
              {m.n_years > 0 ? (
                <div
                  className="w-full rounded-t-sm transition-colors"
                  style={{
                    height: `${px}px`,
                    backgroundColor: isHi ? "#3B82F6" : "rgba(59,130,246,0.55)",
                  }}
                />
              ) : (
                <div className="w-full border-t border-dashed border-[#27272A]" />
              )}
              <span className={`text-[9px] ${isHi || isLo ? "text-[#A1A1AA]" : "text-[#52525B]"}`}>
                {m.label}
              </span>
            </div>
          );
        })}
      </div>
      {data.most_expensive && data.cheapest && (
        <p className="text-xs text-[#52525B] mt-3">
          typically expensive: <span className="text-[#A1A1AA]">{data.most_expensive}</span>
          {" · "}cheapest: <span className="text-[#A1A1AA]">{data.cheapest}</span>
        </p>
      )}
    </div>
  );
}
