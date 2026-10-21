"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { addMonths, format, getDaysInMonth, parseISO, startOfMonth, subMonths } from "date-fns";
import { CalendarDays, CalendarSearch, ChevronLeft, ChevronRight, X } from "lucide-react";
import { localISODate } from "@/lib/dates";

type Mark = { kind: "trip" | "trip_planned" | "event" | "achievement" | "birthday" | "logged"; label: string | null };
type View = "days" | "months" | "years";

const DOT: Record<string, string> = { event: "#F59E0B", achievement: "#10B981", birthday: "#DB2777" };
const KIND_LABEL: Record<string, string> = {
  trip: "Trip", trip_planned: "Planned trip", event: "Event", achievement: "Achievement", birthday: "Birthday",
};
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FIRST_YEAR = 1990;

/**
 * Jump to any day. Days view: special days stand out — a line under trip days,
 * dots for life events (amber), achievements (green) and birthdays (pink);
 * filled-in days read brighter. Tap the title for months, again for years.
 * `variant="label"` is the compact "Jump to date" button (Timeline).
 */
export function DayCalendar({ date, variant = "icon" }: { date?: string; variant?: "icon" | "label" }) {
  const today = localISODate();
  const anchor = date ?? today;
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("days");
  const [month, setMonth] = useState(() => startOfMonth(parseISO(anchor)));
  const key = format(month, "yyyy-MM");
  const year = month.getFullYear();
  const thisYear = new Date().getFullYear();
  const { data: marks = {} } = useQuery<Record<string, Mark[]>>({
    queryKey: ["calendar-marks", key],
    queryFn: () => fetch(`/api/calendar/marks?month=${key}`).then((r) => (r.ok ? r.json() : {})),
    enabled: open && view === "days",
    staleTime: 5 * 60_000,
  });

  function show() {
    setMonth(startOfMonth(parseISO(anchor)));
    setView("days");
    setOpen(true);
  }

  const lead = (month.getDay() + 6) % 7;
  const days = getDaysInMonth(month);
  const decade = Math.floor(year / 12) * 12;                    // 12 years per page
  const navBtn = "p-1.5 rounded-lg text-[#71717A] hover:text-[#FAFAFA] disabled:opacity-25";

  const prev = () => (view === "days" ? setMonth(subMonths(month, 1))
    : view === "months" ? setMonth(new Date(year - 1, month.getMonth(), 1))
    : setMonth(new Date(year - 12, month.getMonth(), 1)));
  const next = () => (view === "days" ? setMonth(addMonths(month, 1))
    : view === "months" ? setMonth(new Date(year + 1, month.getMonth(), 1))
    : setMonth(new Date(year + 12, month.getMonth(), 1)));
  const atStart = view === "years" ? decade <= FIRST_YEAR : view === "months" ? year <= FIRST_YEAR : false;
  const atEnd = view === "years" ? decade + 12 > thisYear + 1 : view === "months" ? year >= thisYear + 1 : false;

  return (
    <>
      {variant === "icon" ? (
        <button onClick={show} title="Pick a day" aria-label="Pick a day"
                className="flex items-center justify-center w-9 h-9 rounded-lg border border-[#27272A] text-[#71717A] hover:text-[#FAFAFA] hover:border-[#3F3F46] transition-colors">
          <CalendarDays size={16} />
        </button>
      ) : (
        <button onClick={show}
                className="shrink-0 flex items-center gap-1.5 bg-[#0D0D0F] border border-[#27272A] rounded-lg px-2.5 py-1.5 text-xs text-[#A1A1AA] hover:border-[#3F3F46] hover:text-[#FAFAFA] transition-colors">
          <CalendarSearch size={13} className="text-[#52525B]" /> Jump to date
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center" onClick={() => setOpen(false)}>
          <div className="w-full sm:max-w-sm bg-[#0D0D0F] border border-[#27272A] rounded-t-2xl sm:rounded-2xl p-5 pb-8 sm:pb-5"
               onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <button onClick={prev} disabled={atStart} aria-label="Previous" className={navBtn}><ChevronLeft size={16} /></button>
              <button
                onClick={() => setView(view === "days" ? "months" : "years")}
                disabled={view === "years"}
                className="px-2 py-1 rounded-lg text-sm font-semibold text-[#FAFAFA] hover:bg-[#18181B] disabled:hover:bg-transparent tabular-nums"
                title={view === "days" ? "Pick a month" : view === "months" ? "Pick a year" : undefined}
              >
                {view === "days" ? format(month, "MMMM yyyy") : view === "months" ? year : `${decade} – ${decade + 11}`}
              </button>
              <div className="flex items-center gap-1">
                <button onClick={next} disabled={atEnd} aria-label="Next" className={navBtn}><ChevronRight size={16} /></button>
                <button onClick={() => setOpen(false)} aria-label="Close" className="p-1.5 rounded-lg text-[#52525B] hover:text-[#FAFAFA]"><X size={15} /></button>
              </div>
            </div>

            {view === "years" && (
              <div className="grid grid-cols-3 gap-2">
                {Array.from({ length: 12 }).map((_, i) => {
                  const y = decade + i;
                  const off = y < FIRST_YEAR || y > thisYear + 1;
                  return (
                    <button key={y} disabled={off} onClick={() => { setMonth(new Date(y, month.getMonth(), 1)); setView("months"); }}
                            className={`h-11 rounded-lg text-sm tabular-nums transition-colors ${
                              y === year ? "bg-[#F59E0B] text-black font-semibold"
                                : y === thisYear ? "ring-1 ring-[#F59E0B] text-[#FAFAFA]"
                                : off ? "text-[#27272A]" : "text-[#A1A1AA] hover:bg-[#18181B]"}`}>
                      {y}
                    </button>
                  );
                })}
              </div>
            )}

            {view === "months" && (
              <div className="grid grid-cols-3 gap-2">
                {MONTHS.map((m, i) => {
                  const isCur = year === thisYear && i === new Date().getMonth();
                  const isSel = i === month.getMonth();
                  return (
                    <button key={m} onClick={() => { setMonth(new Date(year, i, 1)); setView("days"); }}
                            className={`h-11 rounded-lg text-sm transition-colors ${
                              isSel ? "bg-[#F59E0B] text-black font-semibold"
                                : isCur ? "ring-1 ring-[#F59E0B] text-[#FAFAFA]"
                                : "text-[#A1A1AA] hover:bg-[#18181B]"}`}>
                      {m}
                    </button>
                  );
                })}
              </div>
            )}

            {view === "days" && (
              <div className="grid grid-cols-7 gap-1 text-center">
                {WEEKDAYS.map((d, i) => <span key={i} className="text-[10px] text-[#52525B] pb-1">{d}</span>)}
                {Array.from({ length: lead }).map((_, i) => <span key={`l${i}`} />)}
                {Array.from({ length: days }).map((_, i) => {
                  const iso = `${key}-${String(i + 1).padStart(2, "0")}`;
                  const ms = marks[iso] ?? [];
                  const kinds = new Set(ms.map((m) => m.kind));
                  const future = iso > today;
                  const isViewed = date != null && iso === date;
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
                        <span className={`absolute bottom-0 left-1 right-1 ${
                          kinds.has("trip") ? "h-0.5 rounded-full bg-sky-500" : "border-t border-dashed border-sky-500"}`} />
                      )}
                    </span>
                  );
                  return future
                    ? <span key={iso} title={title} className="cursor-default">{cell}</span>
                    : <Link key={iso} href={iso === today ? "/" : `/day/${iso}`} title={title} onClick={() => setOpen(false)}>{cell}</Link>;
                })}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-4 pt-3 border-t border-[#27272A] text-[10px] text-[#71717A]">
              {view === "days" ? (
                <>
                  <span className="inline-flex items-center gap-1"><span className="w-3 h-0.5 rounded-full bg-sky-500" /> Trip</span>
                  <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ background: DOT.event }} /> Event</span>
                  <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ background: DOT.achievement }} /> Achievement</span>
                  <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ background: DOT.birthday }} /> Birthday</span>
                </>
              ) : (
                <span>{view === "months" ? "Pick a month" : "Pick a year"}</span>
              )}
              <button onClick={() => { setMonth(startOfMonth(new Date())); setView("days"); }}
                      className="ml-auto text-[#F59E0B] uppercase tracking-widest">This month</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
