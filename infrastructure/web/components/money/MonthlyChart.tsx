"use client";

import { useQuery } from "@tanstack/react-query";
import { moneyApi, fmtAmount } from "@/lib/money-api";

export function MonthlyChart() {
  const { data, isLoading } = useQuery({
    queryKey: ["money", "historical"],
    queryFn: () => moneyApi.historicalTrends(24),
  });

  if (isLoading) return <div className="h-48 bg-[#0D0D0F] rounded-xl animate-pulse" />;
  if (!data || data.months.length === 0) return <p className="text-xs text-[#52525B]">No historical data.</p>;

  // Oldest → newest (left → right)
  const months = [...data.months];
  const maxVal = Math.max(...months.map((m) => Math.max(m.income, m.spent)), 1);

  return (
    <div className="space-y-4">
      {/* Averages */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-3 py-3 text-center">
          <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Avg income</p>
          <p className="text-base font-semibold text-[#22C55E] tabular-nums">{fmtAmount(data.avg_monthly_income)}</p>
        </div>
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-3 py-3 text-center">
          <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Avg spent</p>
          <p className="text-base font-semibold text-[#EF4444] tabular-nums">{fmtAmount(data.avg_monthly_spent)}</p>
        </div>
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-3 py-3 text-center">
          <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Avg save</p>
          <p className={`text-base font-semibold tabular-nums ${data.avg_savings_rate >= 0 ? "text-[#22C55E]" : "text-[#EF4444]"}`}>
            {Math.round(data.avg_savings_rate * 100)}%
          </p>
        </div>
      </div>

      {/* Bar chart: income vs expenses per month, oldest → newest */}
      <div className="overflow-x-auto -mx-1 px-1">
        <div className="flex items-end gap-1 h-32 min-w-max">
          {months.map((m) => {
            const incomePct = (m.income / maxVal) * 100;
            const spentPct = (m.spent / maxVal) * 100;
            const label = new Date(m.month + "-15").toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
            return (
              <div key={m.month} className="flex flex-col items-center gap-0.5 w-8">
                <div className="flex items-end gap-0.5 h-24">
                  <div
                    className="w-3 rounded-t bg-[#22C55E]/70 hover:bg-[#22C55E] transition-colors"
                    style={{ height: `${Math.max(incomePct, 2)}%` }}
                    title={`Income: ${fmtAmount(m.income)}`}
                  />
                  <div
                    className="w-3 rounded-t bg-[#EF4444]/70 hover:bg-[#EF4444] transition-colors"
                    style={{ height: `${Math.max(spentPct, 2)}%` }}
                    title={`Spent: ${fmtAmount(m.spent)}`}
                  />
                </div>
                <span className="text-[9px] text-[#52525B]">{label}</span>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-4 mt-2">
          <span className="flex items-center gap-1 text-xs text-[#52525B]">
            <span className="w-2 h-2 rounded-sm bg-[#22C55E]/70 inline-block" /> Income
          </span>
          <span className="flex items-center gap-1 text-xs text-[#52525B]">
            <span className="w-2 h-2 rounded-sm bg-[#EF4444]/70 inline-block" /> Expenses
          </span>
        </div>
      </div>

      {/* MoM deltas table — last 6 months, oldest first */}
      <div className="mt-4">
        <p className="text-xs text-[#52525B] uppercase tracking-widest mb-2">Month-over-month</p>
        <div className="flex items-center py-1 gap-2 text-[9px] text-[#3F3F46] uppercase tracking-widest border-b border-[#18181B]">
          <span className="w-10 shrink-0" />
          <span className="flex-1">Spent</span>
          <span className="w-14 text-right">Exp Δ</span>
          <span className="w-6 text-center" />
          <span className="w-14 text-right">Inc Δ</span>
        </div>
        <div className="flex flex-col divide-y divide-[#18181B]">
          {months.slice(-6).map((m) => {
            const label = new Date(m.month + "-15").toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
            return (
              <div key={m.month} className="flex items-center py-2 gap-2 text-xs tabular-nums">
                <span className="text-[#A1A1AA] w-10 shrink-0">{label}</span>
                <span className="flex-1 text-[#52525B]">{fmtAmount(m.spent)}</span>
                {m.mom_expenses_pct !== null ? (
                  <span className={`w-14 text-right ${m.mom_expenses_pct > 0 ? "text-[#EF4444]" : "text-[#22C55E]"}`}>
                    {m.mom_expenses_pct > 0 ? "+" : ""}{m.mom_expenses_pct.toFixed(1)}%
                  </span>
                ) : (
                  <span className="w-14 text-right text-[#3F3F46]">—</span>
                )}
                <span className="text-[#3F3F46] w-6 text-center">·</span>
                {m.mom_income_pct !== null ? (
                  <span className={`w-14 text-right ${m.mom_income_pct >= 0 ? "text-[#22C55E]" : "text-[#EF4444]"}`}>
                    {m.mom_income_pct > 0 ? "+" : ""}{m.mom_income_pct.toFixed(1)}%
                  </span>
                ) : (
                  <span className="w-14 text-right text-[#3F3F46]">—</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* YoY table — last 12 months with year-over-year comparison */}
      {months.some((m) => m.yoy_expenses_pct !== null) && (
        <div className="mt-4">
          <p className="text-xs text-[#52525B] uppercase tracking-widest mb-2">Year-over-year</p>
          <div className="flex items-center py-1 gap-2 text-[9px] text-[#3F3F46] uppercase tracking-widest border-b border-[#18181B]">
            <span className="w-10 shrink-0" />
            <span className="flex-1">Spent</span>
            <span className="w-14 text-right">Exp vs YoY</span>
            <span className="w-6 text-center" />
            <span className="w-14 text-right">Inc vs YoY</span>
          </div>
          <div className="flex flex-col divide-y divide-[#18181B]">
            {months.filter((m) => m.yoy_expenses_pct !== null || m.yoy_income_pct !== null).map((m) => {
              const label = new Date(m.month + "-15").toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
              return (
                <div key={m.month} className="flex items-center py-2 gap-2 text-xs tabular-nums">
                  <span className="text-[#A1A1AA] w-10 shrink-0">{label}</span>
                  <span className="flex-1 text-[#52525B]">{fmtAmount(m.spent)}</span>
                  {m.yoy_expenses_pct !== null ? (
                    <span className={`w-14 text-right ${m.yoy_expenses_pct > 0 ? "text-[#EF4444]" : "text-[#22C55E]"}`}>
                      {m.yoy_expenses_pct > 0 ? "+" : ""}{m.yoy_expenses_pct.toFixed(1)}%
                    </span>
                  ) : (
                    <span className="w-14 text-right text-[#3F3F46]">—</span>
                  )}
                  <span className="text-[#3F3F46] w-6 text-center">·</span>
                  {m.yoy_income_pct !== null ? (
                    <span className={`w-14 text-right ${m.yoy_income_pct >= 0 ? "text-[#22C55E]" : "text-[#EF4444]"}`}>
                      {m.yoy_income_pct > 0 ? "+" : ""}{m.yoy_income_pct.toFixed(1)}%
                    </span>
                  ) : (
                    <span className="w-14 text-right text-[#3F3F46]">—</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
