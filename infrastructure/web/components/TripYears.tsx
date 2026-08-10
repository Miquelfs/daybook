"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { TripCard } from "@/components/TripCard";
import type { Trip } from "@/lib/api";

/**
 * Trips grouped by year with collapsible sections, so every trip since the
 * daybook began is reachable without an endless scroll. When a specific year
 * is selected (`filtered`), the page already narrowed the list — render it
 * open with no year headers. Otherwise the newest year is expanded and older
 * years are collapsed.
 */
export function TripYears({
  groups,
  flags,
  filtered,
}: {
  groups: { year: string; trips: Trip[] }[];
  flags: Record<string, string>;
  filtered: boolean;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(groups.map((g, i) => [g.year, i === 0]))
  );

  return (
    <div className="flex flex-col gap-3">
      {groups.map(({ year, trips }, i) => {
        const isOpen = filtered || open[year];
        const nights = trips.reduce((s, t) => s + t.n_nights, 0);
        return (
          <div key={year}>
            {!filtered && (
              <button
                onClick={() => setOpen((o) => ({ ...o, [year]: !o[year] }))}
                className="flex items-center gap-1.5 w-full text-left mb-2 text-[#71717A] hover:text-[#A1A1AA] transition-colors"
                aria-expanded={isOpen}
              >
                {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <span className="text-xs tabular-nums font-medium">{year}</span>
                <span className="text-xs text-[#3F3F46]">
                  · {trips.length} {trips.length === 1 ? "trip" : "trips"} · {nights} nights away
                </span>
              </button>
            )}
            {isOpen && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {trips.map((t) => (
                  <TripCard key={t.id} trip={t} flag={flags[t.primary_country ?? ""] ?? "🌍"} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
