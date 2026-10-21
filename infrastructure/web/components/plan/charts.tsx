"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { localISODate } from "@/lib/dates";

const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

const AMBER = "#F59E0B";
const ROSE = "#E11D48";

/**
 * A year as twelve small month calendars (Mon-first) — readable on a phone,
 * each month with its count. `slip` colours logged days rose — for habits
 * you're cutting down, where a logged day is the miss. Today is outlined.
 */
export function YearHeatmap({ dates, year, slip = false }: { dates: string[]; year: number; slip?: boolean }) {
  const have = new Set(dates);
  const today = localISODate();
  const fill = slip ? ROSE : AMBER;

  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 gap-x-4 gap-y-4">
      {MONTH_NAMES.map((name, m) => {
        const first = new Date(year, m, 1);
        const days = new Date(year, m + 1, 0).getDate();
        const lead = (first.getDay() + 6) % 7;
        const prefix = `${year}-${String(m + 1).padStart(2, "0")}-`;
        const count = dates.filter((d) => d.startsWith(prefix)).length;
        const ahead = `${prefix}01` > today;
        return (
          <div key={m} className={ahead ? "opacity-35" : ""}>
            <p className="flex justify-between text-[10px] mb-1">
              <span className="text-[#71717A]">{name}</span>
              <span className="tabular-nums text-[#52525B]">{count || ""}</span>
            </p>
            <div className="grid grid-cols-7 gap-[2px]">
              {Array.from({ length: lead }).map((_, k) => <span key={`l${k}`} />)}
              {Array.from({ length: days }).map((_, k) => {
                const iso = `${prefix}${String(k + 1).padStart(2, "0")}`;
                const on = have.has(iso);
                return (
                  <span key={iso} title={`${iso}${on ? (slip ? " · logged" : " · done") : ""}`}
                        className={`aspect-square rounded-[3px] ${on ? "" : "bg-[#18181B]"} ${iso > today ? "opacity-40" : ""}`}
                        style={{
                          ...(on ? { background: fill } : {}),
                          ...(iso === today ? { outline: `1.5px solid ${AMBER}`, outlineOffset: 1 } : {}),
                        }} />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Bars({ values, labels, highlight, faded, format: fmt }: {
  values: number[];
  labels: string[];
  highlight?: number;
  faded?: (i: number) => boolean;
  format?: (v: number) => string;
}) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex items-end gap-1.5 h-28">
      {values.map((v, i) => (
        <div key={i} className={`flex-1 min-w-0 flex flex-col items-center gap-1 h-full justify-end ${faded?.(i) ? "opacity-30" : ""}`}>
          <span className="text-[10px] tabular-nums text-[#71717A]">{v ? (fmt ? fmt(v) : v) : ""}</span>
          <div className={`w-full rounded-t-sm ${i === highlight ? "bg-[#F59E0B]" : "bg-[#F59E0B]/45"}`}
               style={{ height: `${(v / max) * 72}%`, minHeight: v ? 2 : 0 }} />
          <span className={`text-[10px] ${i === highlight ? "text-[#F59E0B]" : "text-[#52525B]"}`}>{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}

/** Days per month for a year; the running month highlighted, months ahead faded. */
export function MonthBars({ counts, year }: { counts: number[]; year: number }) {
  const now = new Date();
  const cur = year === now.getFullYear() ? now.getMonth() : undefined;
  return <Bars values={counts} labels={MONTHS} highlight={cur}
               faded={(i) => year > now.getFullYear() || (year === now.getFullYear() && i > now.getMonth())} />;
}

/** Monday … Sunday distribution. */
export function WeekdayBars({ counts }: { counts: number[] }) {
  const top = counts.indexOf(Math.max(...counts));
  return <Bars values={counts} labels={WEEKDAYS} highlight={counts[top] ? top : undefined} />;
}

/** One bar per year. */
export function YearBars({ data }: { data: { year: number; days: number }[] }) {
  const now = new Date().getFullYear();
  return <Bars values={data.map((d) => d.days)} labels={data.map((d) => `’${String(d.year).slice(2)}`)}
               highlight={data.findIndex((d) => d.year === now)} />;
}

/** ‹ 2026 › */
export function YearSwitcher({ years, year, onChange }: { years: number[]; year: number; onChange: (y: number) => void }) {
  const i = years.indexOf(year);
  const btn = "p-1 rounded-md text-[#71717A] hover:text-[#FAFAFA] disabled:opacity-25 disabled:hover:text-[#71717A]";
  return (
    <div className="inline-flex items-center gap-1">
      <button className={btn} disabled={i <= 0} onClick={() => onChange(years[i - 1])} aria-label="Previous year"><ChevronLeft size={14} /></button>
      <span className="text-xs tabular-nums text-[#A1A1AA] w-9 text-center">{year}</span>
      <button className={btn} disabled={i < 0 || i >= years.length - 1} onClick={() => onChange(years[i + 1])} aria-label="Next year"><ChevronRight size={14} /></button>
    </div>
  );
}

/** A labelled number, Omyra style. */
export function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] text-[#52525B] uppercase tracking-widest">{label}</p>
      <p className={`text-2xl font-semibold tabular-nums ${tone ?? ""}`}>{value}</p>
      {sub && <p className="text-xs text-[#71717A] truncate">{sub}</p>}
    </div>
  );
}
