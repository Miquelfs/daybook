"use client";

import { useQuery } from "@tanstack/react-query";
import { Plane } from "lucide-react";
import { wellnessApi, type FlightPhases, type FlightPhase } from "@/lib/wellness-api";
import { SectionLabel } from "@/components/MorningBrief";

function delta(v?: number | null): { txt: string; cls: string } {
  if (v == null) return { txt: "—", cls: "text-[#3F3F46]" };
  const up = v > 0;
  return {
    txt: `${up ? "+" : ""}${Math.round(v)}`,
    cls: Math.abs(v) < 3 ? "text-[#71717A]" : up ? "text-[#F87171]" : "text-[#34D399]",
  };
}

function PhaseRow({ icon, label, p }: { icon: string; label: string; p: FlightPhase }) {
  const hr = delta(p.hr_delta);
  const st = delta(p.stress_delta);
  const empty = p.hr_delta == null && p.stress_delta == null;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-20 shrink-0 text-[#A1A1AA]">{icon} {label}</span>
      {empty ? (
        <span className="text-xs text-[#3F3F46]">no wellness data</span>
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

// Per-flight physiological load: HR & stress in the takeoff/approach windows vs
// the day's baseline. Renders nothing on non-flying days.
export function FlightLoadCard({ date }: { date: string }) {
  const { data } = useQuery<FlightPhases>({
    queryKey: ["flight-phases", date],
    queryFn: () => wellnessApi.flightPhases(date),
    staleTime: 30_000,
    retry: 1,
  });

  if (!data || data.flights.length === 0) return null;

  return (
    <section>
      <SectionLabel>Flight load</SectionLabel>
      <div className="flex flex-col gap-3">
        {data.flights.map((f, i) => (
          <div key={i} className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-[#FAFAFA]">
              <Plane size={14} className="text-[#60A5FA]" /> {f.leg}
            </div>
            <PhaseRow icon="🛫" label="Takeoff" p={f.takeoff} />
            <PhaseRow icon="🛬" label="Landing" p={f.landing} />
          </div>
        ))}
        <p className="text-[11px] text-[#3F3F46]">Δ vs the day&apos;s median HR / stress, in the ~15 min around each phase.</p>
      </div>
    </section>
  );
}
