"use client";

import { useQuery } from "@tanstack/react-query";
import type { FlightSummary } from "@/lib/api";

function flightOpColor(f: FlightSummary): { dot: string; badge: string } {
  if (f.is_sim) return { dot: "#A78BFA", badge: "bg-violet-900/40 text-violet-300" };
  const op = (f.operator || "").toLowerCase();
  if (op.includes("norwegian") || f.source === "norwegian")
    return { dot: "#EF4444", badge: "bg-red-900/40 text-red-300" };
  if (op.includes("ryanair") || f.source === "full_csv")
    return { dot: "#3B82F6", badge: "bg-blue-900/40 text-blue-300" };
  return { dot: "#71717A", badge: "bg-[#27272A] text-[#71717A]" };
}

export function DayFlights({ date }: { date: string }) {
  const { data: flights = [], isLoading, isError } = useQuery({
    queryKey: ["day-flights", date],
    queryFn: async () => {
      const res = await fetch(`/api/flights?start=${date}&end=${date}`);
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json() as Promise<FlightSummary[]>;
    },
    staleTime: 0,
    retry: 2,
  });

  if (isLoading || isError || flights.length === 0) return null;

  const realFlights = flights.filter(f => !f.is_sim);
  const totalBlockSec = realFlights.reduce((s, f) => s + (f.block_seconds ?? 0), 0);
  const totalH = Math.floor(totalBlockSec / 3600);
  const totalM = Math.floor((totalBlockSec % 3600) / 60);
  const blockLabel = totalBlockSec > 0 ? (totalM > 0 ? `${totalH}h ${totalM}m` : `${totalH}h`) : null;
  const firstFlight = realFlights[0] ?? flights[0];
  const accentColor = firstFlight ? flightOpColor(firstFlight).dot : "#71717A";

  return (
    <section>
      <div
        className="rounded-xl px-4 py-3 mb-3 flex items-center gap-3"
        style={{ background: `${accentColor}12`, borderLeft: `3px solid ${accentColor}` }}
      >
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-widest font-medium" style={{ color: accentColor }}>
            {realFlights.length > 0 ? "Flight duty" : "Simulator session"}
          </p>
          {blockLabel && (
            <p className="text-lg font-semibold text-[#FAFAFA] tabular-nums leading-tight">
              {blockLabel} <span className="text-sm font-normal text-[#52525B]">block</span>
            </p>
          )}
        </div>
        {realFlights.length > 1 && (
          <p className="text-xs text-[#71717A] shrink-0">{realFlights.length} sectors</p>
        )}
      </div>
      <div className="space-y-2">
        {flights.map(f => {
          const blockSec = f.block_seconds ?? 0;
          const bH = Math.floor(blockSec / 3600);
          const bM = Math.floor((blockSec % 3600) / 60);
          const blockStr = blockSec > 0 ? (bH > 0 ? `${bH}h ${bM}m` : `${bM}m`) : "—";
          const role = f.crew_role === "pic" ? "PIC" : f.crew_role === "first_officer" ? "SIC" : f.crew_role || "—";
          const depLabel = f.is_sim ? (f.aircraft_type || "SIM") : (f.dep_icao || f.dep_iata || "?");
          const arrLabel = f.is_sim ? null : (f.arr_icao || f.arr_iata || "?");
          const depTime = f.off_block_utc ? (f.off_block_utc.length > 5 ? f.off_block_utc.slice(11, 16) : f.off_block_utc) : "";
          const arrTime = f.on_block_utc ? (f.on_block_utc.length > 5 ? f.on_block_utc.slice(11, 16) : f.on_block_utc) : "";
          const { dot, badge } = flightOpColor(f);
          return (
            <a key={f.id} href={`/aviation/${f.id}`}
              className="block bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3 hover:border-sky-900/60 transition-colors">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dot }} />
                {f.is_sim ? (
                  <span className="text-violet-300 text-sm font-mono font-semibold">{depLabel}</span>
                ) : (
                  <span className="text-sky-400 text-sm font-mono font-semibold truncate">
                    {depLabel} → {arrLabel}
                  </span>
                )}
                {f.flight_number && <span className="text-[#3F3F46] text-xs shrink-0">{f.flight_number}</span>}
                <span className={`ml-auto text-xs px-1.5 py-0.5 rounded font-mono shrink-0 ${badge}`}>{role}</span>
              </div>
              <div className="flex items-center gap-3 mt-1.5 text-xs text-[#52525B]">
                {depTime && <span className="tabular-nums">{depTime} UTC</span>}
                {arrTime && <span className="tabular-nums">→ {arrTime}</span>}
                <span className="ml-auto text-[#71717A] tabular-nums">{blockStr}</span>
              </div>
              {f.aircraft_type && (
                <p className="text-xs text-[#3F3F46] mt-0.5">
                  {f.aircraft_type}{f.aircraft_reg ? ` · ${f.aircraft_reg}` : ""}
                </p>
              )}
            </a>
          );
        })}
      </div>
    </section>
  );
}
