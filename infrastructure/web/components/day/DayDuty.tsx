"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Moon, PlaneTakeoff } from "lucide-react";
import type { FlightSummary } from "@/lib/api";
import { mainFunction, FUNCTION_SHORT } from "@/lib/flight-time";
import { LaneHeader, LaneLink } from "./Lane";

interface RosterBrief {
  duty_type: string;
  report_time: string | null;
  end_time: string | null;
  raw_code: string;
}

// Colour only on the duty name — the card itself stays plain like the other lanes.
const DUTY: Record<string, { label: string; text: string }> = {
  flying_duty: { label: "Flying duty", text: "text-[#4ADE80]" },
  standby:     { label: "Standby",     text: "text-[#FACC15]" },
  ground_duty: { label: "Ground duty", text: "text-[#818CF8]" },
  day_off:     { label: "Day off",     text: "text-[#71717A]" },
  unknown:     { label: "Duty",        text: "text-[#A1A1AA]" },
};

function opDot(f: FlightSummary): string {
  if (f.is_sim) return "#A78BFA";
  const op = (f.operator || "").toLowerCase();
  if (op.includes("norwegian") || f.source === "norwegian") return "#EF4444";
  if (op.includes("ryanair") || f.source === "full_csv") return "#3B82F6";
  return "#71717A";
}

function hm(sec: number): string {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

const hhmm = (s: string | null | undefined) => (s ? (s.length > 5 ? s.slice(11, 16) : s) : "");

/** The roster duty and the flights flown under it, as one card. */
export function DayDuty({ date }: { date: string }) {
  const { data: brief, isLoading: loadingBrief } = useQuery<RosterBrief | null>({
    queryKey: ["roster-brief", date],
    queryFn: async () => {
      const res = await fetch(`/api/roster/day/${date}?brief=1`);
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    staleTime: 0,
    retry: 2,
  });
  const { data: flights = [], isLoading: loadingFlights } = useQuery<FlightSummary[]>({
    queryKey: ["day-flights", date],
    queryFn: async () => {
      const res = await fetch(`/api/flights?start=${date}&end=${date}`);
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    staleTime: 0,
    retry: 2,
  });

  if (loadingBrief || loadingFlights) return null;
  if (!brief && flights.length === 0) return null;

  const header = <LaneHeader icon={PlaneTakeoff} label="Duty" action={<LaneLink href="/aviation/roster">Roster →</LaneLink>} />;
  const real = flights.filter((f) => !f.is_sim);
  const kind = brief?.duty_type ?? (real.length ? "flying_duty" : "unknown");

  if (flights.length === 0 && kind === "day_off") {
    return (
      <section>
        {header}
        <p className="text-sm text-[#71717A] px-0.5">Day off</p>
      </section>
    );
  }

  const d = DUTY[kind] ?? DUTY.unknown;
  const blockSec = real.reduce((s, f) => s + (f.block_seconds ?? 0), 0);

  return (
    <section>
      {header}
      <div className="bg-[#0D0D0F] border border-[#27272A] rounded-2xl overflow-hidden">
        <div className="px-4 py-3 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-semibold ${d.text}`}>{flights.length > 0 && real.length === 0 ? "Simulator" : d.label}</p>
            {brief?.report_time && (
              <p className="text-xs text-[#71717A] tabular-nums mt-0.5">
                C/I {brief.report_time}{brief.end_time && <> · C/O {brief.end_time}</>}
              </p>
            )}
          </div>
          {blockSec > 0 && (
            <div className="text-right shrink-0">
              <p className="text-sm font-semibold text-[#FAFAFA] tabular-nums">
                {hm(blockSec)} <span className="text-xs font-normal text-[#71717A]">block</span>
              </p>
              {real.length > 1 && <p className="text-[11px] text-[#71717A]">{real.length} sectors</p>}
            </div>
          )}
        </div>

        {flights.length > 0 && (
          <div className="divide-y divide-[#18181B] border-t border-[#18181B]">
            {flights.map((f) => {
              const route = f.is_sim
                ? (f.aircraft_type || "SIM")
                : `${f.dep_icao || f.dep_iata || "?"} → ${f.arr_icao || f.arr_iata || "?"}`;
              const times = [hhmm(f.off_block_utc), hhmm(f.on_block_utc)].filter(Boolean).join("–");
              const meta = [
                times && `${times} UTC`,
                !f.is_sim && f.aircraft_type && `${f.aircraft_type}${f.aircraft_reg ? ` · ${f.aircraft_reg}` : ""}`,
              ].filter(Boolean).join(" · ");
              return (
                <Link key={f.id} href={`/aviation/${f.id}`}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-[#131316] transition-colors">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: opDot(f) }} />
                  <div className="flex-1 min-w-0">
                    <p className="truncate">
                      <span className={`text-sm font-mono font-semibold ${f.is_sim ? "text-violet-300" : "text-sky-400"}`}>{route}</span>
                      {f.flight_number && <span className="ml-2 text-xs text-[#71717A]">{f.flight_number}</span>}
                    </p>
                    <p className="text-[11px] text-[#71717A] tabular-nums truncate mt-0.5">
                      {meta}
                      {f.night_seconds > 0 && (
                        <span className="inline-flex items-center gap-0.5 ml-1.5 text-indigo-400">
                          <Moon size={9} />{(f.night_seconds / 3600).toFixed(1)}h
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-[#27272A] text-[#A1A1AA]">
                      {FUNCTION_SHORT[mainFunction(f)]}
                    </span>
                    <span className="text-xs text-[#A1A1AA] tabular-nums w-12 text-right">
                      {f.block_seconds ? hm(f.block_seconds) : "—"}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
