"use client";

import { useQuery } from "@tanstack/react-query";
import type { PassengerFlight } from "@/lib/passenger-flights-api";
import { SectionLabel } from "@/components/MorningBrief";

// Passenger flights taken on this day (separate from the pilot roster flights).
// Read-only here — add/edit happens via the day FAB and /explore/passenger-flights.
export function DayPassengerFlights({ date }: { date: string }) {
  const { data: flights = [] } = useQuery<PassengerFlight[]>({
    queryKey: ["day-passenger-flights", date],
    queryFn: async () => {
      const res = await fetch(`/api/passenger-flights?date=${date}`);
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    staleTime: 0,
    retry: 2,
  });

  if (flights.length === 0) return null;

  return (
    <section>
      <SectionLabel>Flights (as passenger)</SectionLabel>
      <div className="flex flex-col gap-2">
        {flights.map((f) => {
          const route = [f.origin, f.destination].filter(Boolean).join(" → ") || "Flight";
          const meta = [f.airline, f.aircraft, f.companion && `with ${f.companion}`]
            .filter(Boolean)
            .join(" · ");
          return (
            <a
              key={f.id}
              href="/explore/passenger-flights"
              className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3 flex items-center gap-3 hover:border-[#3F3F46] transition-colors"
            >
              <span className="text-xl">✈️</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[#FAFAFA] truncate">
                  {route}
                  {f.flight_number && <span className="text-[#52525B] font-normal"> · {f.flight_number}</span>}
                  {f.commuting && <span className="ml-2 text-[10px] text-[#F59E0B] uppercase tracking-wide">commute</span>}
                </p>
                {meta && <p className="text-xs text-[#52525B] truncate">{meta}</p>}
              </div>
              {f.price_paid != null && f.price_paid > 0 && (
                <span className="text-xs text-[#A1A1AA] tabular-nums shrink-0">€{f.price_paid}</span>
              )}
            </a>
          );
        })}
      </div>
    </section>
  );
}
