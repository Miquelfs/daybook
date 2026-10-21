"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { addMonths, format, getDaysInMonth, parseISO, startOfMonth, subMonths } from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { localISODate } from "@/lib/dates";

type Mark = { kind: "trip" | "trip_planned" | "event" | "achievement" | "birthday" | "logged"; label: string | null };

const DOT: Record<string, string> = { event: "#F59E0B", achievement: "#10B981", birthday: "#DB2777" };
const KIND_LABEL: Record<string, string> = {
  trip: "Trip", trip_planned: "Planned trip", event: "Event", achievement: "Achievement", birthday: "Birthday",
};
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

/**
 * Jump to any day: a month calendar where special days stand out — a line under
 * trip days, dots for life events (amber), achievements (green) and birthdays
 * (pink); days you filled in read brighter.
 */
export function DayCalendar({ date }: { date: string }) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => startOfMonth(parseISO(date)));
  const key = format(month, "yyyy-MM");
  const today = localISODate();
  const { data: marks = {} } = useQuery<Record<string, Mark[]>>({
    queryKey: ["calendar-marks", key],
    queryFn: () => fetch(`/api/calendar/marks?month=${key}`).then((r) => (r.ok ? r.json() : {})),
    enabled: open,
    staleTime: 5 * 60_000,
  });

  const lead = (month.getDay() + 6) % 7;
  const days = getDaysInMonth(month);

  return (
    <>
      <button onClick={() => { setMonth(startOfMonth(parseISO(date))); setOpen(true); }} title="Pick a day" aria-label="Pick a day"
              className="flex items-center justify-center w-9 h-9 rounded-lg border border-[#27272A] text-[#71717A] hover:text-[#FAFAFA] hover:border-[#3F3F46] transition-colors">
        <CalendarDays size={16} />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center" onClick={() => setOpen(false)}>
          <div className="w-full sm:max-w-sm bg-[#0D0D0F] border border-[#27272A] rounded-t-2xl sm:rounded-2xl p-5 pb-8 sm:pb-5"
               onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <button onClick={() => setMonth(subMonths(month, 1))} aria-label="Previous month"
                      className="p-1.5 rounded-lg text-[#71717A] hover:text-[#FAFAFA]"><ChevronLeft size={16} /></button>
              <p className="text-sm font-semibold text-[#FAFAFA]">{format(month, "MMMM yyyy")}</p>
              <div className="flex items-center gap-1">
                <button onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month"
                        className="p-1.5 rounded-lg text-[#71717A] hover:text-[#FAFAFA]"><ChevronRight size={16} /></button>
                <button onClick={() => setOpen(false)} aria-label="Close"
                        className="p-1.5 rounded-lg text-[#52525B] hover:text-[#FAFAFA]"><X size={15} /></button>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-1 text-center">
              {WEEKDAYS.map((d, i) => <span key={i} className="text-[10px] text-[#52525B] pb-1">{d}</span>)}
              {Array.from({ length: lead }).map((_, i) => <span key={`l${i}`} />)}
              {Array.from({ length: days }).map((_, i) => {
                const iso = `${key}-${String(i + 1).padStart(2, "0")}`;
                const ms = marks[iso] ?? [];
                const kinds = new Set(ms.map((m) => m.kind));
                const future = iso > today;
                const isViewed = iso === date;
                const trip = kinds.has("trip") || kinds.has("trip_planned");
                const title = [format(parseISO(iso), "EEE d MMM"),
                  ...ms.filter((m) => m.kind !== "logged").map((m) => `${KIND_LABEL[m.kind]}${m.label ? `: ${m.label}` : ""}`)].join("\n");
                const cell = (
                  <span className={`relative flex flex-col items-center justify-center h-10 rounded-lg text-sm tabular-nums transition-colors ${
                    isViewed ? "bg-[#F59E0B] text-black font-semibold"
                      : iso === today ? "ring-1 ring-[#F59E0B] text-[#FAFAFA]"
                      : kinds.has("logged") ? "text-[#FAFAFA] hover:bg-[#18181B]"
                      : future ? "text-[#3F3F46]" : "text-[#71717A] hover:bg-[#18181B]"}`}>
                    {i + 1}
                    <span className="absolute bottom-1 flex gap-0.5">
                      {(["event", "achievement", "birthday"] as const).filter((k) => kinds.has(k)).map((k) => (
                        <span key={k} className="w-1 h-1 rounded-full" style={{ background: isViewed ? "#000" : DOT[k] }} />
                      ))}
                    </span>
                    {trip && (
                      <span className={`absolute bottom-0 left-1 right-1 h-0.5 rounded-full ${
                        kinds.has("trip") ? "bg-sky-500" : "border-t border-dashed border-sky-500"}`} />
                    )}
                  </span>
                );
                return future
                  ? <span key={iso} title={title} className="cursor-default">{cell}</span>
                  : <Link key={iso} href={iso === today ? "/" : `/day/${iso}`} title={title} onClick={() => setOpen(false)}>{cell}</Link>;
              })}
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-4 pt-3 border-t border-[#27272A] text-[10px] text-[#71717A]">
              <span className="inline-flex items-center gap-1"><span className="w-3 h-0.5 rounded-full bg-sky-500" /> Trip</span>
              <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ background: DOT.event }} /> Event</span>
              <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ background: DOT.achievement }} /> Achievement</span>
              <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ background: DOT.birthday }} /> Birthday</span>
              <Link href="/" onClick={() => setOpen(false)} className="ml-auto text-[#F59E0B] uppercase tracking-widest">Today</Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
