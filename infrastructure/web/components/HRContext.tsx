"use client";

import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import Link from "next/link";

type ContextBucket = {
  avg_bpm: number | null;
  peak_bpm: number | null;
  days_sampled: number | null;
};

type TopPeak = {
  label: string;
  date: string;
  peak_bpm: number;
  avg_bpm: number;
  context: "flight" | "training";
};

type HRContextData = {
  period_days: number;
  flight: ContextBucket;
  training: ContextBucket;
  rest: ContextBucket;
  top_peaks: TopPeak[];
};

const CONTEXT_CONFIG = {
  flight: { label: "Cockpit", icon: "✈", color: "#3B82F6", bg: "bg-blue-500/10 border-blue-500/20" },
  training: { label: "Training", icon: "⚡", color: "#22C55E", bg: "bg-emerald-500/10 border-emerald-500/20" },
  rest: { label: "Rest", icon: "◎", color: "#71717A", bg: "bg-[#18181B] border-[#27272A]" },
};

function BpmBar({ value, max, color }: { value: number | null; max: number; color: string }) {
  if (!value) return <div className="h-1.5 rounded-full bg-[#27272A] w-full" />;
  return (
    <div className="h-1.5 rounded-full bg-[#27272A] w-full">
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${Math.min((value / max) * 100, 100)}%`, background: color }}
      />
    </div>
  );
}

export function HRContext({ days }: { days: number }) {
  const { data, isLoading } = useQuery<HRContextData>({
    queryKey: ["hr-context", days],
    queryFn: async () => {
      const res = await fetch(`/api/health/hr-context?days=${days}`);
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const hasAnyData =
    data?.flight.avg_bpm || data?.training.avg_bpm || (data?.top_peaks?.length ?? 0) > 0;

  if (isLoading || !hasAnyData) return null;

  const allPeaks = [
    data!.flight.peak_bpm,
    data!.training.peak_bpm,
    data!.rest.peak_bpm,
  ].filter(Boolean) as number[];
  const globalMax = allPeaks.length ? Math.max(...allPeaks) : 200;

  const buckets = (["flight", "training", "rest"] as const).filter(
    k => data![k].avg_bpm !== null
  );

  // Determine which context has the highest peak
  const peakContext = buckets.reduce<"flight" | "training" | "rest" | null>((best, k) => {
    if (!best) return k;
    return (data![k].peak_bpm ?? 0) > (data![best].peak_bpm ?? 0) ? k : best;
  }, null);

  return (
    <section className="mb-8">
      <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-4">
        Heart rate by context
      </h2>

      {/* Three-way comparison */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        {buckets.map(k => {
          const cfg = CONTEXT_CONFIG[k];
          const bucket = data![k];
          const isHighest = k === peakContext;
          return (
            <div
              key={k}
              className={`rounded-xl border px-3 py-3 ${cfg.bg} ${isHighest ? "ring-1 ring-[#F59E0B]" : ""}`}
            >
              <div className="flex items-center justify-between mb-1">
                <p className="text-[10px] uppercase tracking-widest text-[#52525B]">{cfg.label}</p>
                <span className="text-xs">{cfg.icon}</span>
              </div>
              <p className="text-xl font-bold tabular-nums" style={{ color: cfg.color }}>
                {bucket.peak_bpm ?? "—"}
              </p>
              <p className="text-[10px] text-[#52525B] mb-2">peak bpm</p>
              <BpmBar value={bucket.peak_bpm} max={globalMax} color={cfg.color} />
              {bucket.avg_bpm && (
                <p className="text-[10px] text-[#3F3F46] mt-1.5">avg {bucket.avg_bpm} bpm</p>
              )}
              {bucket.days_sampled !== null && (
                <p className="text-[9px] text-[#3F3F46]">{bucket.days_sampled} sessions</p>
              )}
              {isHighest && (
                <p className="text-[9px] mt-1" style={{ color: cfg.color }}>▲ highest</p>
              )}
            </div>
          );
        })}
      </div>

      {/* Top peak moments */}
      {(data!.top_peaks?.length ?? 0) > 0 && (
        <>
          <p className="text-[10px] text-[#3F3F46] uppercase tracking-widest mb-2">
            Highest moments
          </p>
          <div className="space-y-1">
            {data!.top_peaks.map((p, i) => {
              const cfg = CONTEXT_CONFIG[p.context];
              return (
                <Link
                  key={i}
                  href={`/day/${p.date}`}
                  className="flex items-center gap-3 px-3 py-2 bg-[#0D0D0F] border border-[#27272A] rounded-xl hover:border-[#3F3F46] transition-colors"
                >
                  <span className="text-sm shrink-0">{cfg.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-[#A1A1AA] truncate">{p.label}</p>
                    <p className="text-[10px] text-[#52525B]">
                      {format(parseISO(p.date), "d MMM yyyy")}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold tabular-nums" style={{ color: cfg.color }}>
                      {p.peak_bpm}
                    </p>
                    <p className="text-[10px] text-[#52525B]">avg {p.avg_bpm}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
