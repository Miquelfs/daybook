"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plane, Plus, X, Trash2, Pencil } from "lucide-react";
import { format, parseISO } from "date-fns";
import {
  passengerFlightsApi,
  type PassengerFlight,
  type FlightAnalytics,
} from "@/lib/passenger-flights-api";
import { PassengerFlightForm } from "@/components/PassengerFlightForm";
import { FlightStats } from "@/components/FlightStats";
import { airlineColor } from "@/lib/airline-colors";

export function PassengerFlightsClient({
  initialFlights,
  initialAnalytics,
}: {
  initialFlights: PassengerFlight[];
  initialAnalytics: FlightAnalytics | null;
}) {
  const router = useRouter();
  const [sheet, setSheet] = useState<null | { edit?: PassengerFlight }>(null);
  const [tab, setTab] = useState<"stats" | "log">("stats");

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
            <Plane size={20} className="text-[#F59E0B]" /> Where I&apos;ve Flown
          </h1>
          <p className="text-sm text-[#71717A] mt-0.5">Every flight I&apos;ve taken as a passenger</p>
        </div>
        <button
          onClick={() => setSheet({})}
          className="shrink-0 flex items-center gap-1.5 bg-[#F59E0B] hover:bg-[#FBBF24] text-black text-sm font-semibold rounded-lg px-3 py-2 transition-colors"
        >
          <Plus size={16} /> Add
        </button>
      </div>

      {initialFlights.length === 0 ? (
        <div className="border border-dashed border-[#27272A] rounded-xl px-6 py-12 text-center">
          <Plane size={22} className="text-[#3F3F46] mx-auto mb-2" />
          <p className="text-sm text-[#71717A]">No passenger flights logged yet.</p>
          <p className="text-xs text-[#52525B] mt-0.5">Add one, or import your flight history.</p>
        </div>
      ) : (
        <>
          {/* Stats / Log switch */}
          <div className="flex justify-center mb-6">
            <div className="inline-flex rounded-lg border border-[#27272A] p-0.5 bg-[#09090B]">
              {(["stats", "log"] as const).map((t) => (
                <button key={t} onClick={() => setTab(t)}
                  className={`px-5 py-1.5 text-xs rounded-md transition-colors capitalize ${
                    tab === t ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"
                  }`}>
                  {t === "stats" ? "Statistics" : "Logbook"}
                </button>
              ))}
            </div>
          </div>

          {tab === "stats" && initialAnalytics ? (
            <FlightStats a={initialAnalytics} />
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
        </>
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

function FlightRow({ f, onEdit, onDelete }: { f: PassengerFlight; onEdit: () => void; onDelete: () => void }) {
  const color = airlineColor(f.airline);
  const meta = [f.airline, f.aircraft_code ?? f.aircraft, f.companion && `with ${f.companion}`]
    .filter(Boolean).join(" · ");
  const dist = f.distance_km != null ? `${Math.round(f.distance_km * 0.621371).toLocaleString()} mi` : null;

  return (
    <div className="group relative bg-[#0D0D0F] border border-[#27272A] rounded-xl overflow-hidden hover:border-[#3F3F46] transition-colors">
      {/* airline colour spine */}
      <div className="absolute inset-y-0 left-0 w-1" style={{ background: color }} />
      <div className="pl-4 pr-3 py-3 flex items-center gap-3">
        {/* Date */}
        <div className="w-14 shrink-0">
          <p className="text-sm font-semibold text-[#FAFAFA]">{format(parseISO(f.date), "d MMM")}</p>
          <p className="text-[11px] text-[#52525B]">{format(parseISO(f.date), "yyyy")}</p>
        </div>

        {/* Route + meta */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#FAFAFA] truncate flex items-center gap-1.5">
            <span className="font-mono tracking-tight">{f.origin ?? "—"}</span>
            <Plane size={12} className="text-[#52525B] shrink-0" />
            <span className="font-mono tracking-tight">{f.destination ?? "—"}</span>
            {f.flight_number && <span className="text-[11px] text-[#52525B] font-normal ml-1">{f.flight_number}</span>}
          </p>
          {meta && <p className="text-xs text-[#52525B] truncate mt-0.5">{meta}</p>}
        </div>

        {/* Badges */}
        <div className="hidden sm:flex flex-col items-end gap-1 shrink-0 text-right">
          <div className="flex items-center gap-1.5">
            {f.commuting && <Badge text="Commute" tone="#F59E0B" />}
            {f.reason && !f.commuting && <Badge text={f.reason} tone="#71717A" />}
            {f.flight_class && <Badge text={f.flight_class} tone="#34D399" />}
          </div>
          <span className="text-[11px] text-[#52525B] tabular-nums">
            {[dist, f.seat && `${f.seat}`, f.price_paid ? `€${f.price_paid}` : null].filter(Boolean).join(" · ")}
          </span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={onEdit} className="p-1.5 rounded-lg hover:bg-[#27272A] text-[#71717A]" title="Edit">
            <Pencil size={14} />
          </button>
          <button onClick={onDelete} className="p-1.5 rounded-lg hover:bg-[#27272A] text-[#71717A] hover:text-[#F87171]" title="Delete">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

function Badge({ text, tone }: { text: string; tone: string }) {
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide font-medium"
      style={{ color: tone, background: `${tone}1A` }}>
      {text}
    </span>
  );
}
