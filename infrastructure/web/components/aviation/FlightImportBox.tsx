"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, ClipboardPaste, Loader, Check } from "lucide-react";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type ImportedFlight = {
  date?: string; flight_number?: string; dep_iata?: string; arr_iata?: string; aircraft_reg?: string;
  off_block_utc?: string; takeoff_utc?: string; landing_utc?: string; on_block_utc?: string;
  block_minutes?: number; airborne_minutes?: number;
  fuel_block_kg?: number; fuel_uplift_kg?: number; fuel_burn_kg?: number; fuel_trip_kg?: number; fuel_remaining_kg?: number;
  pax_total?: number; pax_adult?: number; pax_child?: number; pax_infant?: number;
  baggage_kg?: number; bags_pcs?: number; freight_kg?: number; holds_kg?: Record<string, number>;
  zones?: Record<string, number>; avg_bag_kg?: number; remarks?: string; source?: string;
};
type ParseResp = {
  loadsheet_id: number; parsed: ImportedFlight; dep_icao: string | null; arr_icao: string | null;
  match: { id: string; date: string; flight_number: string | null; route: string } | null;
};

function summary(p: ImportedFlight) {
  const bits = [
    [p.flight_number, p.dep_iata && p.arr_iata ? `${p.dep_iata}→${p.arr_iata}` : null, p.date].filter(Boolean).join(" · "),
    p.aircraft_reg,
    p.pax_total != null ? `${p.pax_total} pax${p.pax_infant ? ` +${p.pax_infant} inf` : ""}` : null,
    p.bags_pcs != null ? `${p.bags_pcs} bags` : null,
    p.baggage_kg != null ? `${p.baggage_kg} kg baggage` : null,
    p.freight_kg ? `${p.freight_kg} kg cargo` : null,
    p.fuel_block_kg ? `block fuel ${p.fuel_block_kg} kg` : null,
    p.off_block_utc && p.on_block_utc ? `${p.off_block_utc}–${p.on_block_utc}Z` : null,
  ];
  return bits.filter(Boolean).join(" · ");
}

/**
 * Paste the loadsheet / final-figures message, or snap the FMC: the form gets
 * prefilled — or, if the flight is already in the logbook, its empty fields
 * get filled in one tap.
 */
export function FlightImportBox({ onPrefill, onApplied }: {
  onPrefill: (p: ImportedFlight, icao: { dep: string | null; arr: string | null }, loadsheetId: number) => void;
  onApplied: () => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<ParseResp | null>(null);
  const [applied, setApplied] = useState<string[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function read(file?: File) {
    setBusy(true); setErr(null); setRes(null); setApplied(null);
    try {
      const fd = new FormData();
      if (text.trim()) fd.append("text", text);
      if (file) fd.append("file", file);
      const r = await fetch(`${BASE}/flights/import/parse`, { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.detail ?? "Couldn't read that");
      setRes(d);
      if (!d.match) onPrefill(d.parsed, { dep: d.dep_icao, arr: d.arr_icao }, d.loadsheet_id);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't read that"); }
    finally { setBusy(false); }
  }

  async function applyToMatch() {
    if (!res?.match) return;
    setBusy(true);
    try {
      const r = await fetch(`${BASE}/flights/import/${res.loadsheet_id}/apply`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ flight_id: res.match.id }),
      });
      const d = await r.json();
      setApplied(d.filled ?? []);
      qc.invalidateQueries({ queryKey: ["flights"] });
      qc.invalidateQueries({ queryKey: ["flight", res.match.id] });
      setTimeout(onApplied, 1500);
    } finally { setBusy(false); }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed border-[#3F3F46] text-sm text-[#A1A1AA] hover:text-[#FAFAFA]">
        <ClipboardPaste size={14} /> Import loadsheet message or FMC photo
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-[#27272A] bg-[#0D0D0F] p-3 space-y-2.5">
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4}
        placeholder={"Paste the final-figures message, e.g.\nD85623/OSLPMI/15OCT26 …"}
        className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-base sm:text-sm font-mono text-[#FAFAFA] placeholder:text-[#3F3F46] outline-none focus:border-[#52525B] resize-none" />
      <div className="flex gap-2">
        <button type="button" onClick={() => read()} disabled={busy || !text.trim()}
          className="flex-1 py-2 rounded-lg bg-[#F59E0B] text-[#09090B] text-sm font-semibold disabled:opacity-40 flex items-center justify-center gap-1.5">
          {busy ? <Loader size={14} className="animate-spin" /> : null} Read message
        </button>
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
          className="px-3 py-2 rounded-lg border border-[#27272A] text-sm text-[#A1A1AA] flex items-center gap-1.5">
          <Camera size={14} /> FMC photo
        </button>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) read(f); e.target.value = ""; }} />
      </div>

      {err && <p className="text-xs text-[#F87171]">{err}</p>}

      {res && (
        <div className="rounded-lg bg-[#18181B] px-3 py-2.5 space-y-1.5">
          <p className="text-xs text-[#E4E4E7]">{summary(res.parsed)}</p>
          {res.parsed.holds_kg && (
            <p className="text-[11px] text-[#71717A]">
              Holds {Object.entries(res.parsed.holds_kg).map(([h, kg]) => `${h}:${kg}`).join(" · ")}
              {res.parsed.zones ? ` · zones ${Object.entries(res.parsed.zones).map(([z, n]) => `${z}${n}`).join("/")}` : ""}
              {res.parsed.avg_bag_kg ? ` · avg bag ${res.parsed.avg_bag_kg} kg` : ""}
            </p>
          )}
          {res.match ? (
            applied ? (
              <p className="text-xs text-[#4ADE80] flex items-center gap-1">
                <Check size={12} /> Added to {res.match.flight_number ?? "the flight"} ({applied.length ? applied.join(", ").replaceAll("_", " ") : "nothing was empty"})
              </p>
            ) : (
              <button type="button" onClick={applyToMatch} disabled={busy}
                className="w-full py-2 rounded-lg bg-[#F59E0B]/15 border border-[#F59E0B]/40 text-[#F59E0B] text-xs font-semibold">
                Already logged ({res.match.route} {res.match.date}) — add these figures to it
              </button>
            )
          ) : (
            <p className="text-[11px] text-[#4ADE80]">Filled in below. Check it and save. If you save later, it still attaches to the flight once it's logged.</p>
          )}
        </div>
      )}
    </div>
  );
}
