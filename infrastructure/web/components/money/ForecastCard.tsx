"use client";

import { useQuery } from "@tanstack/react-query";
import { moneyApi, fmtAmount } from "@/lib/money-api";
import { usePayEstimate } from "@/lib/roster-pay";
import { format, addMonths } from "date-fns";

// Next month's roster month (variables from current month's roster are billed next month)
function currentRosterMonth() {
  return format(new Date(), "yyyy-MM");
}

export function ForecastCard() {
  const { data: forecast, isLoading: fLoading } = useQuery({
    queryKey: ["money", "forecast"],
    queryFn: () => moneyApi.forecast(),
  });
  const { data: meta } = useQuery({
    queryKey: ["money", "meta"],
    queryFn: () => moneyApi.meta(),
    staleTime: Infinity,
  });
  const goal = meta?.savings_goal ?? 0;

  // Next month's payslip: its fixed pay + the variable pay earned this month
  // (category/level/IRPF/jornada come from the pay settings saved on the roster page)
  const rosterMonth = currentRosterMonth();
  const { data: payEst, isLoading: pLoading } = usePayEstimate(rosterMonth);

  const isLoading = fLoading || pLoading;
  if (isLoading) return <div className="h-36 bg-[#0D0D0F] rounded-xl animate-pulse" />;
  if (!forecast) return null;

  // Use pilot net estimate as predicted income if available; else fall back to transaction avg
  const pilotNetAvailable = payEst && payEst.net > 0;
  const predictedIncome = pilotNetAvailable
    ? payEst!.net
    : forecast.predicted_income;

  const predictedSavings = predictedIncome - forecast.predicted_spent;

  const basedOn = forecast.based_on_months
    .map((m) => new Date(m + "-15").toLocaleDateString("en-GB", { month: "short", year: "2-digit" }))
    .join(", ");

  const nextMonth = format(addMonths(new Date(), 1), "MMMM");

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-4">
          <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Pred. income</p>
          <p className="text-lg font-semibold text-[#22C55E] tabular-nums">{fmtAmount(predictedIncome)}</p>
          {pilotNetAvailable && (
            <p className="text-[10px] text-[#52525B] mt-1">From roster · net</p>
          )}
        </div>
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-4">
          <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Pred. spend</p>
          <p className="text-lg font-semibold text-[#FAFAFA] tabular-nums">{fmtAmount(forecast.predicted_spent)}</p>
          <p className="text-[10px] text-[#52525B] mt-1">3-mo avg</p>
        </div>
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-4">
          <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Pred. save</p>
          <p className={`text-lg font-semibold tabular-nums ${predictedSavings >= goal ? "text-[#22C55E]" : predictedSavings >= 0 ? "text-[#F59E0B]" : "text-[#EF4444]"}`}>
            {predictedSavings >= 0 ? "" : "−"}{fmtAmount(Math.abs(predictedSavings))}
          </p>
        </div>
      </div>

      {pilotNetAvailable && payEst && (
        <div className="bg-[#111113] border border-[#27272A] rounded-xl px-4 py-3 space-y-1.5">
          <p className="text-xs text-[#52525B] uppercase tracking-widest">{nextMonth} pay breakdown</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-[#71717A]">Gross</span>
              <span className="tabular-nums text-[#A1A1AA]">{fmtAmount(payEst.gross)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-[#71717A]">Block hours</span>
              <span className="tabular-nums text-[#A1A1AA]">{payEst.block_hours.toFixed(1)}h</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-[#71717A]">Per diems</span>
              <span className="tabular-nums text-[#A1A1AA]">
                {fmtAmount(payEst.dietas)}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-[#71717A]">STBY</span>
              <span className="tabular-nums text-[#A1A1AA]">{fmtAmount(payEst.variable.find(v => v.key === "standby")?.amount ?? 0)}</span>
            </div>
          </div>
          <p className="text-[10px] text-[#3F3F46] pt-0.5">Variable from {rosterMonth} roster · {payEst.irpf_pct}% IRPF · {payEst.category} L{payEst.level}</p>
        </div>
      )}

      <p className="text-xs text-[#3F3F46]">
        {pilotNetAvailable
          ? `Income from ${rosterMonth} roster estimate · spend from ${basedOn}`
          : `3-month rolling avg from ${basedOn}`}
      </p>
    </div>
  );
}
