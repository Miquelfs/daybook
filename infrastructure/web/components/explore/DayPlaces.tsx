"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Sparkles } from "lucide-react";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type DayPlaceStats = {
  date: string; places: number;
  new_places: { name: string; city: string | null }[];
  new_countries: string[];
};

const placeHref = (name: string) => `/explore/place/${encodeURIComponent(name)}`;

/** Under the day's map, only when it happened: how many first visits (and a first country).
 *  Tap it to see which — each one links to its place. */
export function DayPlaces({ date }: { date: string }) {
  const [open, setOpen] = useState(false);
  const { data } = useQuery<DayPlaceStats>({
    queryKey: ["place-day", date],
    queryFn: () => fetch(`${BASE}/locations/place-stats/day/${date}`).then((r) => r.json()),
    staleTime: 600_000,
  });
  const n = data?.new_places.length ?? 0;
  if (!data || (!n && !data.new_countries.length)) return null;

  return (
    <div className="mt-2.5">
      <button onClick={() => n > 0 && setOpen(!open)} disabled={n === 0}
              className="inline-flex items-center gap-1.5 text-xs text-[#A1A1AA] hover:text-[#FAFAFA] transition-colors disabled:hover:text-[#A1A1AA]">
        <Sparkles size={12} className="text-[#F59E0B]" />
        {n > 0 && <><b className="text-[#FAFAFA] font-medium tabular-nums">{n}</b> first visit{n === 1 ? "" : "s"}</>}
        {data.new_countries.length > 0 && <>{n > 0 ? " · " : ""}first time in {data.new_countries.join(", ")}</>}
        {n > 0 && <ChevronDown size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} />}
      </button>
      {open && (
        <ul className="mt-2 space-y-1">
          {data.new_places.map((p) => (
            <li key={`${p.name}|${p.city ?? ""}`} className="flex items-baseline gap-2 text-sm">
              <Link href={placeHref(p.name)} className="text-[#FAFAFA] hover:text-[#F59E0B] transition-colors truncate">
                {p.name}
              </Link>
              {p.city && p.city !== p.name && <span className="text-xs text-[#52525B] truncate">{p.city}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
