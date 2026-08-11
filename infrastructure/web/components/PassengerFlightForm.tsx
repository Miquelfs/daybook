"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AirportInfo } from "@/lib/api";
import {
  passengerFlightsApi,
  type PassengerFlight,
  type PassengerFlightIn,
} from "@/lib/passenger-flights-api";

const inputCls =
  "w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:outline-none focus:border-[#3F3F46]";

const CLASSES = ["Economy", "Economy+", "Business", "First"];
const SEAT_TYPES = ["Window", "Middle", "Aisle"];
const REASONS = ["Leisure", "Business", "Crew", "Commuting"];

// Airport autocomplete against the shared 7k-airport DB. Stores the IATA code
// (falls back to raw text) and shows "IATA · City" once chosen.
function AirportPicker({ label, value, onChange }: {
  label: string;
  value: string;
  onChange: (iata: string) => void;
}) {
  const [q, setQ] = useState(value);
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<AirportInfo[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setQ(value); }, [value]);

  useEffect(() => {
    if (!open || q.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(() => {
      passengerFlightsApi.searchAirports(q.trim()).then(setResults).catch(() => setResults([]));
    }, 180);
    return () => clearTimeout(t);
  }, [q, open]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div className="relative" ref={boxRef}>
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value.toUpperCase()); onChange(e.target.value.toUpperCase()); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={label}
        className={`${inputCls} uppercase`}
        autoComplete="off"
      />
      {open && results.length > 0 && (
        <div className="absolute z-10 left-0 right-0 mt-1 bg-[#0D0D0F] border border-[#27272A] rounded-lg max-h-52 overflow-y-auto shadow-xl">
          {results.map((a) => (
            <button
              key={a.icao}
              type="button"
              onClick={() => { onChange(a.iata ?? a.icao); setQ(a.iata ?? a.icao); setOpen(false); }}
              className="w-full text-left px-3 py-2 hover:bg-[#18181B] transition-colors flex items-baseline gap-2"
            >
              <span className="font-mono text-[#FAFAFA] text-sm w-10">{a.iata ?? a.icao}</span>
              <span className="text-xs text-[#A1A1AA] truncate">{a.city}</span>
              <span className="text-[10px] text-[#52525B] ml-auto shrink-0">{a.country}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface Props {
  date?: string;            // fixed date (day FAB) hides the date field
  initial?: PassengerFlight;
  onSaved: () => void;
  submitLabel?: string;
}

export function PassengerFlightForm({ date, initial, onSaved, submitLabel }: Props) {
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);

  const [flightDate, setFlightDate] = useState(initial?.date ?? date ?? today);
  const [flightNumber, setFlightNumber] = useState(initial?.flight_number ?? "");
  const [origin, setOrigin] = useState(initial?.origin ?? "");
  const [destination, setDestination] = useState(initial?.destination ?? "");
  const [airline, setAirline] = useState(initial?.airline ?? "");
  const [aircraft, setAircraft] = useState(initial?.aircraft ?? "");
  const [price, setPrice] = useState(initial?.price_paid != null ? String(initial.price_paid) : "");
  const [reason, setReason] = useState(initial?.reason ?? "");
  const [flightClass, setFlightClass] = useState(initial?.flight_class ?? "");
  const [seatType, setSeatType] = useState(initial?.seat_type ?? "");
  const [seat, setSeat] = useState(initial?.seat ?? "");
  const [companion, setCompanion] = useState(initial?.companion ?? "");
  const [more, setMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body: PassengerFlightIn = {
        date: flightDate,
        flight_number: flightNumber.trim().toUpperCase() || undefined,
        origin: origin.trim().toUpperCase() || undefined,
        destination: destination.trim().toUpperCase() || undefined,
        airline: airline.trim() || undefined,
        aircraft: aircraft.trim() || undefined,
        price_paid: price ? parseFloat(price) : undefined,
        reason: reason || undefined,
        commuting: reason === "Commuting",
        flight_class: flightClass || undefined,
        seat_type: seatType || undefined,
        seat: seat.trim() || undefined,
        companion: companion.trim() || undefined,
      };
      if (initial) await passengerFlightsApi.update(initial.id, body);
      else await passengerFlightsApi.create(body);
      qc.invalidateQueries({ queryKey: ["day-passenger-flights", flightDate] });
      qc.invalidateQueries({ queryKey: ["passenger-flights"] });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {!date && (
        <input type="date" value={flightDate} onChange={(e) => setFlightDate(e.target.value)}
          className={`${inputCls} [color-scheme:dark]`} />
      )}
      <div className="grid grid-cols-[1fr_1fr] gap-2">
        <AirportPicker label="From (BCN)" value={origin} onChange={setOrigin} />
        <AirportPicker label="To (LHR)" value={destination} onChange={setDestination} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input value={flightNumber} onChange={(e) => setFlightNumber(e.target.value.toUpperCase())}
          placeholder="Flight # (FR524)" className={`${inputCls} uppercase`} />
        <input value={airline} onChange={(e) => setAirline(e.target.value)}
          placeholder="Airline" className={inputCls} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <select value={reason} onChange={(e) => setReason(e.target.value)}
          className={`${inputCls} ${reason ? "" : "text-[#52525B]"}`}>
          <option value="">Reason…</option>
          {REASONS.map((r) => <option key={r} value={r} className="text-[#FAFAFA]">{r}</option>)}
        </select>
        <input value={price} onChange={(e) => setPrice(e.target.value)}
          type="number" min="0" step="0.01" placeholder="Price paid (€)" className={inputCls} />
      </div>

      {more ? (
        <div className="space-y-3 pt-1 border-t border-[#18181B]">
          <div className="grid grid-cols-2 gap-2">
            <input value={aircraft} onChange={(e) => setAircraft(e.target.value)}
              placeholder="Aircraft (A320)" className={inputCls} />
            <input value={companion} onChange={(e) => setCompanion(e.target.value)}
              placeholder="With (optional)" className={inputCls} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <select value={flightClass} onChange={(e) => setFlightClass(e.target.value)}
              className={`${inputCls} ${flightClass ? "" : "text-[#52525B]"}`}>
              <option value="">Class…</option>
              {CLASSES.map((c) => <option key={c} value={c} className="text-[#FAFAFA]">{c}</option>)}
            </select>
            <select value={seatType} onChange={(e) => setSeatType(e.target.value)}
              className={`${inputCls} ${seatType ? "" : "text-[#52525B]"}`}>
              <option value="">Seat…</option>
              {SEAT_TYPES.map((s) => <option key={s} value={s} className="text-[#FAFAFA]">{s}</option>)}
            </select>
            <input value={seat} onChange={(e) => setSeat(e.target.value)}
              placeholder="12A" className={inputCls} />
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setMore(true)}
          className="text-xs text-[#52525B] hover:text-[#A1A1AA] transition-colors">
          + aircraft, class, seat…
        </button>
      )}

      {error && <p className="text-xs text-[#F87171]">{error}</p>}
      <button type="submit" disabled={saving}
        className="w-full bg-[#F59E0B] hover:bg-[#FBBF24] disabled:opacity-40 text-black font-semibold text-sm rounded-lg py-2.5 transition-colors">
        {saving ? "Saving…" : (submitLabel ?? "Add flight")}
      </button>
    </form>
  );
}
