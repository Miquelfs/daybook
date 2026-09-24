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

// Same red→amber→green ramp DayCard uses for its mood accent — keeps the
// "day" visual language consistent between the timeline and this card.
function moodAccent(mood: number | null): string {
  if (mood == null) return "#27272A";
  if (mood >= 8) return "#22C55E";
  if (mood >= 5) return "#F59E0B";
  return "#EF4444";
}

// A year selector, not a wall of cards: one shared track (like the Timeline
// tab bar / Sleep period picker) carries every year's at-a-glance signal
// (mood, trip, event), and only the tapped year's detail renders below.
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
  const accent = moodAccent(y.mood);
  const isEmpty = y.events.length === 0 && y.restaurants.length === 0 && y.books.length === 0
    && !y.mood_note && !y.notes && !y.mood && !y.trip_city;

  return (
    <div className="flex flex-col gap-3">
      {/* Year selector — one continuous track, not a grid of separate pills */}
      <div className="flex gap-0.5 bg-[#0D0D0F] border border-[#27272A] rounded-lg p-1 overflow-x-auto">
        {entries.map((e, i) => {
          const isSelected = i === selected;
          return (
            <button
              key={e.date}
              onClick={() => setSelected(i)}
              className={`shrink-0 flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                isSelected
                  ? "bg-[#F59E0B]/15 text-[#F59E0B]"
                  : "text-[#71717A] hover:text-[#A1A1AA] hover:bg-[#18181B]"
              }`}
            >
              {e.mood != null && <span className="leading-none">{moodEmoji(e.mood)}</span>}
              {e.trip_city && <span className="leading-none" title={e.trip_city}>🧳</span>}
              {e.events.length > 0 && (
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full ring-1 ring-black/20"
                  style={{ background: EVENT_TYPE_COLOR[e.events[0].type] ?? "#FAFAFA" }}
                />
              )}
              <span className="tabular-nums">{e.date.slice(0, 4)}</span>
            </button>
          );
        })}
      </div>

      {/* Selected year's detail */}
      <div className="relative bg-[#0D0D0F] border border-[#27272A] rounded-xl pl-4 pr-4 py-3.5 overflow-hidden">
        <div className="absolute inset-y-0 left-0 w-1" style={{ background: accent }} />

        <Link href={`/day/${y.date}`} className="flex items-center justify-between gap-3 mb-2 group">
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

        {y.trip_city && (
          <span className="inline-flex items-center gap-1 bg-sky-500/10 text-sky-400 text-xs font-medium rounded-full px-2.5 py-1 mb-2">
            🧳 {y.trip_city}
          </span>
        )}

        {(y.mood_note || y.notes) && (
          <p className="text-sm text-[#A1A1AA] italic mb-2">&ldquo;{y.mood_note || y.notes}&rdquo;</p>
        )}

        {isEmpty && (
          <p className="text-xs text-[#3F3F46]">Nothing specific logged — just marking the date.</p>
        )}

        {y.events.length > 0 && (
          <div className="flex flex-col gap-2 mb-2">
            {y.events.map((ev) => (
              <div key={ev.id} className="flex gap-2.5 items-start">
                <span
                  className="inline-block h-2 w-2 rounded-full mt-1.5 flex-shrink-0"
                  style={{ background: EVENT_TYPE_COLOR[ev.type] ?? "#FAFAFA" }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#FAFAFA]">
                    {ev.label}
                    <span className="ml-1.5 text-[10px] font-normal uppercase tracking-wide text-[#52525B]">{ev.type}</span>
                  </p>
                  {ev.notes && <p className="text-xs text-[#71717A] italic mt-0.5">&ldquo;{ev.notes}&rdquo;</p>}
                </div>
              </div>
            ))}
          </div>
        )}

        {y.restaurants.length > 0 && (
          <div className="flex flex-col gap-1.5 pt-2 border-t border-[#18181B]">
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
          <div className="flex flex-col gap-1.5 pt-2 border-t border-[#18181B]">
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
