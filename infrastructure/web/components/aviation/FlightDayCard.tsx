"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { CalendarDays, ChevronRight } from "lucide-react";
import { api, type FlightSummary } from "@/lib/api";

// The flight, seen from the day it belongs to: how you slept and felt, where you
// were and who with, the photo, and the rest of the duty — one tap to the day.

const WEATHER_ICON: Record<string, string> = {
  sunny: "☀️", clear: "☀️", partly_cloudy: "⛅", cloudy: "☁️", overcast: "☁️", fog: "🌫️",
  drizzle: "🌦️", rain: "🌧️", showers: "🌦️", snow: "❄️", thunderstorm: "⛈️", storm: "⛈️",
};

const photoSrc = (url: string) => `/api/photos/${url.replace(/^\/photos\//, "").replace(/^.*\//, "")}`;
const hm = (s: number) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;

export function FlightDayCard({ flightId, date }: { flightId: string; date: string }) {
  const { data: day } = useQuery({
    queryKey: ["day", date],
    queryFn: () => api.day(date),
    staleTime: 60_000,
    retry: 1,
  });
  const { data: sectors = [] } = useQuery({
    queryKey: ["day-flights", date],
    queryFn: () => api.flights({ start: date, end: date }),
    staleTime: 60_000,
  });

  const s = day?.subjective;
  const facts = [
    s?.mood != null ? `Mood ${s.mood}` : null,
    s?.energy != null ? `Energy ${s.energy}` : null,
    day?.sleep?.duration_seconds ? `Slept ${hm(day.sleep.duration_seconds)}` : null,
  ].filter(Boolean);
  const w = day?.weather?.temp_max != null ? day.weather : null;
  const cities = day?.location?.cities?.slice(0, 4) ?? [];
  const tags = day?.tags?.filter((t) => t.icon).slice(0, 8) ?? [];

  return (
    <section className="mb-3">
      <Link href={`/day/${date}`}
        className="block bg-[#0D0D0F] border border-[#27272A] rounded-2xl overflow-hidden hover:border-[#3F3F46] transition-colors group">
        <div className="flex gap-3 p-4">
          {day?.photo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoSrc(day.photo_url)} alt="" className="w-20 h-20 rounded-xl object-cover shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-[#71717A]">
              <CalendarDays size={11} />That day
            </p>
            <p className="text-sm font-semibold text-[#FAFAFA] mt-0.5">{format(parseISO(date), "EEEE d MMMM yyyy")}</p>
            {(facts.length > 0 || w) && (
              <p className="text-xs text-[#A1A1AA] mt-1 tabular-nums">
                {facts.join(" · ")}
                {w && <>{facts.length ? " · " : ""}{WEATHER_ICON[w.condition ?? ""] ?? "🌡️"} {Math.round(w.temp_max ?? 0)}°</>}
              </p>
            )}
            {(cities.length > 0 || (day?.companions?.length ?? 0) > 0) && (
              <p className="text-xs text-[#71717A] mt-0.5 truncate">
                {cities.join(" · ")}
                {day?.companions?.length ? `${cities.length ? " · " : ""}with ${day.companions.join(", ")}` : ""}
              </p>
            )}
            {s?.mood_note && <p className="text-xs text-[#A1A1AA] italic mt-1 line-clamp-2">“{s.mood_note}”</p>}
            {tags.length > 0 && <p className="text-sm mt-1 tracking-wide" title={tags.map((t) => t.name).join(", ")}>{tags.map((t) => t.icon).join(" ")}</p>}
            {!day && <p className="text-xs text-[#52525B] mt-1">Open the day in your Daybook</p>}
          </div>
          <ChevronRight size={16} className="text-[#3F3F46] group-hover:text-[#F59E0B] self-center shrink-0 transition-colors" />
        </div>
      </Link>

      {sectors.length > 1 && (
        <div className="flex gap-1.5 mt-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {sectors.map((f: FlightSummary, i: number) => {
            const here = f.id === flightId;
            const label = f.is_sim ? "SIM" : `${f.dep_iata ?? f.dep_icao} → ${f.arr_iata ?? f.arr_icao}`;
            return here ? (
              <span key={f.id} className="shrink-0 px-2.5 py-1 rounded-lg text-xs font-mono bg-[#F59E0B]/15 border border-[#F59E0B]/40 text-[#F59E0B]">
                {i + 1}. {label}
              </span>
            ) : (
              <Link key={f.id} href={`/aviation/${f.id}`}
                className="shrink-0 px-2.5 py-1 rounded-lg text-xs font-mono bg-[#18181B] border border-[#27272A] text-[#A1A1AA] hover:text-[#FAFAFA]">
                {i + 1}. {label}
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
