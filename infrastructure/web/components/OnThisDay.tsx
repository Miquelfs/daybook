"use client";

import { useState } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { moodEmoji, type LifeEvent } from "@/lib/api";
import { CUISINE_EMOJI } from "@/lib/cuisines";

export type OnThisDayYear = {
  date: string;
  mood: number | null;
  mood_note: string | null;
  notes: string | null;
  trip_city: string | null;
  restaurants: { name: string; city: string | null; cuisine: string | null; rating_mf: number | null }[];
  books: { title: string; author: string; rating: number | null }[];
  events: LifeEvent[];
};

const EVENT_TYPE_COLOR: Record<string, string> = {
  career: "#60a5fa", relationship: "#f472b6", travel: "#34d399",
  loss: "#a1a1aa", achievement: "#fbbf24", other: "#a78bfa",
};

// A year selector, not a wall of cards: the pill row carries the at-a-glance
// signals (mood, trip, event) for every year, but only the SELECTED year's
// detail renders below — tapping a pill swaps it, rather than everything
// being visible (and scrolled past) at once.
export function OnThisDay({ entries, todayDate }: { entries: OnThisDayYear[]; todayDate: string }) {
  const [selected, setSelected] = useState(0);

  if (entries.length === 0) {
    return (
      <p className="text-xs text-[#3F3F46] text-center py-4">
        Nothing recorded on this date in previous years
      </p>
    );
  }

  const y = entries[Math.min(selected, entries.length - 1)];
  const yearsAgo = parseInt(todayDate.slice(0, 4)) - parseInt(y.date.slice(0, 4));

  return (
    <div className="flex flex-col gap-3">
      {/* Year selector */}
      <div className="flex flex-wrap gap-1.5">
        {entries.map((e, i) => {
          const isSelected = i === selected;
          return (
            <button
              key={e.date}
              onClick={() => setSelected(i)}
              className={`inline-flex items-center gap-1 rounded-full pl-2.5 pr-3 py-1.5 text-xs font-medium transition-colors ${
                isSelected
                  ? "bg-[#F59E0B] text-[#09090B]"
                  : "bg-[#0D0D0F] border border-[#27272A] text-[#A1A1AA] hover:border-[#3F3F46] hover:text-[#FAFAFA]"
              }`}
            >
              {e.mood != null && <span>{moodEmoji(e.mood)}</span>}
              {e.trip_city && <span title={e.trip_city}>🧳</span>}
              {e.events.length > 0 && (
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ background: isSelected ? "#09090B" : EVENT_TYPE_COLOR[e.events[0].type] ?? "#FAFAFA" }}
                />
              )}
              {e.date.slice(0, 4)}
            </button>
          );
        })}
      </div>

      {/* Selected year's detail */}
      <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3.5">
        <Link href={`/day/${y.date}`} className="flex items-center justify-between gap-3 mb-1 group">
          <span className="text-xs text-[#52525B] uppercase tracking-widest group-hover:text-[#F59E0B] transition-colors">
            {format(parseISO(y.date), "d MMM yyyy")}
            <span className="text-[#3F3F46]"> · {yearsAgo} year{yearsAgo !== 1 ? "s" : ""} ago</span>
          </span>
          {y.mood != null && (
            <span className="text-sm font-semibold text-[#F59E0B] shrink-0">
              {moodEmoji(y.mood)} {y.mood}/10
            </span>
          )}
        </Link>

        {y.trip_city && <p className="text-xs text-sky-400 mb-1.5">🧳 In {y.trip_city}</p>}

        {(y.mood_note || y.notes) && (
          <p className="text-sm text-[#A1A1AA] italic mb-1.5">&ldquo;{y.mood_note || y.notes}&rdquo;</p>
        )}

        {y.events.length === 0 && y.restaurants.length === 0 && y.books.length === 0 && !y.mood_note && !y.notes && !y.mood && !y.trip_city && (
          <p className="text-xs text-[#3F3F46]">Nothing specific logged — just marking the date.</p>
        )}

        {y.events.length > 0 && (
          <div className="flex flex-col gap-1.5 mb-1.5">
            {y.events.map((ev) => (
              <div key={ev.id} className="flex gap-2 items-start">
                <span
                  className="inline-block h-2 w-2 rounded-full mt-1 flex-shrink-0"
                  style={{ background: EVENT_TYPE_COLOR[ev.type] ?? "#FAFAFA" }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#FAFAFA]">{ev.label}</p>
                  {ev.notes && <p className="text-xs text-[#71717A] italic">&ldquo;{ev.notes}&rdquo;</p>}
                </div>
              </div>
            ))}
          </div>
        )}

        {y.restaurants.length > 0 && (
          <div className="flex flex-col gap-1 pt-1.5 border-t border-[#18181B]">
            {y.restaurants.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-sm">{CUISINE_EMOJI[r.cuisine ?? ""] ?? "🍽"}</span>
                <span className="text-xs text-[#A1A1AA] truncate">{r.name}</span>
                {r.city && <span className="text-xs text-[#52525B] ml-auto shrink-0">{r.city}</span>}
                {r.rating_mf != null && (
                  <span className="text-xs text-[#F59E0B] tabular-nums shrink-0">{r.rating_mf}/10</span>
                )}
              </div>
            ))}
          </div>
        )}

        {y.books.length > 0 && (
          <div className="flex flex-col gap-1 pt-1.5 border-t border-[#18181B]">
            {y.books.map((b, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-sm">📖</span>
                <span className="text-xs text-[#A1A1AA] truncate">{b.title}</span>
                {b.author && <span className="text-xs text-[#52525B] ml-auto shrink-0 max-w-[80px] truncate">{b.author}</span>}
                {b.rating != null && (
                  <span className="text-xs text-[#F59E0B] tabular-nums shrink-0">{"⭐".repeat(b.rating)}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
