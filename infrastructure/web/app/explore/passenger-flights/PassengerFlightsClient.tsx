"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plane, Plus, X, Trash2, Pencil } from "lucide-react";
import { format, parseISO } from "date-fns";
import {
  passengerFlightsApi,
  type PassengerFlight,
  type PassengerFlightStats,
} from "@/lib/passenger-flights-api";
import { PassengerFlightForm } from "@/components/PassengerFlightForm";

export function PassengerFlightsClient({
  initialFlights,
  initialStats,
}: {
  initialFlights: PassengerFlight[];
  initialStats: PassengerFlightStats | null;
}) {
  const router = useRouter();
  const [sheet, setSheet] = useState<null | { edit?: PassengerFlight }>(null);

  const byYear = useMemo(() => {
    const map = new Map<string, PassengerFlight[]>();
    for (const f of initialFlights) {
      const y = f.date.slice(0, 4);
      if (!map.has(y)) map.set(y, []);
      map.get(y)!.push(f);
    }
    return [...map.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [initialFlights]);

  async function del(id: number) {
    if (!confirm("Delete this flight?")) return;
    await passengerFlightsApi.delete(id);
    router.refresh();
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Plane size={20} className="text-[#F59E0B]" /> Flights as passenger
          </h1>
          <p className="text-sm text-[#71717A] mt-0.5">Trips I flew on — not as the pilot</p>
        </div>
        <button
          onClick={() => setSheet({})}
          className="shrink-0 flex items-center gap-1.5 bg-[#F59E0B] hover:bg-[#FBBF24] text-black text-sm font-semibold rounded-lg px-3 py-2 transition-colors"
        >
          <Plus size={16} /> Add
        </button>
      </div>

      {/* Stat tiles */}
      {initialStats && initialStats.total > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-7">
          <StatTile label="Flights" value={initialStats.total.toLocaleString()} />
          <StatTile label="Airports" value={initialStats.distinct_airports.toLocaleString()} />
          <StatTile label="In the air" value={`${initialStats.total_hours.toLocaleString()} h`} />
          <StatTile label="Spent" value={`€${initialStats.total_spent.toLocaleString()}`} />
        </div>
      )}

      {/* List grouped by year */}
      {initialFlights.length === 0 ? (
        <div className="border border-dashed border-[#27272A] rounded-xl px-6 py-12 text-center">
          <Plane size={22} className="text-[#3F3F46] mx-auto mb-2" />
          <p className="text-sm text-[#71717A]">No passenger flights logged yet.</p>
          <p className="text-xs text-[#52525B] mt-0.5">Add one, or import your Notion export.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {byYear.map(([year, flights]) => (
            <div key={year}>
              <p className="text-xs text-[#52525B] uppercase tracking-widest mb-2">
                {year} · {flights.length} flight{flights.length > 1 ? "s" : ""}
              </p>
              <div className="flex flex-col gap-2">
                {flights.map((f) => (
                  <FlightRow key={f.id} f={f} onEdit={() => setSheet({ edit: f })} onDelete={() => del(f.id)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add / edit sheet */}
      {sheet && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={() => setSheet(null)}>
          <div
            className="w-full max-w-2xl bg-[#09090B] border border-[#27272A] rounded-t-2xl px-5 py-6 pb-10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1 bg-[#3F3F46] rounded-full mx-auto -mt-2 mb-3" />
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-semibold text-[#FAFAFA]">
                {sheet.edit ? "Edit flight" : "Add a flight"}
              </p>
              <button onClick={() => setSheet(null)} className="text-[#52525B] hover:text-[#A1A1AA]">
                <X size={16} />
              </button>
            </div>
            <PassengerFlightForm
              initial={sheet.edit}
              submitLabel={sheet.edit ? "Save changes" : "Add flight"}
              onSaved={() => { setSheet(null); router.refresh(); }}
            />
          </div>
        </div>
      )}
    </>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#18181B] border border-[#27272A] rounded-xl px-4 py-3">
      <p className="text-xs text-[#52525B] uppercase tracking-widest">{label}</p>
      <p className="text-xl font-semibold tabular-nums mt-0.5">{value}</p>
    </div>
  );
}

function FlightRow({ f, onEdit, onDelete }: { f: PassengerFlight; onEdit: () => void; onDelete: () => void }) {
  const route = [f.origin, f.destination].filter(Boolean).join(" → ") || "—";
  const meta = [
    f.airline,
    f.aircraft,
    f.companion && `with ${f.companion}`,
    f.seat && `seat ${f.seat}`,
  ].filter(Boolean).join(" · ");

  return (
    <div className="group bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3 flex items-center gap-3 hover:border-[#3F3F46] transition-colors">
      <div className="w-16 shrink-0">
        <p className="text-sm font-semibold text-[#FAFAFA]">{format(parseISO(f.date), "d MMM")}</p>
        <p className="text-[11px] text-[#52525B]">{f.flight_number ?? ""}</p>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[#FAFAFA] truncate">
          {route}
          {f.commuting && <span className="ml-2 text-[10px] text-[#F59E0B] uppercase tracking-wide">commute</span>}
        </p>
        {meta && <p className="text-xs text-[#52525B] truncate">{meta}</p>}
        {f.reason && !f.commuting && <p className="text-xs text-[#71717A] truncate">{f.reason}</p>}
      </div>
      {f.price_paid != null && f.price_paid > 0 && (
        <span className="text-xs text-[#A1A1AA] tabular-nums shrink-0">€{f.price_paid}</span>
      )}
      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={onEdit} className="p-1.5 rounded-lg hover:bg-[#27272A] text-[#71717A]" title="Edit">
          <Pencil size={14} />
        </button>
        <button onClick={onDelete} className="p-1.5 rounded-lg hover:bg-[#27272A] text-[#71717A] hover:text-[#F87171]" title="Delete">
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}
