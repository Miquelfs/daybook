"use client";

import { useQuery } from "@tanstack/react-query";
import { correlationsApi } from "@/lib/correlations-api";
import type { TagStats } from "@/lib/correlations-api";
import { X } from "lucide-react";

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

interface Props {
  slug: string;
  onClose: () => void;
}

function ImpactBar({ label, impact }: {
  label: string;
  impact: TagStats["mood_impact"];
}) {
  if (!impact) return null;
  const delta = impact.delta ?? 0;
  const isPositive = delta >= 0;
  return (
    <div className="flex items-center gap-3">
      <p className="text-[10px] text-[#52525B] w-12 shrink-0">{label}</p>
      <div className="flex-1 flex items-center gap-1.5">
        <div className="flex-1 h-1.5 rounded-full bg-[#27272A] overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${isPositive ? "bg-emerald-400" : "bg-red-400"}`}
            style={{ width: `${Math.min(Math.abs(delta) / 3 * 100, 100)}%` }}
          />
        </div>
        <span className={`text-xs font-semibold tabular-nums w-12 text-right ${isPositive ? "text-emerald-400" : "text-red-400"}`}>
          {delta > 0 ? "+" : ""}{delta?.toFixed(2)}
        </span>
      </div>
      <p className="text-[10px] text-[#52525B] shrink-0 w-20 text-right">
        {impact.avg_with.toFixed(1)} vs {impact.avg_without?.toFixed(1) ?? "—"}
      </p>
    </div>
  );
}

export function TagStatsDrawer({ slug, onClose }: Props) {
  const { data: stats, isLoading } = useQuery({
    queryKey: ["tag-stats", slug],
    queryFn: () => correlationsApi.tagStats(slug),
    staleTime: 5 * 60 * 1000,
  });

  const rolling = stats?.rolling_28d ?? [];
  const maxRolling = Math.max(...rolling.map((r) => r.count), 1);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Sheet */}
      <div className="relative w-full max-w-md bg-[#09090B] border border-[#27272A] rounded-t-2xl sm:rounded-2xl p-5 pb-8 max-h-[85vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <span className="text-2xl">{stats?.icon ?? "🏷️"}</span>
            <div>
              <h2 className="text-base font-semibold text-[#FAFAFA]">{stats?.name ?? slug}</h2>
              <p className="text-[10px] text-[#52525B] capitalize">{stats?.category}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-[#52525B] hover:text-[#A1A1AA] hover:bg-[#18181B] transition-colors">
            <X size={16} />
          </button>
        </div>

        {isLoading && (
          <div className="py-12 text-center text-xs text-[#52525B]">Loading…</div>
        )}

        {stats && (
          <div className="space-y-6">
            {/* Usage stats */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-3 text-center">
                <p className="text-xl font-semibold tabular-nums text-[#FAFAFA]">{stats.total_days_all}</p>
                <p className="text-[10px] text-[#52525B] mt-0.5">Total days</p>
              </div>
              <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-3 text-center">
                <p className="text-xl font-semibold tabular-nums text-[#FAFAFA]">{stats.total_days_90d}</p>
                <p className="text-[10px] text-[#52525B] mt-0.5">Last 90d</p>
              </div>
              <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-3 text-center">
                <p className="text-xl font-semibold tabular-nums text-[#FAFAFA]">
                  {stats.avg_gap_days != null ? `${stats.avg_gap_days}d` : "—"}
                </p>
                <p className="text-[10px] text-[#52525B] mt-0.5">Avg gap</p>
              </div>
            </div>

            {/* Peak month + dates */}
            <div className="flex items-center justify-between text-xs">
              {stats.peak_month != null && (
                <div>
                  <p className="text-[10px] text-[#52525B] mb-0.5">Peak month</p>
                  <p className="text-[#A1A1AA] font-medium">{MONTH_NAMES[stats.peak_month - 1]}</p>
                </div>
              )}
              {stats.first_used && (
                <div className="text-right">
                  <p className="text-[10px] text-[#52525B] mb-0.5">First used</p>
                  <p className="text-[#A1A1AA]">{stats.first_used}</p>
                </div>
              )}
            </div>

            {/* Rolling 28-day trend */}
            {rolling.length > 0 && (
              <div>
                <p className="text-[10px] text-[#52525B] uppercase tracking-widest mb-2">28-day rolling frequency</p>
                <div className="flex items-end gap-0.5 h-12">
                  {rolling.map((r, i) => (
                    <div
                      key={i}
                      className="flex-1 rounded-t-sm bg-[#3B82F6]/70 transition-all"
                      style={{ height: `${maxRolling > 0 ? (r.count / maxRolling) * 100 : 0}%`, minHeight: r.count > 0 ? 2 : 0 }}
                      title={`${r.period_end}: ${r.count}`}
                    />
                  ))}
                </div>
                <div className="flex justify-between mt-1">
                  <p className="text-[9px] text-[#3F3F46]">{rolling[0]?.period_end?.slice(0, 7)}</p>
                  <p className="text-[9px] text-[#3F3F46]">{rolling[rolling.length - 1]?.period_end?.slice(0, 7)}</p>
                </div>
              </div>
            )}

            {/* Impact bars */}
            {(stats.mood_impact || stats.energy_impact || stats.hrv_impact) && (
              <div>
                <p className="text-[10px] text-[#52525B] uppercase tracking-widest mb-3">Impact vs baseline</p>
                <div className="space-y-2.5">
                  <ImpactBar label="Mood" impact={stats.mood_impact} />
                  <ImpactBar label="Energy" impact={stats.energy_impact} />
                  <ImpactBar label="HRV" impact={stats.hrv_impact} />
                </div>
                <p className="text-[9px] text-[#3F3F46] mt-2">Delta = avg when tag present minus avg when absent</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
