"use client";

import { format, parseISO, addDays, subDays, isToday } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

interface Props {
  date: string; // YYYY-MM-DD
}

// One compact line: kicker + date on the left, day navigation inline on the
// right — no separate nav row eating vertical space on the phone.
export function DayHeader({ date }: Props) {
  const d = parseISO(date);
  const prev = format(subDays(d, 1), "yyyy-MM-dd");
  const next = format(addDays(d, 1), "yyyy-MM-dd");
  const isFuture = addDays(d, 1) > new Date();

  return (
    <header className="pt-6 pb-6 border-b border-[#27272A]">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-[#F59E0B] uppercase tracking-[0.2em] mb-1.5">
            {isToday(d) ? "Today" : format(d, "EEEE")}
          </p>
          <h1
            className="font-semibold leading-none tracking-tight text-[#FAFAFA] truncate"
            style={{ fontSize: "clamp(1.75rem, 5.5vw, 3.25rem)" }}
          >
            {format(d, "MMMM d, yyyy")}
          </h1>
        </div>

        <div className="flex items-center gap-1 shrink-0 pb-0.5">
          <Link
            href={`/day/${prev}`}
            title={format(subDays(d, 1), "EEE, MMM d")}
            className="flex items-center justify-center w-9 h-9 rounded-lg border border-[#27272A] text-[#71717A] hover:text-[#FAFAFA] hover:border-[#3F3F46] transition-colors"
          >
            <ChevronLeft size={16} />
          </Link>
          {!isToday(d) && (
            <Link
              href="/"
              title="Jump to today"
              className="flex items-center justify-center h-9 px-2.5 rounded-lg border border-[#F59E0B]/40 text-[10px] uppercase tracking-widest text-[#F59E0B] hover:bg-[#F59E0B]/10 transition-colors"
            >
              Now
            </Link>
          )}
          {isFuture ? (
            <span className="flex items-center justify-center w-9 h-9 rounded-lg border border-[#18181B] text-[#3F3F46] cursor-not-allowed">
              <ChevronRight size={16} />
            </span>
          ) : (
            <Link
              href={`/day/${next}`}
              title={format(addDays(d, 1), "EEE, MMM d")}
              className="flex items-center justify-center w-9 h-9 rounded-lg border border-[#27272A] text-[#71717A] hover:text-[#FAFAFA] hover:border-[#3F3F46] transition-colors"
            >
              <ChevronRight size={16} />
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
