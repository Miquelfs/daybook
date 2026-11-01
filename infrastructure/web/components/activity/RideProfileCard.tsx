"use client";

import Link from "next/link";
import { Home, Mountain } from "lucide-react";
import { SectionLabel } from "@/components/MorningBrief";
import { GradeProfile } from "@/components/training/StageProfile";
import type { RideProfile } from "@/lib/api";

/** The ride's elevation coloured by gradient, like the tour's stage sheets, with the cols, climbs
 *  and villages it went past — and the same, in order, as a list. */
export function RideProfileCard({ ride, elevation }: {
  ride: RideProfile;
  elevation?: { gain_m: number; loss_m: number; max_m: number; max_grade: number } | null;
}) {
  if (ride.profile.length < 3) return null;
  return (
    <section className="mb-8">
      <SectionLabel>Profile</SectionLabel>
      <div className="bg-[#0D0D0F] border border-[#27272A] rounded-2xl p-4 space-y-3">
        <GradeProfile profile={ride.profile} markers={ride.markers} height={130} />
        {elevation && (
          <p className="text-xs text-[#71717A] tabular-nums">
            +{Math.round(elevation.gain_m).toLocaleString("en-GB")} m · −{Math.round(elevation.loss_m).toLocaleString("en-GB")} m
            · high point {Math.round(elevation.max_m)} m · steepest 200 m {Math.round(elevation.max_grade)}%
          </p>
        )}
        {ride.markers.length > 0 && (
          <div className="pt-2 border-t border-[#18181B]">
            <p className="text-[10px] text-[#52525B] uppercase tracking-widest mb-1">Along the way</p>
            <div className="divide-y divide-[#18181B]">
              {ride.markers.map((m, i) => (
                <div key={i} className="flex items-center gap-3 py-1.5 text-xs tabular-nums">
                  <span className="w-12 shrink-0 text-[#71717A]">km {m.km}</span>
                  {m.kind === "village"
                    ? <Home size={12} className="shrink-0 text-[#52525B]" />
                    : <Mountain size={12} className="shrink-0 text-[#52525B]" />}
                  {m.kind === "village"
                    ? <span className="flex-1 min-w-0 truncate text-[#D4D4D8]">{m.name}</span>
                    : <Link href="/omyra?tab=cols" className="flex-1 min-w-0 truncate text-[#D4D4D8] hover:underline">{m.name}</Link>}
                  <span className="shrink-0 text-[#71717A]">
                    {m.gain_m != null ? `${m.length_km} km · +${m.gain_m} m · ${m.avg_pct}%` : ""}
                    {m.ele != null ? `${m.gain_m != null ? " · " : ""}${Math.round(m.ele)} m` : ""}
                  </span>
                  {m.first && <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#F59E0B]/15 text-[#F59E0B]">new</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
