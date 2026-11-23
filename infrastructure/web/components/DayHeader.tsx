"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { format, parseISO, addDays, subDays, isToday } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { GarminSyncButton } from "@/components/GarminSyncButton";
import { DayCalendar } from "@/components/DayCalendar";

const MAX_PX = 52;
const MIN_PX = 20;

// One line, as big as it fits: starts at MAX_PX and shrinks to the width it has
// (re-measured when the window or the buttons beside it change size).
function FitTitle({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLHeadingElement>(null);
  const [px, setPx] = useState(MAX_PX);
  useLayoutEffect(() => {
    const fit = () => {
      const b = box.current, t = text.current;
      if (!b || !t) return;
      t.style.fontSize = `${MAX_PX}px`;
      const need = t.scrollWidth, room = b.clientWidth;
      const next = need > room ? Math.max(MIN_PX, Math.floor((MAX_PX * room) / need)) : MAX_PX;
      t.style.fontSize = `${next}px`;
      setPx(next);
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, [children]);
  return (
    <div ref={box} className="min-w-0 w-full overflow-hidden">
      <h1 ref={text} className="font-semibold leading-[1.15] tracking-tight text-[#FAFAFA] whitespace-nowrap w-max max-w-none"
          style={{ fontSize: px }}>
        {children}
      </h1>
    </div>
  );
}

interface Props {
  date: string; // YYYY-MM-DD
}

// One compact line: kicker + date on the left, day navigation inline on the
// right — no separate nav row eating vertical space on the phone. When
// "September 30, 2026" doesn't fit next to the buttons, the whole title shrinks to
// fit (FitTitle) instead of being cut or wrapped.
export function DayHeader({ date }: Props) {
  const d = parseISO(date);
  const prev = format(subDays(d, 1), "yyyy-MM-dd");
  const next = format(addDays(d, 1), "yyyy-MM-dd");
  const isFuture = addDays(d, 1) > new Date();

  return (
    <header className="pt-6 pb-6 border-b border-[#27272A]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-[#F59E0B] uppercase tracking-[0.2em] mb-1.5">
            {isToday(d) ? "Today" : format(d, "EEEE")}
          </p>
          <FitTitle>
            {format(d, "MMMM d, yyyy")}
          </FitTitle>
        </div>

        <div className="flex items-center gap-1 shrink-0 sm:pb-0.5">
          <GarminSyncButton date={date} />
          <DayCalendar date={date} />
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
