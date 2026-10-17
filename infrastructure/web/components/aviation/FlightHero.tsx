"use client";

import { format, parseISO } from "date-fns";
import { Plane, Moon, Sun } from "lucide-react";
import type { FlightDetail } from "@/lib/api";

const clock = (iso: string | null | undefined) => (iso && iso.length >= 16 ? iso.slice(11, 16) : "—");
const hm = (s: number | null | undefined) =>
  s ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}` : "—";
const secs = (a: string | null | undefined, b: string | null | undefined) =>
  a && b && a.length >= 16 && b.length >= 16 ? (Date.parse(b) - Date.parse(a)) / 1000 : null;

/** Boarding-pass header, the flight's timeline (taxi · airborne · taxi) and its key numbers. */
export function FlightHero({ f }: { f: FlightDetail & { takeoff_utc?: string | null; landing_utc?: string | null; ifr_seconds?: number | null; takeoff_crew?: string | null; landing_crew?: string | null } }) {
  const dep = f.dep_iata ?? f.dep_icao ?? "?";
  const arr = f.arr_iata ?? f.arr_icao ?? "?";
  const depCity = f.dep_airport?.city || f.dep_airport?.name || "";
  const arrCity = f.arr_airport?.city || f.arr_airport?.name || "";
  const role = f.crew_role === "pic" ? "PIC" : f.crew_role === "first_officer" ? "First officer" : f.crew_role || "—";

  const taxiOut = secs(f.off_block_utc, f.takeoff_utc);
  const air = secs(f.takeoff_utc, f.landing_utc) ?? f.airborne_seconds;
  const taxiIn = secs(f.landing_utc, f.on_block_utc);
  const total = (taxiOut ?? 0) + (air ?? 0) + (taxiIn ?? 0);
  const nightPct = f.airborne_seconds || f.block_seconds ? Math.min(100, ((f.night_seconds || 0) / (f.airborne_seconds || f.block_seconds || 1)) * 100) : 0;
  const flew = [f.takeoffs_day + f.takeoffs_night > 0 ? `take-off${f.takeoffs_night ? " (night)" : ""}` : null,
                f.landings_day + f.landings_night > 0 ? `landing${f.landings_night ? " (night)" : ""}` : null].filter(Boolean);

  return (
    <div className="bg-[#0D0D0F] border border-[#27272A] rounded-2xl overflow-hidden mb-4">
      <div className="p-5">
        <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-[#71717A]">
          <span>{format(parseISO(f.date), "EEE d MMM yyyy")}</span>
          <span className="font-mono tracking-normal text-xs">{f.flight_number ?? ""}</span>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 mt-3">
          <div className="min-w-0">
            <p className="text-4xl font-semibold font-mono tracking-tight">{dep}</p>
            <p className="text-xs text-[#71717A] truncate">{depCity}{f.dep_iata && f.dep_icao ? ` · ${f.dep_icao}` : ""}</p>
            <p className="text-sm font-mono tabular-nums mt-1">{clock(f.off_block_utc)} <span className="text-[10px] text-[#71717A]">UTC</span></p>
          </div>
          <div className="flex flex-col items-center text-[#71717A] min-w-[84px]">
            <span className="text-sm font-semibold text-[#FAFAFA] tabular-nums">{hm(f.block_seconds)}</span>
            <div className="flex items-center w-full gap-1 my-1">
              <span className="flex-1 border-t border-dashed border-[#3F3F46]" />
              <Plane size={14} className="text-[#F59E0B]" />
              <span className="flex-1 border-t border-dashed border-[#3F3F46]" />
            </div>
            <span className="text-[10px] tabular-nums">{f.distance_nm ? `${Math.round(f.distance_nm)} nm` : "block"}</span>
          </div>
          <div className="min-w-0 text-right">
            <p className="text-4xl font-semibold font-mono tracking-tight">{arr}</p>
            <p className="text-xs text-[#71717A] truncate">{arrCity}{f.arr_iata && f.arr_icao ? ` · ${f.arr_icao}` : ""}</p>
            <p className="text-sm font-mono tabular-nums mt-1">{clock(f.on_block_utc)} <span className="text-[10px] text-[#71717A]">UTC</span></p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-4">
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${f.crew_role === "pic" ? "bg-[#F59E0B]/15 text-amber-400" : "bg-[#27272A] text-[#A1A1AA]"}`}>{role}</span>
          {f.is_sim && <span className="text-[11px] px-2 py-0.5 rounded bg-[#27272A] text-[#A1A1AA]">FSTD</span>}
          <span className="text-xs text-[#71717A]">{[f.aircraft_type, f.aircraft_reg, f.operator].filter(Boolean).join(" · ")}</span>
        </div>
      </div>

      {total > 0 && !f.is_sim && (
        <div className="px-5 pb-4">
          <div className="flex h-2.5 rounded-full overflow-hidden gap-[2px]">
            {taxiOut ? <div style={{ flexGrow: taxiOut, background: "var(--viz-i1)" }} title={`Taxi out ${hm(taxiOut)}`} /> : null}
            {air ? <div style={{ flexGrow: air, background: "var(--viz-spd)" }} title={`Airborne ${hm(air)}`} /> : null}
            {taxiIn ? <div style={{ flexGrow: taxiIn, background: "var(--viz-i1)" }} title={`Taxi in ${hm(taxiIn)}`} /> : null}
          </div>
          <div className="flex justify-between text-[10px] text-[#71717A] mt-1 tabular-nums">
            <span>taxi {taxiOut ? hm(taxiOut) : "—"}</span>
            <span>T/O {clock(f.takeoff_utc)} · airborne {hm(air)} · LDG {clock(f.landing_utc)}</span>
            <span>taxi {taxiIn ? hm(taxiIn) : "—"}</span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 border-t border-[#27272A] divide-x divide-[#27272A]">
        <div className="px-4 py-3">
          <p className="text-[10px] text-[#52525B] uppercase tracking-widest">PIC / SIC</p>
          <p className="text-sm font-semibold tabular-nums">{hm(f.pic_seconds) !== "—" ? hm(f.pic_seconds) : hm(f.sic_seconds)}</p>
          <p className="text-[11px] text-[#71717A]">{f.pic_seconds ? "as PIC" : "as SIC"}</p>
        </div>
        <div className="px-4 py-3">
          <p className="text-[10px] text-[#52525B] uppercase tracking-widest">Day / night</p>
          <p className="text-sm font-semibold tabular-nums flex items-center gap-1">
            {nightPct > 0 ? <><Moon size={12} className="text-[#A1A1AA]" />{hm(f.night_seconds)}</> : <><Sun size={12} className="text-[#A1A1AA]" />all day</>}
          </p>
          <p className="text-[11px] text-[#71717A]">{nightPct > 0 ? `${Math.round(nightPct)}% at night` : ""}{f.ifr_seconds ? `${nightPct > 0 ? " · " : ""}IFR ${hm(f.ifr_seconds)}` : ""}</p>
        </div>
        <div className="px-4 py-3">
          <p className="text-[10px] text-[#52525B] uppercase tracking-widest">You flew</p>
          <p className="text-sm font-semibold">{flew.length ? flew.join(" + ") : "—"}</p>
          <p className="text-[11px] text-[#71717A] truncate">{[f.takeoff_crew && `T/O ${f.takeoff_crew}`, f.landing_crew && `LDG ${f.landing_crew}`].filter(Boolean).join(" · ")}</p>
        </div>
      </div>
    </div>
  );
}
