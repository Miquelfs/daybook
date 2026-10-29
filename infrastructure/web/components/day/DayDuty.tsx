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

// The card takes the colour of who you flew for (Norwegian red, Ryanair blue), else
// the duty's own: a tinted header with an accent edge, as the flight-duty banner had.
const DUTY: Record<string, { label: string; color: string }> = {
  flying_duty: { label: "Flying duty", color: "#4ADE80" },
  standby:     { label: "Standby",     color: "#FACC15" },
  ground_duty: { label: "Ground duty", color: "#818CF8" },
  day_off:     { label: "Day off",     color: "#71717A" },
  unknown:     { label: "Duty",        color: "#A1A1AA" },
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

/** Minutes between two UTC times ("HH:MM" or ISO), across midnight if needed. */
function gapMin(from: string | null | undefined, to: string | null | undefined): number | null {
  const a = hhmm(from), b = hhmm(to);
  if (!a || !b) return null;
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return (m(b) - m(a) + 1440) % 1440;
}

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
  const accent = real.length ? opDot(real[0]) : flights.length ? opDot(flights[0]) : d.color;
  const blockSec = real.reduce((s, f) => s + (f.block_seconds ?? 0), 0);
  const nightSec = real.reduce((s, f) => s + (f.night_seconds ?? 0), 0);
  const label = flights.length > 0 && real.length === 0 ? "Simulator"
    : kind === "standby" && real.length > 0 ? "Standby · called out"
    : d.label;

  return (
    <section>
      {header}
      <div className="bg-[#0D0D0F] border border-[#27272A] rounded-2xl overflow-hidden" style={{ borderLeft: `3px solid ${accent}` }}>
        <div className="px-4 py-3.5 flex items-end gap-3" style={{ background: `${accent}12` }}>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-widest font-medium" style={{ color: accent }}>{label}</p>
            {blockSec > 0 ? (
              <p className="text-xl font-semibold text-[#FAFAFA] tabular-nums leading-tight mt-0.5">
                {hm(blockSec)} <span className="text-sm font-normal text-[#71717A]">block</span>
              </p>
            ) : (
              <p className="text-sm text-[#A1A1AA] mt-0.5">{flights.length ? `${flights.length} session${flights.length > 1 ? "s" : ""}` : "No flights"}</p>
            )}
            {brief?.report_time && (
              <p className="text-xs text-[#71717A] tabular-nums mt-0.5">
                C/I {brief.report_time}{brief.end_time && <> · C/O {brief.end_time}</>}
              </p>
            )}
          </div>
          <div className="text-right shrink-0 text-xs text-[#71717A] space-y-0.5">
            {real.length > 0 && <p>{real.length} sector{real.length > 1 ? "s" : ""}</p>}
            {nightSec > 0 && (
              <p className="inline-flex items-center gap-1 text-indigo-400 tabular-nums">
                <Moon size={10} />{(nightSec / 3600).toFixed(1)}h night
              </p>
            )}
          </div>
        </div>

        {flights.map((f, i) => {
          const route = f.is_sim
            ? (f.aircraft_type || "SIM")
            : `${f.dep_icao || f.dep_iata || "?"} → ${f.arr_icao || f.arr_iata || "?"}`;
          const times = [hhmm(f.off_block_utc), hhmm(f.on_block_utc)].filter(Boolean).join("–");
          const turn = i > 0 ? gapMin(flights[i - 1].on_block_utc, f.off_block_utc) : null;
          return (
            <div key={f.id}>
              {turn != null && turn < 12 * 60 && (
                <p className="px-4 py-1 text-[10px] text-[#71717A] tabular-nums border-t border-[#18181B] bg-[#131316]/40">
                  ↻ {hm(turn * 60)} turnaround{f.dep_icao || f.dep_iata ? ` · ${f.dep_icao || f.dep_iata}` : ""}
                </p>
              )}
              <Link href={`/aviation/${f.id}`}
                    className="flex items-center gap-3 px-4 py-3 border-t border-[#18181B] hover:bg-[#131316] transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="truncate">
                    <span className={`text-sm font-mono font-semibold ${f.is_sim ? "text-violet-300" : "text-sky-400"}`}>{route}</span>
                    {f.flight_number && <span className="ml-2 text-xs text-[#71717A]">{f.flight_number}</span>}
                  </p>
                  <p className="text-[11px] text-[#71717A] tabular-nums truncate mt-0.5">
                    {times && `${times} UTC`}
                    {!f.is_sim && f.aircraft_type && ` · ${f.aircraft_type}${f.aircraft_reg ? ` · ${f.aircraft_reg}` : ""}`}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className="text-sm text-[#FAFAFA] tabular-nums">{f.block_seconds ? hm(f.block_seconds) : "—"}</span>
                  <span className="text-[10px] font-mono px-1.5 py-px rounded"
                        style={{ background: `${opDot(f)}1F`, color: opDot(f) }}>
                    {FUNCTION_SHORT[mainFunction(f)]}
                  </span>
                </div>
              </Link>
            </div>
          );
        })}
      </div>
    </section>
  );
}
