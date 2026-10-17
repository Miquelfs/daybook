"use client";

import { useState } from "react";
import Link from "next/link";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { format, parseISO, differenceInCalendarDays } from "date-fns";
import { ShieldCheck, ShieldAlert, Moon, Plane } from "lucide-react";
import type { LogbookStats, CurrencyStatus, FlightTimeLimits, FlightSummary } from "@/lib/api";

// Logbook overview, in the same card language as the activity / health views:
// a hero with the career numbers, one "legal & current" card, and hours by year.

const PIC = "var(--viz-i4)", SIC = "var(--viz-spd)";
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
  const picPct = t.block_hours ? (t.pic_hours / t.block_hours) * 100 : 0;
  const sicPct = t.block_hours ? (t.sic_hours / t.block_hours) * 100 : 0;
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
        {picPct > 0 && <div style={{ width: `${picPct}%`, background: PIC }} />}
        {sicPct > 0 && <div style={{ width: `${sicPct}%`, background: SIC }} />}
      </div>
      <div className="flex justify-between text-xs text-[#71717A] mt-1.5 tabular-nums">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: PIC }} />PIC {hhmm(t.pic_hours)}</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: SIC }} />SIC {hhmm(t.sic_hours)}</span>
        <span className="flex items-center gap-1.5"><Moon size={11} />Night {hhmm(t.night_hours)} · {nightPct}%</span>
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
export function HoursCard({ flights }: { flights: FlightSummary[] }) {
  const real = flights.filter((f) => !f.is_sim);
  const thisYear = new Date().getFullYear();
  const years = Array.from(new Set(real.map((f) => Number(f.date.slice(0, 4))))).sort((a, b) => b - a);
  const [picked, setYear] = useState<number | "all" | null>(null);
  const year = picked ?? (years.includes(thisYear) ? thisYear : years[0] ?? "all");   // default once flights load

  const byYear = [...years].reverse().map((y) => {
    const fs = real.filter((f) => f.date.startsWith(String(y)));
    return { label: String(y), pic: fs.reduce((a, f) => a + hrs(f.pic_seconds), 0), sic: fs.reduce((a, f) => a + hrs(f.sic_seconds), 0),
             night: fs.reduce((a, f) => a + hrs(f.night_seconds), 0), n: fs.length };
  });
  const months = Array.from({ length: 12 }, (_, i) => {
    const key = `${year}-${String(i + 1).padStart(2, "0")}`;
    const fs = real.filter((f) => f.date.startsWith(key));
    return { label: format(new Date(2000, i, 1), "MMM"), pic: fs.reduce((a, f) => a + hrs(f.pic_seconds), 0),
             sic: fs.reduce((a, f) => a + hrs(f.sic_seconds), 0), night: fs.reduce((a, f) => a + hrs(f.night_seconds), 0), n: fs.length };
  });
  const data = year === "all" ? byYear : months;
  const total = data.reduce((a, d) => a + d.pic + d.sic, 0);
  const sectors = data.reduce((a, d) => a + d.n, 0);

  // same-date comparison with the previous year
  const todayMD = format(new Date(), "MM-dd");
  const ytd = (y: number) => real.filter((f) => f.date.startsWith(String(y)) && f.date.slice(5) <= todayMD)
    .reduce((a, f) => a + hrs(f.block_seconds ?? f.pic_seconds + f.sic_seconds), 0);
  const cmp = year === thisYear && years.includes(thisYear - 1) ? ytd(thisYear) - ytd(thisYear - 1) : null;

  const chips: (number | "all")[] = [...years.slice(0, 6), "all"];
  return (
    <section className="mb-6">
      <p className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Hours</p>
      <Panel className="p-4">
        <div className="flex gap-1 bg-[#18181B] rounded-lg p-1 mb-4 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {chips.map((c) => (
            <button key={c} onClick={() => setYear(c)}
                    className={`shrink-0 px-3 py-1 rounded text-xs font-medium transition-colors ${year === c ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"}`}>
              {c === "all" ? "All years" : c === thisYear ? "This year" : c}
            </button>
          ))}
        </div>
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <span className="text-xl font-semibold tabular-nums">{hhmm(total)}<span className="text-sm text-[#A1A1AA] font-normal"> block · {sectors} sectors</span></span>
          {cmp != null && (
            <span className={`text-xs tabular-nums ${cmp >= 0 ? "text-[#A1A1AA]" : "text-[#71717A]"}`}>
              {cmp >= 0 ? "↑" : "↓"} {hhmm(Math.abs(cmp))} vs this date last year
            </span>
          )}
        </div>
        <ResponsiveContainer width="100%" height={170}>
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
            <CartesianGrid stroke="var(--viz-grid)" vertical={false} strokeDasharray="2 4" />
            <XAxis dataKey="label" interval="preserveStartEnd" minTickGap={8} {...AXIS} />
            <YAxis allowDecimals={false} {...AXIS} />
            <Tooltip {...TIP} cursor={{ fill: "var(--viz-grid)", opacity: 0.4 }}
                     formatter={(v, n) => [hhmm(Number(v)), n === "pic" ? "PIC" : "SIC"]} />
            <Bar dataKey="pic" stackId="h" fill={PIC} maxBarSize={30} isAnimationActive={false} stroke="var(--viz-gap)" strokeWidth={1} />
            <Bar dataKey="sic" stackId="h" fill={SIC} maxBarSize={30} radius={[4, 4, 0, 0]} isAnimationActive={false} stroke="var(--viz-gap)" strokeWidth={1} />
          </BarChart>
        </ResponsiveContainer>
        <div className="flex gap-3 text-[11px] text-[#71717A] mt-2">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: PIC }} />PIC</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: SIC }} />SIC</span>
          <span className="ml-auto tabular-nums">night {hhmm(data.reduce((a, d) => a + d.night, 0))}</span>
        </div>
      </Panel>
    </section>
  );
}
