"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { TripCard } from "@/components/TripCard";
import type { Trip } from "@/lib/api";
import { Flag } from "@/components/Flag";

/**
 * Trips grouped by year with collapsible sections, so every trip since the
 * daybook began is reachable without an endless scroll. When a specific year
 * is selected (`filtered`), the page already narrowed the list — render it
 * open with no year headers. Otherwise the newest year is expanded and older
 * years are collapsed.
 */
export function TripYears({
  groups,
  filtered,
}: {
  groups: { year: string; trips: Trip[] }[];
  filtered: boolean;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(groups.map((g, i) => [g.year, i === 0]))
  );

  return (
    <div className="flex flex-col gap-6">
      {groups.map(({ year, trips }) => {
        const isOpen = filtered || open[year];
        const nights = trips.reduce((s, t) => s + t.n_nights, 0);
        const flights = trips.reduce((s, t) => s + t.passenger_flight_count, 0);
        return (
          <div key={year}>
            {!filtered && (
              <button
                onClick={() => setOpen((o) => ({ ...o, [year]: !o[year] }))}
                className="flex items-baseline gap-3 w-full text-left mb-3 group"
                aria-expanded={isOpen}
              >
                <span className="text-xl font-semibold tabular-nums text-[#FAFAFA]">{year}</span>
                <span className="text-xs text-[#71717A] tabular-nums">
                  {trips.length} {trips.length === 1 ? "trip" : "trips"} · {nights} nights{flights ? ` · ${flights} flights` : ""}
                </span>
                <span className="flex-1 border-b border-dashed border-[#27272A] translate-y-[-3px]" />
                <span className="text-[#52525B] group-hover:text-[#A1A1AA]">
                  {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                </span>
              </button>
            )}
            {isOpen && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {trips.map((t) => (
                  <TripCard key={t.id} trip={t} flag={<Flag country={t.primary_country} fallback="" />} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
