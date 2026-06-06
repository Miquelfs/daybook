"use client";

import { useQuery } from "@tanstack/react-query";
import { moneyApi, fmtAmount } from "@/lib/money-api";

export function ForecastCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["money", "forecast"],
    queryFn: () => moneyApi.forecast(),
  });

  if (isLoading) return <div className="h-24 bg-[#0D0D0F] rounded-xl animate-pulse" />;
  if (!data) return null;

  const basedOn = data.based_on_months
    .map((m) => new Date(m + "-15").toLocaleDateString("en-GB", { month: "short", year: "2-digit" }))
    .join(", ");

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-4">
          <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Pred. income</p>
          <p className="text-lg font-semibold text-[#22C55E] tabular-nums">{fmtAmount(data.predicted_income)}</p>
        </div>
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-4">
          <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Pred. spend</p>
          <p className="text-lg font-semibold text-[#FAFAFA] tabular-nums">{fmtAmount(data.predicted_spent)}</p>
        </div>
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-4">
          <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Pred. save</p>
          <p className={`text-lg font-semibold tabular-nums ${data.predicted_savings >= 1300 ? "text-[#22C55E]" : data.predicted_savings >= 0 ? "text-[#F59E0B]" : "text-[#EF4444]"}`}>
            {data.predicted_savings >= 0 ? "" : "−"}{fmtAmount(Math.abs(data.predicted_savings))}
          </p>
        </div>
      </div>
      <p className="text-xs text-[#3F3F46]">3-month rolling avg from {basedOn}</p>
    </div>
  );
}
