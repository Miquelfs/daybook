"use client";

import { useState } from "react";
import Link from "next/link";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from "recharts";
import { format, parseISO, differenceInCalendarDays } from "date-fns";
import { ShieldCheck, ShieldAlert, Moon, Plane } from "lucide-react";
import type { LogbookStats, CurrencyStatus, FlightTimeLimits, FlightSummary } from "@/lib/api";
import {
  timeSplit, aircraftFamily, flightOperator, FUNCTION_COLOR, FUNCTION_LABEL, SERIES_PALETTE, type TimeFunction,
} from "@/lib/flight-time";

// Logbook overview, in the same card language as the activity / health views:
// a hero with the career numbers, one "legal & current" card, and hours by year.

const TIP = {
  contentStyle: { background: "#09090B", border: "1px solid #27272A", borderRadius: 8, fontSize: 12 },
  labelStyle: { color: "#A1A1AA" }, itemStyle: { color: "#FAFAFA" },
};
const AXIS = { tick: { fill: "var(--viz-axis)", fontSize: 11 }, tickLine: false, axisLine: false } as const;

export const hhmm = (h: number) => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
const hrs = (s: number) => s / 3600;

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-[#0D0D0F] border border-[#27272A] rounded-2xl ${className}`}>{children}</div>;
}

// ── hero ─────────────────────────────────────────────────────────────────────
export function LogbookHero({ stats, flights }: { stats: LogbookStats; flights: FlightSummary[] }) {
  const t = stats.totals;
  const real = flights.filter((f) => !f.is_sim);
  const last = real.length ? real.reduce((a, b) => (a.date >= b.date ? a : b)) : null;
  // career split by function — PIC / co-pilot / dual (school) / simulator
  const split = flights.reduce((acc, f) => {
    const s = timeSplit(f);
    (Object.keys(s) as TimeFunction[]).forEach((k) => { acc[k] += hrs(s[k]); });
    return acc;
  }, { pic: 0, sic: 0, dual: 0, sim: 0 } as Record<TimeFunction, number>);
  const allTime = split.pic + split.sic + split.dual + split.sim;
  const parts = (["pic", "sic", "dual", "sim"] as TimeFunction[]).filter((k) => split[k] > 0);
  const nightPct = t.block_hours ? Math.round((t.night_hours / t.block_hours) * 100) : 0;
  const since = last ? differenceInCalendarDays(new Date(), parseISO(last.date)) : null;

  return (
    <Panel className="p-5 mb-6">
      <p className="text-[10px] uppercase tracking-[0.2em] text-[#71717A]">Total block time</p>
      <p className="mt-1 flex items-baseline gap-2">
        <span className="text-4xl font-semibold tracking-tight tabular-nums">{hhmm(t.block_hours)}</span>
        <span className="text-sm text-[#A1A1AA]">{t.sectors.toLocaleString()} sectors</span>
      </p>
      <p className="text-xs text-[#A1A1AA] mt-1 tabular-nums">
        {stats.airports_visited} airports · {stats.countries_visited} countries
        {t.distance_nm ? ` · ${Math.round(t.distance_nm).toLocaleString()} nm` : ""}
        {t.sim_sessions > 0 ? ` · sim ${hhmm(t.sim_hours)} (${t.sim_sessions})` : ""}
      </p>

      <div className="flex h-2.5 rounded-full overflow-hidden gap-[2px] mt-4">
        {parts.map((k) => <div key={k} style={{ width: `${(split[k] / allTime) * 100}%`, background: FUNCTION_COLOR[k] }} />)}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#71717A] mt-1.5 tabular-nums">
        {parts.map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: FUNCTION_COLOR[k] }} />{FUNCTION_LABEL[k]} {hhmm(split[k])}
          </span>
        ))}
        <span className="flex items-center gap-1.5 ml-auto"><Moon size={11} />Night {hhmm(t.night_hours)} · {nightPct}%</span>
      </div>

      <div className="grid grid-cols-4 gap-2 mt-4 pt-4 border-t border-[#27272A] text-center">
        {[["T/O day", t.takeoffs_day], ["T/O night", t.takeoffs_night], ["Ldg day", t.landings_day], ["Ldg night", t.landings_night]].map(([l, v]) => (
          <div key={l as string}>
            <p className="text-lg font-semibold tabular-nums">{(v as number).toLocaleString()}</p>
            <p className="text-[10px] text-[#71717A] uppercase tracking-wider">{l}</p>
          </div>
        ))}
      </div>

      {last && (
        <Link href={`/aviation/${last.id}`} className="flex items-center gap-2 mt-4 pt-4 border-t border-[#27272A] text-xs group">
          <Plane size={13} className="text-[#71717A]" />
          <span className="text-[#71717A]">Last flight</span>
          <span className="font-medium">{last.dep_iata ?? last.dep_icao} → {last.arr_iata ?? last.arr_icao}</span>
          <span className="text-[#71717A] tabular-nums">· {format(parseISO(last.date), "d MMM")}{since != null ? ` (${since === 0 ? "today" : `${since} d ago`})` : ""}</span>
          <span className="ml-auto text-[#71717A] group-hover:text-[#F59E0B]">→</span>
        </Link>
      )}
    </Panel>
  );
}

