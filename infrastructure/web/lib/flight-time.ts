// How a logbook entry's time splits up — shared by the Hours chart, the flight
// list filter and the flight rows.
//
// School flights logged as "first_officer" with no PIC/SIC time are dual
// instruction (student with an instructor): their block time is dual, not lost.
// Simulator sessions are FSTD time, kept apart from aircraft block time.

import type { FlightSummary } from "@/lib/api";

export type TimeFunction = "pic" | "sic" | "dual" | "sim";

export const FUNCTION_LABEL: Record<TimeFunction, string> = {
  pic: "PIC", sic: "Co-pilot", dual: "Dual", sim: "Simulator",
};
export const FUNCTION_SHORT: Record<TimeFunction, string> = {
  pic: "PIC", sic: "SIC", dual: "DUAL", sim: "SIM",
};
export const FUNCTION_COLOR: Record<TimeFunction, string> = {
  pic: "var(--viz-i4)", sic: "var(--viz-spd)", dual: "var(--viz-pw)", sim: "var(--viz-cad)",
};

/** Seconds per function for one entry. */
export function timeSplit(f: FlightSummary): Record<TimeFunction, number> {
  const block = f.block_seconds ?? f.pic_seconds + f.sic_seconds;
  if (f.is_sim) return { pic: 0, sic: 0, dual: 0, sim: block };
  return { pic: f.pic_seconds, sic: f.sic_seconds, dual: Math.max(0, block - f.pic_seconds - f.sic_seconds), sim: 0 };
}

/** The entry's main function (largest share) — for badges and the role filter. */
export function mainFunction(f: FlightSummary): TimeFunction {
  if (f.is_sim) return "sim";
  const s = timeSplit(f);
  if (s.pic >= s.sic && s.pic >= s.dual && s.pic > 0) return "pic";
  if (s.sic >= s.dual && s.sic > 0) return "sic";
  return s.dual > 0 ? "dual" : f.crew_role === "pic" ? "pic" : "sic";
}

/** Aircraft family — groups the many type spellings across importers. */
export function aircraftFamily(f: FlightSummary): string {
  if (f.is_sim) return "Simulator";
  const t = (f.aircraft_type ?? "").toUpperCase();
  if (/DA-?20/.test(t)) return "DA20";
  if (/DA-?40/.test(t)) return "DA40";
  if (/SENECA|PA-?34/.test(t)) return "Seneca";
  if (/MAX/.test(t)) return "737 MAX";
  if (/737|B73|73[78H]/.test(t)) return "737NG";
  if (!t) return f.operator ? "737 (type n/a)" : "Other";
  return f.aircraft_type!.split(/\s+/).slice(0, 2).join(" ");
}

/** Where the time was flown — school, airline, simulator. */
export function flightOperator(f: FlightSummary): string {
  if (f.is_sim) return "Simulator";
  if (f.operator) return f.operator;
  return f.source === "aerolink" ? "Flight school" : "Other";
}

export const SERIES_PALETTE = [
  "var(--viz-spd)", "var(--viz-i4)", "var(--viz-pw)", "var(--viz-cad)",
  "var(--viz-hr)", "var(--viz-mood)", "var(--viz-alt)", "var(--viz-i6)",
];
