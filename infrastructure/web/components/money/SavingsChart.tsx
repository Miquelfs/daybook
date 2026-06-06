"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { moneyApi, fmtAmount } from "@/lib/money-api";

type View = "absolute" | "rate";

export function SavingsChart() {
  const [view, setView] = useState<View>("absolute");

  const { data, isLoading } = useQuery({
    queryKey: ["money", "trends"],
    queryFn: () => moneyApi.trends(24),
  });

  if (isLoading) return <div className="h-48 bg-[#0D0D0F] rounded-xl animate-pulse" />;
  if (!data || data.months.length === 0) return <p className="text-xs text-[#52525B]">No data.</p>;

  // Oldest → newest (left → right)
  const months = [...data.months];
  const maxAbs = Math.max(...months.map((m) => Math.abs(m.savings)), 1);
  const maxRate = Math.max(...months.map((m) => Math.abs(m.savings_rate * 100)), 1);

  // 3-month rolling average of savings (computed on the ordered array)
  const withRolling = months.map((m, i) => {
    const window = months.slice(Math.max(0, i - 2), i + 1);
    const avg = window.reduce((s, w) => s + w.savings, 0) / window.length;
    return { ...m, rolling3: avg };
  });

  const bars = withRolling.map((m) => {
    const isAbsolute = view === "absolute";
    const rawValue = isAbsolute ? m.savings : m.savings_rate * 100;
    const maxRange = isAbsolute ? maxAbs : maxRate;
    const positive = rawValue >= 0;
    const pct = Math.min((Math.abs(rawValue) / maxRange) * 100, 100);

    let barColor: string;
    if (!positive) {
      barColor = "bg-[#EF4444]/80 hover:bg-[#EF4444]";
    } else if (isAbsolute) {
      barColor = "bg-[#22C55E]/80 hover:bg-[#22C55E]";
    } else {
      // rate-based coloring
      barColor = pct >= 30
        ? "bg-[#22C55E]/80 hover:bg-[#22C55E]"
        : pct >= 15
        ? "bg-[#F59E0B]/80 hover:bg-[#F59E0B]"
        : "bg-[#EF4444]/80 hover:bg-[#EF4444]";
    }

    const label = new Date(m.month + "-15").toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
    const tooltip = isAbsolute
      ? `${label}: ${positive ? "+" : "−"}${fmtAmount(Math.abs(rawValue))}`
      : `${label}: ${rawValue.toFixed(1)}%`;

    return { ...m, rawValue, positive, pct, barColor, label, tooltip };
  });

  return (
    <div className="space-y-6">
      {/* Toggle */}
      <div className="flex gap-1 bg-[#18181B] rounded-lg p-0.5 w-fit">
        {(["absolute", "rate"] as View[]).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
              view === v
                ? "bg-[#27272A] text-[#FAFAFA]"
                : "text-[#52525B] hover:text-[#A1A1AA]"
            }`}
          >
            {v === "absolute" ? "€ Savings" : "Rate %"}
          </button>
        ))}
      </div>

      {/* Combined bar chart */}
      <div>
        <div className="overflow-x-auto -mx-1 px-1">
          <div className="flex items-center gap-1 min-w-max" style={{ height: 80 }}>
            {bars.map((b) => (
              <div key={b.month} className="flex flex-col items-center w-8 h-full">
                {b.positive ? (
                  <>
                    <div className="flex-1 flex items-end w-full">
                      <div
                        className={`w-full rounded-t transition-colors ${b.barColor}`}
                        style={{ height: `${Math.max(b.pct, 3)}%` }}
                        title={b.tooltip}
                      />
                    </div>
                    <div className="h-px w-full bg-[#27272A]" />
                    <div className="flex-1 w-full" />
                  </>
                ) : (
                  <>
                    <div className="flex-1 w-full" />
                    <div className="h-px w-full bg-[#27272A]" />
                    <div className="flex-1 flex items-start w-full">
                      <div
                        className={`w-full rounded-b transition-colors ${b.barColor}`}
                        style={{ height: `${Math.max(b.pct, 3)}%` }}
                        title={b.tooltip}
                      />
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
          <div className="flex items-end gap-1 min-w-max mt-0.5">
            {bars.map((b) => (
              <div key={b.month} className="w-8 text-center">
                <span className="text-[9px] text-[#3F3F46]">{b.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 mt-2">
          <span className="flex items-center gap-1 text-xs text-[#52525B]">
            <span className="w-2 h-2 rounded-sm bg-[#22C55E]/80 inline-block" />
            {view === "absolute" ? "Surplus" : "≥30%"}
          </span>
          {view === "rate" && (
            <span className="flex items-center gap-1 text-xs text-[#52525B]">
              <span className="w-2 h-2 rounded-sm bg-[#F59E0B]/80 inline-block" /> 15–30%
            </span>
          )}
          <span className="flex items-center gap-1 text-xs text-[#52525B]">
            <span className="w-2 h-2 rounded-sm bg-[#EF4444]/80 inline-block" />
            {view === "absolute" ? "Deficit" : "<15% or deficit"}
          </span>
        </div>
      </div>

      {/* 3-month rolling averages table — income, expenses, savings for last 6 months */}
      <div>
        <p className="text-xs text-[#52525B] uppercase tracking-widest mb-3">3-month rolling averages (last 6 months)</p>
        <div className="flex flex-col">
          {withRolling.slice(-6).map((m, i) => {
            const window = withRolling.slice(Math.max(0, withRolling.length - 6 + i - 2), withRolling.length - 6 + i + 1);
            const rollIncome = window.reduce((s, w) => s + w.total_income, 0) / window.length;
            const rollSpent = window.reduce((s, w) => s + w.total_spent, 0) / window.length;
            const label = new Date(m.month + "-15").toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
            return (
              <div key={m.month} className="border-b border-[#18181B] py-2">
                <p className="text-xs text-[#A1A1AA] mb-1.5">{label}</p>
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center text-xs tabular-nums">
                    <span className="text-[#22C55E]/70 w-16">Income</span>
                    <span className="text-[#22C55E] flex-1">{fmtAmount(m.total_income)}</span>
                    <span className="text-[#3F3F46] text-[9px] mr-1">3-mo avg</span>
                    <span className="text-[#22C55E]/60 w-20 text-right">{fmtAmount(rollIncome)}</span>
                  </div>
                  <div className="flex items-center text-xs tabular-nums">
                    <span className="text-[#EF4444]/70 w-16">Expenses</span>
                    <span className="text-[#EF4444]">{fmtAmount(m.total_spent)}</span>
                    <span className="flex-1" />
                    <span className="text-[#3F3F46] text-[9px] mr-1">3-mo avg</span>
                    <span className="text-[#EF4444]/60 w-20 text-right">{fmtAmount(rollSpent)}</span>
                  </div>
                  <div className="flex items-center text-xs tabular-nums">
                    <span className="text-[#71717A] w-16">Savings</span>
                    <span className={m.savings >= 0 ? "text-[#22C55E]" : "text-[#EF4444]"}>
                      {m.savings >= 0 ? "+" : "−"}{fmtAmount(Math.abs(m.savings))}
                    </span>
                    <span className="flex-1" />
                    <span className="text-[#3F3F46] text-[9px] mr-1">3-mo avg</span>
                    <span className={`w-20 text-right ${m.rolling3 >= 0 ? "text-[#22C55E]/60" : "text-[#EF4444]/60"}`}>
                      {m.rolling3 >= 0 ? "+" : "−"}{fmtAmount(Math.abs(m.rolling3))}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
