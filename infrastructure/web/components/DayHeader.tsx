"use client";

import { format, parseISO, addDays, subDays, isToday } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

interface Props {
  date: string; // YYYY-MM-DD
}

export function DayHeader({ date }: Props) {
  const d = parseISO(date);
  const prev = format(subDays(d, 1), "yyyy-MM-dd");
  const next = format(addDays(d, 1), "yyyy-MM-dd");
  const isFuture = addDays(d, 1) > new Date();
  const todayDate = format(new Date(), "yyyy-MM-dd");

  return (
    <header className="pt-10 pb-8 border-b border-[#27272A]">
      {/* Nav row */}
      <div className="flex items-center justify-between mb-6">
        <Link
          href={isToday(d) ? `/day/${prev}` : `/day/${prev}`}
          className="flex items-center gap-1 text-sm text-[#A1A1AA] hover:text-[#FAFAFA] transition-colors"
        >
          <ChevronLeft size={16} />
          <span className="hidden sm:inline">
            {format(subDays(d, 1), "MMM d")}
          </span>
        </Link>

        {isFuture ? (
          <span className="flex items-center gap-1 text-sm text-[#52525B] cursor-not-allowed">
            <span className="hidden sm:inline">
              {format(addDays(d, 1), "MMM d")}
            </span>
            <ChevronRight size={16} />
          </span>
        ) : (
          <Link
            href={isToday(d) ? `/day/${todayDate}` : `/day/${next}`}
            className="flex items-center gap-1 text-sm text-[#A1A1AA] hover:text-[#FAFAFA] transition-colors"
          >
            <span className="hidden sm:inline">
              {format(addDays(d, 1), "MMM d")}
            </span>
            <ChevronRight size={16} />
          </Link>
        )}
      </div>

      {/* Date hero */}
      <div>
        <p className="text-xs text-[#F59E0B] uppercase tracking-[0.2em] mb-2">
          {isToday(d) ? "Today" : format(d, "EEEE")}
        </p>
        <h1
          className="font-semibold leading-none tracking-tight text-[#FAFAFA]"
          style={{ fontSize: "clamp(2rem, 6vw, 4rem)" }}
        >
          {format(d, "MMMM d, yyyy")}
        </h1>
      </div>
    </header>
  );
}
