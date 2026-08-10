"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  passengerFlightsApi,
  type PassengerFlight,
  type PassengerFlightIn,
} from "@/lib/passenger-flights-api";

const inputCls =
  "w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:outline-none focus:border-[#3F3F46]";

interface Props {
  // When date is fixed (day FAB) the date field is hidden; otherwise it's shown.
  date?: string;
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
  const [commuting, setCommuting] = useState(initial?.commuting ?? false);
  const [companion, setCompanion] = useState(initial?.companion ?? "");
  const [seat, setSeat] = useState(initial?.seat ?? "");
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
        reason: reason.trim() || undefined,
        commuting,
        companion: companion.trim() || undefined,
        seat: seat.trim() || undefined,
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
      <div className="grid grid-cols-[1fr_1fr_1fr] gap-2">
        <input value={origin} onChange={(e) => setOrigin(e.target.value)}
          placeholder="From" maxLength={4} className={`${inputCls} uppercase`} />
        <input value={destination} onChange={(e) => setDestination(e.target.value)}
          placeholder="To" maxLength={4} className={`${inputCls} uppercase`} />
        <input value={flightNumber} onChange={(e) => setFlightNumber(e.target.value)}
          placeholder="Flight #" className={`${inputCls} uppercase`} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input value={airline} onChange={(e) => setAirline(e.target.value)}
          placeholder="Airline" className={inputCls} />
        <input value={aircraft} onChange={(e) => setAircraft(e.target.value)}
          placeholder="Aircraft (B737-800)" className={inputCls} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input value={price} onChange={(e) => setPrice(e.target.value)}
          type="number" min="0" step="0.01" placeholder="Price paid (€)" className={inputCls} />
        <input value={companion} onChange={(e) => setCompanion(e.target.value)}
          placeholder="With (optional)" className={inputCls} />
      </div>
      <input value={reason} onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (holiday, wedding…)" className={inputCls} />
      <div className="flex items-center gap-3">
        <input value={seat} onChange={(e) => setSeat(e.target.value)}
          placeholder="Seat" className={`${inputCls} flex-1`} />
        <button type="button" onClick={() => setCommuting((c) => !c)}
          className={`shrink-0 px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
            commuting
              ? "border-[#F59E0B] text-[#F59E0B] bg-[#F59E0B]/10"
              : "border-[#27272A] text-[#52525B] hover:text-[#A1A1AA]"
          }`}>
          ✈ Work commute
        </button>
      </div>
      {error && <p className="text-xs text-[#F87171]">{error}</p>}
      <button type="submit" disabled={saving}
        className="w-full bg-[#F59E0B] hover:bg-[#FBBF24] disabled:opacity-40 text-black font-semibold text-sm rounded-lg py-2.5 transition-colors">
        {saving ? "Saving…" : (submitLabel ?? "Add flight")}
      </button>
    </form>
  );
}
