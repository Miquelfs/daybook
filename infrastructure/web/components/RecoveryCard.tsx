"use client";

import { useQuery } from "@tanstack/react-query";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { wellnessApi, type RecoveryFlag } from "@/lib/wellness-api";

// Recovery / illness cue. Renders nothing when everything's fine (status ok) —
// only surfaces on a watch/flag so it stays a signal, not noise.
export function RecoveryCard({ date }: { date: string }) {
  const { data } = useQuery<RecoveryFlag>({
    queryKey: ["wellness-recovery", date],
    queryFn: () => wellnessApi.recovery(date),
    staleTime: 30_000,
    retry: 1,
  });

  if (!data || data.status === "ok" || data.reasons.length === 0) return null;

  const flag = data.status === "flag";
  const color = flag ? "#F87171" : "#FBBF24";

  return (
    <div
      className="rounded-xl px-4 py-3 flex items-start gap-3"
      style={{ background: `${color}0D`, border: `1px solid ${color}33` }}
    >
      {flag ? <ShieldAlert size={16} style={{ color }} className="mt-0.5 shrink-0" />
            : <ShieldCheck size={16} style={{ color }} className="mt-0.5 shrink-0" />}
      <div className="min-w-0">
        <p className="text-sm font-medium" style={{ color }}>
          {flag ? "Recovery flag" : "Recovery watch"}
        </p>
        <p className="text-xs text-[#A1A1AA] mt-0.5">
          {data.reasons.join(" · ")} — possible illness or overreach. Consider an easier day.
        </p>
      </div>
    </div>
  );
}
