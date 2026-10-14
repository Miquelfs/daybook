"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Wrench } from "lucide-react";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Item = { id: string; date: string; route: string; block_s: number; night_s: number; span_s?: number };
type Report = { flights_checked: number; total: number; issues: Record<string, Item[]> };

const LABEL: Record<string, string> = {
  night_gt_block: "Night time longer than the flight",
  rollover: "On-block saved on the wrong day (±24 h)",
  span_mismatch: "Block times don't match block duration",
  block_missing: "Block duration missing",
  airborne_gt_block: "Airborne time longer than block",
  absurd_block: "Implausible block time",
};
const FIXABLE = new Set(["night_gt_block", "rollover", "block_missing"]);
const hhmm = (s: number) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;

/** Shown only when the logbook has impossible / inconsistent times. */
export function LogbookChecks() {
  const qc = useQueryClient();
  const [fixing, setFixing] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const { data, refetch } = useQuery<Report>({
    queryKey: ["logbook-integrity"],
    queryFn: () => fetch(`${BASE}/flights/checks/integrity`, { cache: "no-store" }).then((r) => r.json()),
  });
  if (!data || data.total === 0) return null;

  async function fix() {
    setFixing(true);
    try {
      const r = await fetch(`${BASE}/flights/checks/integrity/fix`, { method: "POST" }).then((x) => x.json());
      const f = r.fixed ?? {};
      setDone(`Fixed ${f.rollover ?? 0} wrong dates, filled ${f.block_filled ?? 0} block times, recomputed night on ${f.night_recomputed ?? 0} flights.`);
      await refetch();
      for (const k of ["flightAnalytics", "flightStats", "flights", "flightRoutes"]) qc.invalidateQueries({ queryKey: [k] });
    } finally { setFixing(false); }
  }

  const groups = Object.entries(data.issues).filter(([, v]) => v.length);
  const fixable = groups.some(([k]) => FIXABLE.has(k));
  return (
    <div className="rounded-2xl border border-[#B45309] bg-[#1C1700] p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle size={16} className="text-[#F59E0B] mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#FCD34D]">{data.total} logbook entr{data.total === 1 ? "y" : "ies"} look wrong</p>
          <p className="text-xs text-[#A1A1AA] mt-0.5">These distort records like “longest flight” and “most night in a flight”.</p>
          <ul className="mt-3 space-y-2">
            {groups.map(([k, items]) => (
              <li key={k}>
                <p className="text-xs text-[#E4E4E7]">{LABEL[k] ?? k} · {items.length}</p>
                <p className="text-[11px] text-[#71717A] mt-0.5">
                  {items.slice(0, 3).map((i) => `${i.date} ${i.route} (block ${hhmm(i.block_s)}${i.night_s ? `, night ${hhmm(i.night_s)}` : ""}${i.span_s ? `, times span ${hhmm(i.span_s)}` : ""})`).join(" · ")}
                  {items.length > 3 ? ` · +${items.length - 3} more` : ""}
                </p>
              </li>
            ))}
          </ul>
          {fixable && (
            <button onClick={fix} disabled={fixing}
              className="mt-3 inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-[#F59E0B] text-[#09090B] font-semibold disabled:opacity-50">
              <Wrench size={12} /> {fixing ? "Fixing…" : "Fix what's provable"}
            </button>
          )}
          {done && <p className="text-xs text-[#4ADE80] mt-2">{done}</p>}
          <p className="text-[10px] text-[#52525B] mt-2">
            Only provable fixes: wrong on-block dates (from the block duration), missing block times, and night time
            recomputed over the block. Anything else stays for you to check.
          </p>
        </div>
      </div>
    </div>
  );
}
