"use client";

import { useQuery } from "@tanstack/react-query";
import { moneyApi, fmtAmount } from "@/lib/money-api";
import { CATEGORY_EMOJI } from "./CategoryPills";

export function AnomalyReport({ month }: { month?: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["money", "anomalies", month],
    queryFn: () => moneyApi.anomalies(month),
  });

  if (isLoading) return <div className="h-16 bg-[#0D0D0F] rounded-xl animate-pulse" />;
  if (!data) return null;

  const { large_transactions: largeTxns, category_spikes: spikes } = data;

  if (largeTxns.length === 0 && spikes.length === 0) {
    return (
      <div className="bg-[#0D0D0F] border border-[#22C55E]/20 rounded-xl px-4 py-3">
        <p className="text-sm text-[#22C55E]">✓ No anomalies detected this month</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Category spikes */}
      {spikes.map((s) => (
        <div key={s.category} className="bg-[#0D0D0F] border border-[#F59E0B]/30 rounded-xl px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span>{CATEGORY_EMOJI[s.category] ?? "💳"}</span>
              <div>
                <p className="text-sm font-medium text-[#F59E0B]">{s.category} spike</p>
                <p className="text-xs text-[#52525B] mt-0.5">
                  {fmtAmount(s.current_spent)} this month · avg {fmtAmount(s.avg_spent)}
                </p>
              </div>
            </div>
            <span className="text-sm font-semibold text-[#F59E0B] tabular-nums">
              {s.ratio.toFixed(1)}×
            </span>
          </div>
        </div>
      ))}

      {/* Large individual transactions */}
      {largeTxns.map((t) => (
        <div key={t.id} className="bg-[#0D0D0F] border border-[#EF4444]/20 rounded-xl px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span>{CATEGORY_EMOJI[t.category ?? ""] ?? "💳"}</span>
              <div>
                <p className="text-sm font-medium text-[#EF4444]">{t.name}</p>
                <p className="text-xs text-[#52525B] mt-0.5">
                  {t.date} · {t.category} · {t.ratio.toFixed(1)}× usual size
                </p>
              </div>
            </div>
            <span className="text-sm tabular-nums text-[#EF4444]">
              -{fmtAmount(t.amount)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
