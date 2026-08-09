"use client";

import { useQuery } from "@tanstack/react-query";
import { wellnessApi, type StressByPlace } from "@/lib/wellness-api";
import { SectionLabel } from "@/components/MorningBrief";

const META: Record<string, { emoji: string; label: string; color: string }> = {
  "in-flight": { emoji: "✈️", label: "In-flight", color: "#60A5FA" },
  airport: { emoji: "🛄", label: "Airport", color: "#F97316" },
  home: { emoji: "🏠", label: "Home", color: "#34D399" },
  elsewhere: { emoji: "📍", label: "Elsewhere", color: "#A1A1AA" },
};

function fmtMin(m: number): string {
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`;
}

// Where your stress was today — intraday stress split by context (in-flight /
// airport / home / elsewhere) via the GPS track. Nothing to log; all derived.
export function StressByPlaceCard({ date }: { date: string }) {
  const { data } = useQuery<StressByPlace>({
    queryKey: ["stress-by-place", date],
    queryFn: () => wellnessApi.stressByPlace(date),
    staleTime: 30_000,
    retry: 1,
  });

  // Only worth showing when there's more than one context to compare.
  if (!data || !data.has_data || data.buckets.length < 2) return null;

  const max = Math.max(...data.buckets.map((b) => b.avg_stress), 1);

  return (
    <section>
      <SectionLabel>Stress by place</SectionLabel>
      <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4 space-y-2.5">
        {data.buckets.map((b) => {
          const m = META[b.place] ?? { emoji: "•", label: b.place, color: "#A1A1AA" };
          return (
            <div key={b.place}>
              <div className="flex items-baseline justify-between text-xs mb-1">
                <span className="text-[#A1A1AA]">{m.emoji} {m.label}</span>
                <span className="tabular-nums text-[#71717A]">
                  <span className="text-[#FAFAFA] font-semibold">{b.avg_stress}</span> · {fmtMin(b.minutes)}
                </span>
              </div>
              <div className="h-2 rounded-full bg-[#18181B] overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${(b.avg_stress / max) * 100}%`, background: m.color }} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