// ── legal & current ──────────────────────────────────────────────────────────
export function LegalCard({ currency, limits }: { currency?: CurrencyStatus; limits?: FlightTimeLimits }) {
  if (!currency && !limits) return null;
  const current = (currency?.takeoffs_landings_90d ?? 0) >= 3;
  const daysLeft = currency?.next_expiry_date ? differenceInCalendarDays(parseISO(currency.next_expiry_date), new Date()) : null;
  const soon = daysLeft != null && daysLeft <= 30;
  const ok = current && !soon;

  return (
    <section className="mb-6">
      <p className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Legal & current</p>
      <Panel className="p-4">
        {currency && (
          <div className="flex items-start gap-3">
            {ok ? <ShieldCheck size={22} className="text-emerald-400 shrink-0 mt-0.5" /> : <ShieldAlert size={22} className="text-amber-400 shrink-0 mt-0.5" />}
            <div className="flex-1 min-w-0">
              <p className={`text-lg font-semibold ${ok ? "" : "text-amber-400"}`}>
                {current ? (soon ? `Current — expires in ${daysLeft} days` : "Current") : "Not current"}
              </p>
              <p className="text-xs text-[#71717A] tabular-nums">
                {currency.takeoffs_90d} take-offs · {currency.landings_90d} landings in 90 days
                {currency.next_expiry_date ? ` · until ${format(parseISO(currency.next_expiry_date), "d MMM yyyy")}` : ""}
              </p>
              <p className="text-xs mt-1">
                <Moon size={11} className="inline -mt-0.5 mr-1 text-[#71717A]" />
                {currency.night_current
                  ? <span className="text-[#A1A1AA]">Night pax current{currency.night_expiry_date ? ` until ${format(parseISO(currency.night_expiry_date), "d MMM")}` : ""}</span>
                  : <span className="text-amber-400">Night pax not held — 1 night T/O + 1 night landing needed</span>}
              </p>
            </div>
          </div>
        )}
        {limits && (
          <div className={`space-y-3 ${currency ? "mt-4 pt-4 border-t border-[#27272A]" : ""}`}>
            <p className="text-[10px] text-[#52525B] uppercase tracking-widest">Flight-time limits · ORO.FTL.210</p>
            {[limits.days_28, limits.months_12, limits.calendar_year].map((w) => {
              const pct = Math.min(100, (w.hours / w.limit_hours) * 100);
              const tone = pct >= 90 ? "var(--viz-hr)" : pct >= 75 ? "var(--viz-i4)" : "var(--viz-spd)";
              return (
                <div key={w.label}>
                  <div className="flex items-baseline justify-between text-xs mb-1">
                    <span className="text-[#A1A1AA]">{w.label}</span>
                    <span className="tabular-nums"><span className="font-semibold">{Math.round(w.hours)} h</span>
                      <span className="text-[#71717A]"> / {Math.round(w.limit_hours)} · {Math.round(w.limit_hours - w.hours)} h left</span></span>
                  </div>
                  <div className="h-2 bg-[#18181B] rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: tone }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </section>
  );
}

// ── hours by year / month ────────────────────────────────────────────────────
type Mode = "function" | "aircraft" | "operator";
const MODES: { id: Mode; label: string }[] = [
  { id: "function", label: "Role" }, { id: "aircraft", label: "Aircraft" }, { id: "operator", label: "Where" },
];

export function HoursCard({ flights, selected = null, onSelectPeriod }: {
  flights: FlightSummary[];
  selected?: string | null;                       // "YYYY" or "YYYY-MM"
  onSelectPeriod?: (period: string | null) => void;
}) {
  const thisYear = new Date().getFullYear();
  const years = Array.from(new Set(flights.map((f) => Number(f.date.slice(0, 4))))).sort((a, b) => b - a);
  const [picked, setYear] = useState<number | "all" | null>(null);
  const [mode, setMode] = useState<Mode>("function");
  const year = picked ?? (years.includes(thisYear) ? thisYear : years[0] ?? "all");   // default once flights load

  // series: one key per function / aircraft family / operator, biggest first
  const keyOf = (f: FlightSummary) => mode === "aircraft" ? aircraftFamily(f) : flightOperator(f);
  const add = (acc: Record<string, number>, f: FlightSummary) => {
    if (mode === "function") {
      const s = timeSplit(f);
      for (const k of Object.keys(s) as TimeFunction[]) acc[k] = (acc[k] ?? 0) + hrs(s[k]);
    } else {
      const k = keyOf(f);
      acc[k] = (acc[k] ?? 0) + hrs(f.block_seconds ?? f.pic_seconds + f.sic_seconds);
    }
    return acc;
  };
  const inScope = year === "all" ? flights : flights.filter((f) => f.date.startsWith(String(year)));
  const totals = inScope.reduce(add, {} as Record<string, number>);
  const keys = (mode === "function" ? (["pic", "sic", "dual", "sim"] as string[]) : Object.keys(totals).sort((a, b) => totals[b] - totals[a]))
    .filter((k) => (totals[k] ?? 0) > 0);
  const color = (k: string, i: number) => mode === "function" ? FUNCTION_COLOR[k as TimeFunction] : SERIES_PALETTE[i % SERIES_PALETTE.length];
  const name = (k: string) => mode === "function" ? FUNCTION_LABEL[k as TimeFunction] : k;

  const row = (period: string, label: string) => {
    const fs = flights.filter((f) => f.date.startsWith(period));
    return { period, label, ...fs.reduce(add, {} as Record<string, number>),
             night: fs.reduce((a, f) => a + hrs(f.night_seconds), 0), n: fs.filter((f) => !f.is_sim).length };
  };
  const span = years.length ? Array.from({ length: years[0] - years[years.length - 1] + 1 }, (_, i) => years[years.length - 1] + i) : [];
  const data = year === "all"
    ? span.map((y) => row(String(y), String(y)))
    : Array.from({ length: 12 }, (_, i) => row(`${year}-${String(i + 1).padStart(2, "0")}`, format(new Date(2000, i, 1), "MMM")));

  const real = inScope.filter((f) => !f.is_sim);
  const block = real.reduce((a, f) => a + hrs(f.block_seconds ?? f.pic_seconds + f.sic_seconds), 0);
  const sim = inScope.filter((f) => f.is_sim).reduce((a, f) => a + hrs(f.block_seconds ?? 0), 0);

  // same-date comparison with the previous year
  const todayMD = format(new Date(), "MM-dd");
  const ytd = (y: number) => flights.filter((f) => !f.is_sim && f.date.startsWith(String(y)) && f.date.slice(5) <= todayMD)
    .reduce((a, f) => a + hrs(f.block_seconds ?? f.pic_seconds + f.sic_seconds), 0);
  const cmp = year === thisYear && years.includes(thisYear - 1) ? ytd(thisYear) - ytd(thisYear - 1) : null;

  const select = (label: unknown) => {
    const r = data.find((d) => d.label === String(label));
    if (r && onSelectPeriod) onSelectPeriod(r.period === selected ? null : r.period);
  };
  const dim = (period: string) => selected != null && selected !== period && (selected.startsWith(period) ? false : true);

  const chips: (number | "all")[] = [...years, "all"];
  const seg = (on: boolean) => `shrink-0 px-3 py-1 rounded text-xs font-medium transition-colors ${on ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"}`;
  return (
    <section className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-[#52525B] uppercase tracking-widest">Hours</p>
        <div className="flex gap-0.5 bg-[#18181B] rounded-lg p-0.5">
          {MODES.map((m) => <button key={m.id} onClick={() => setMode(m.id)} className={seg(mode === m.id)}>{m.label}</button>)}
        </div>
      </div>
      <Panel className="p-4">
        <div className="flex gap-1 bg-[#18181B] rounded-lg p-1 mb-4 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {chips.map((c) => (
            <button key={c} onClick={() => setYear(c)} className={seg(year === c)}>
              {c === "all" ? "All years" : c === thisYear ? "This year" : c}
            </button>
          ))}
        </div>
        <div className="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
          <span className="text-xl font-semibold tabular-nums">
            {hhmm(block)}
            <span className="text-sm text-[#A1A1AA] font-normal"> block · {real.length} sectors{sim > 0 ? ` · ${hhmm(sim)} sim` : ""}</span>
          </span>
          {cmp != null && (
            <span className={`text-xs tabular-nums ${cmp >= 0 ? "text-[#A1A1AA]" : "text-[#71717A]"}`}>
              {cmp >= 0 ? "↑" : "↓"} {hhmm(Math.abs(cmp))} vs this date last year
            </span>
          )}
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}
                    onClick={(st) => select(st?.activeLabel)} style={{ cursor: onSelectPeriod ? "pointer" : undefined }}>
            <CartesianGrid stroke="var(--viz-grid)" vertical={false} strokeDasharray="2 4" />
            <XAxis dataKey="label" interval="preserveStartEnd" minTickGap={8} {...AXIS} />
            <YAxis allowDecimals={false} {...AXIS} />
            <Tooltip {...TIP} cursor={{ fill: "var(--viz-grid)", opacity: 0.4 }}
                     formatter={(v, n) => [hhmm(Number(v)), name(String(n))]} />
            {keys.map((k, i) => (
              <Bar key={k} dataKey={k} stackId="h" fill={color(k, i)} maxBarSize={30} isAnimationActive={false}
                   stroke="var(--viz-gap)" strokeWidth={1} radius={i === keys.length - 1 ? [4, 4, 0, 0] : undefined}>
                {data.map((d) => <Cell key={d.period} fillOpacity={dim(d.period) ? 0.3 : 1} />)}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[#71717A] mt-2">
          {keys.map((k, i) => (
            <span key={k} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ background: color(k, i) }} />
              {name(k)} <span className="tabular-nums text-[#A1A1AA]">{hhmm(totals[k])}</span>
            </span>
          ))}
          <span className="ml-auto tabular-nums">night {hhmm(inScope.reduce((a, f) => a + hrs(f.night_seconds), 0))}</span>
        </div>
        {onSelectPeriod && (
          <p className="text-[10px] text-[#52525B] mt-2">Tap a bar to list its flights below.</p>
        )}
      </Panel>
    </section>
  );
}
