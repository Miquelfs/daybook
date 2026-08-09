"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { wellnessApi, type FlightPhase } from "@/lib/wellness-api";

function delta(v?: number | null): { txt: string; cls: string } {
  if (v == null) return { txt: "—", cls: "text-[#3F3F46]" };
  const up = v > 0;
  return {
    txt: `${up ? "+" : ""}${Math.round(v)}`,
    cls: Math.abs(v) < 3 ? "text-[#71717A]" : up ? "text-[#F87171]" : "text-[#34D399]",
  };
}

function Row({ icon, label, p }: { icon: string; label: string; p: FlightPhase }) {
  const hr = delta(p.hr_delta);
  const st = delta(p.stress_delta);
  const empty = p.hr_delta == null && p.stress_delta == null;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-20 shrink-0 text-[#A1A1AA]">{icon} {label}</span>
      {empty ? (
        <span className="text-xs text-[#3F3F46]">no wellness data (watch off)</span>
      ) : (
        <>
          <span className="tabular-nums">HR <span className={hr.cls}>{hr.txt}</span></span>
          <span className="tabular-nums">stress <span className={st.cls}>{st.txt}</span></span>
        </>
      )}
      {p.you_flew && (
        <span className="ml-auto text-[10px] uppercase tracking-widest text-[#F59E0B] bg-[#F59E0B]/10 rounded-full px-1.5 py-0.5">
          you flew
        </span>
      )}
    </div>
  );
}

// Cirqa physiological load for THIS flight, on the flight detail page. Computed
// on the fly (never written to the flights table / logbook export). Hides itself
// on flights with no wellness data.
export function FlightPhysioCard({ flightId }: { flightId: string }) {
  const { data } = useQuery({
    queryKey: ["flight-physio", flightId],
    queryFn: () => wellnessApi.flightPhase(flightId),
    staleTime: 60_000,
    retry: 1,
  });

  const phase = data?.phase;
  if (!phase) return null;
  const hasAny =
    phase.takeoff?.hr_delta != null || phase.takeoff?.stress_delta != null ||
    phase.landing?.hr_delta != null || phase.landing?.stress_delta != null;
  if (!hasAny) return null;

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-2">
        <Activity size={14} className="text-[#60A5FA]" />
        <p className="text-xs font-medium text-[#71717A] uppercase tracking-wider">Physiological load · Cirqa</p>
      </div>
      <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4 space-y-2">
        <Row icon="🛫" label="Takeoff" p={phase.takeoff} />
        <Row icon="🛬" label="Landing" p={phase.landing} />
        <p className="text-[11px] text-[#3F3F46]">Δ vs the day&apos;s median HR / stress, in the ~15 min around each phase.</p>
      </div>
    </div>
  );
}
