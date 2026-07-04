"use client";

import { fmtAmount, type DailyTotal } from "@/lib/money-api";

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Weeks × weekdays heat grid of daily spend for one month.
// Single-hue sequential fill: brighter blue = more spent.
export function MonthHeatGrid({ days, month }: { days: DailyTotal[]; month: string }) {
  if (days.length === 0) {
    return <p className="text-xs text-[#52525B]">No data.</p>;
  }
  const today = new Date().toISOString().slice(0, 10);
  const max = Math.max(...days.map((d) => d.total_spend), 1);

  // Pad to a Monday start so weekday columns align.
  const firstDow = (new Date(days[0].date + "T00:00:00").getDay() + 6) % 7;
  const cells: (DailyTotal | null)[] = [...Array(firstDow).fill(null), ...days];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (DailyTotal | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  return (
    <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-4">
      <div className="grid grid-cols-7 gap-[2px] mb-1">
        {DOW.map((d) => (
          <span key={d} className="text-[9px] text-[#52525B] text-center">{d}</span>
        ))}
      </div>
      <div className="flex flex-col gap-[2px]">
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 gap-[2px]">
            {week.map((day, di) => {
              if (!day) return <div key={di} className="aspect-[2/1]" />;
              const future = day.date > today;
              const alpha = day.total_spend > 0 ? 0.15 + 0.85 * (day.total_spend / max) : 0;
              return (
                <div
                  key={day.date}
                  className={`aspect-[2/1] rounded-sm ${future ? "" : "bg-[#18181B]"}`}
                  style={alpha > 0 ? { backgroundColor: `rgba(59,130,246,${alpha.toFixed(2)})` } : undefined}
                  title={future ? day.date : `${day.date}: ${fmtAmount(day.total_spend)}`}
                />
              );
            })}
          </div>
        ))}
      </div>
      <p className="text-[10px] text-[#3F3F46] mt-2">
        brighter = more spent · peak day {fmtAmount(max)} · {month}
      </p>
    </div>
  );
}
