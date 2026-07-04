"use client";

import { fmtAmount, type MonthlyAnomalyReport } from "@/lib/money-api";

const MAX_BAR_PX = 72;

function monthLabel(month: string): string {
  const [y, m] = month.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[parseInt(m) - 1]} ${y.slice(2)}`;
}

// Whole-month outliers: expenses timeline with anomalous months marked,
// plus one card per detected anomaly (any metric).
export function MonthlyAnomalies({ data }: { data: MonthlyAnomalyReport }) {
  if (data.series.length === 0) {
    return <p className="text-xs text-[#52525B]">Not enough history yet.</p>;
  }
  const max = Math.max(...data.series.map((p) => p.expenses), 1);
  const anomalousExpenseMonths = new Set(
    data.anomalies.filter((a) => a.metric === "expenses").map((a) => a.month)
  );

  return (
    <div className="space-y-4">
      <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-4">
        <p className="text-[10px] text-[#52525B] mb-3">
          monthly expenses · <span className="text-[#EF4444]">red</span> = statistical outlier (|z| ≥ 2)
        </p>
        <div className="flex items-end gap-[2px]" style={{ height: `${MAX_BAR_PX + 16}px` }}>
          {data.series.map((p) => {
            const px = Math.max((p.expenses / max) * MAX_BAR_PX, 2);
            const isAnomaly = anomalousExpenseMonths.has(p.month);
            return (
              <div
                key={p.month}
                className="flex flex-col items-center justify-end flex-1 h-full"
                title={`${monthLabel(p.month)}: ${fmtAmount(p.expenses)} spent, ${fmtAmount(p.savings)} saved`}
              >
                <div
                  className="w-full rounded-t-sm transition-opacity hover:opacity-100"
                  style={{
                    height: `${px}px`,
                    backgroundColor: isAnomaly ? "#EF4444" : "rgba(59,130,246,0.55)",
                  }}
                />
              </div>
            );
          })}
        </div>
        <div className="flex justify-between text-[9px] text-[#3F3F46] mt-1">
          <span>{monthLabel(data.series[0].month)}</span>
          <span>{monthLabel(data.series[data.series.length - 1].month)}</span>
        </div>
      </div>

      {data.anomalies.length === 0 ? (
        <div className="bg-[#0D0D0F] border border-[#22C55E]/30 rounded-xl px-4 py-3">
          <p className="text-sm text-[#22C55E]">✓ No month-level outliers in the last {data.window_months} months</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {data.anomalies.slice(0, 6).map((a) => (
            <div
              key={`${a.month}-${a.metric}`}
              className={`bg-[#0D0D0F] border rounded-xl px-4 py-3 ${
                a.severity === "high" ? "border-[#EF4444]/40" : "border-[#F59E0B]/40"
              }`}
            >
              <div className="flex items-center justify-between">
                <p className="text-sm text-[#D4D4D8] font-medium">{monthLabel(a.month)}</p>
                <span className={`text-[9px] uppercase tracking-wider ${
                  a.severity === "high" ? "text-[#EF4444]" : "text-[#F59E0B]"
                }`}>
                  {a.severity} · z {a.z_score > 0 ? "+" : ""}{a.z_score.toFixed(1)}
                </span>
              </div>
              <p className="text-xs text-[#52525B] mt-1">
                {a.metric} {a.value >= 0 ? "" : "−"}{fmtAmount(Math.abs(a.value))}
                <span className="text-[#3F3F46]"> vs {fmtAmount(a.mean)} typical</span>
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
