"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO, startOfWeek, addDays, eachWeekOfInterval, subWeeks, getDay } from "date-fns";
import { SPORT_COLORS, sportOf } from "@/lib/sport";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

type Bubble = { id: string; sport: string; start_time: string; distance_m: number; duration_s: number; tss: number };
type DayEntry = { date: string; activities: Bubble[] };
type Range = { kind: "recent"; weeks: number } | { kind: "year"; year: number };

const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];
const SPORTS = ["ride", "run", "swim", "other"] as const;
const SPORT_LABEL: Record<string, string> = { ride: "Ride", run: "Run", swim: "Swim", other: "Gym & other" };
// intensity ramp for the heatmap (themed in globals.css; dim→bright on dark, light→dark on paper)
const HEAT = ["var(--viz-grid)", "var(--viz-i2)", "var(--viz-i3)", "var(--viz-i4)", "var(--viz-i5)"];

const iso = (d: Date) => format(d, "yyyy-MM-dd");
const bubble = (tss: number) => Math.min(22, 7 + (tss / 150) * 15);
const fmtH = (h: number) => (h >= 1 ? `${h.toFixed(1)}h` : `${Math.round(h * 60)}m`);

function heatLevel(min: number): number {
  if (min <= 0) return 0;
  if (min < 45) return 1;
  if (min < 90) return 2;
  if (min < 180) return 3;
  return 4;
}

export default function TrainingLogCalendar() {
  const thisYear = new Date().getFullYear();
  const [range, setRange] = useState<Range>({ kind: "recent", weeks: 16 });
  const [hover, setHover] = useState<{ a: Bubble; x: number; y: number } | null>(null);
  useEffect(() => {                       // deep link: /omyra?tab=log&year=2025
    const y = Number(new URLSearchParams(window.location.search).get("year"));
    if (y > 2000 && y <= thisYear) setRange({ kind: "year", year: y });
  }, [thisYear]);
  const { data: yearsRaw } = useQuery<number[]>({
    queryKey: ["training-years"],
    queryFn: () => fetch(`${API}/training/years`).then((r) => (r.ok ? r.json() : [])),
  });
  const years = (Array.isArray(yearsRaw) ? yearsRaw : []).filter((y) => y < thisYear).slice(0, 6);

  const today = new Date();
  const start = range.kind === "year" ? `${range.year}-01-01` : iso(subWeeks(today, range.weeks));
  const end = range.kind === "year" && range.year < thisYear ? `${range.year}-12-31` : iso(today);

  const { data, isLoading, error } = useQuery<DayEntry[]>({
    queryKey: ["training-log", start, end],
    queryFn: () => fetch(`/api/training/log?start=${start}&end=${end}`).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    }),
  });

  const { dayMap, weekTotals, monthTotals, yearTotal } = useMemo(() => {
    const dayMap = new Map<string, Bubble[]>();
    const weekTotals = new Map<string, { km: number; h: number; tss: number }>();
    const monthTotals = new Map<string, { h: number; km: number; n: number; bySport: Record<string, number> }>();
    let yearTotal = { h: 0, km: 0, n: 0 };
    for (const day of Array.isArray(data) ? data : []) {
      dayMap.set(day.date, day.activities);
      const wk = iso(startOfWeek(parseISO(day.date), { weekStartsOn: 1 }));
      const w = weekTotals.get(wk) ?? { km: 0, h: 0, tss: 0 };
      const mk = day.date.slice(0, 7);
      const m = monthTotals.get(mk) ?? { h: 0, km: 0, n: 0, bySport: {} };
      for (const a of day.activities) {
        const h = (a.duration_s ?? 0) / 3600, km = (a.distance_m ?? 0) / 1000;
        w.km += km; w.h += h; w.tss += a.tss ?? 0;
        m.h += h; m.km += km; m.n += 1;
        const s = sportOf(a.sport);
        m.bySport[s] = (m.bySport[s] ?? 0) + h;
        yearTotal = { h: yearTotal.h + h, km: yearTotal.km + km, n: yearTotal.n + 1 };
      }
      weekTotals.set(wk, w);
      monthTotals.set(mk, m);
    }
    return { dayMap, weekTotals, monthTotals, yearTotal };
  }, [data]);

  const gridStart = startOfWeek(parseISO(start), { weekStartsOn: 1 });
  const gridEnd = parseISO(end);
  const weeks = eachWeekOfInterval({ start: gridStart, end: gridEnd }, { weekStartsOn: 1 });
  const rows = [...weeks].reverse();
  const monthKeys = range.kind === "year"
    ? Array.from({ length: 12 }, (_, i) => `${range.year}-${String(i + 1).padStart(2, "0")}`)
    : [];
  const maxMonthH = Math.max(1, ...monthKeys.map((k) => monthTotals.get(k)?.h ?? 0));

  const chips: { key: string; label: string; r: Range }[] = [
    { key: "r16", label: "16 weeks", r: { kind: "recent", weeks: 16 } },
    { key: `y${thisYear}`, label: "This year", r: { kind: "year", year: thisYear } },
    ...years.map((y) => ({ key: `y${y}`, label: String(y), r: { kind: "year", year: y } as Range })),
  ];
  const isActive = (r: Range) => r.kind === range.kind && (r.kind === "year" ? r.year === (range as { year: number }).year : true);

  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-[#18181B] rounded-lg p-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {chips.map((c) => (
          <button key={c.key} onClick={() => setRange(c.r)}
                  className={`shrink-0 px-3 py-1 rounded text-xs font-medium whitespace-nowrap transition-colors ${
                    isActive(c.r) ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"}`}>
            {c.label}
          </button>
        ))}
      </div>

      {error && <p className="text-xs text-rose-400">Could not load the log.</p>}
      {isLoading && <div className="h-48 rounded-xl bg-[#18181B] animate-pulse" />}

      {!isLoading && range.kind === "year" && (
        <>
          <div className="flex items-baseline justify-between">
            <p className="text-sm"><span className="text-xl font-semibold tabular-nums">{Math.round(yearTotal.h)}h</span>
              <span className="text-[#71717A]"> · {Math.round(yearTotal.km).toLocaleString()} km · {yearTotal.n} sessions</span></p>
            <span className="text-xs text-[#71717A]">{range.year === thisYear ? "so far" : range.year}</span>
          </div>

          {/* Year heatmap: one square per day, columns = weeks */}
          <div>
            <div className="grid grid-flow-col gap-[2px] w-full" style={{ gridTemplateRows: "repeat(7, auto)", gridAutoColumns: "minmax(0, 1fr)" }}>
              {weeks.flatMap((ws) => Array.from({ length: 7 }, (_, i) => {
                const d = addDays(ws, i);
                const k = iso(d);
                const acts = dayMap.get(k) ?? [];
                const min = acts.reduce((a, x) => a + (x.duration_s ?? 0) / 60, 0);
                const out = d.getFullYear() !== range.year || d > today;
                return (
                  <Link key={k} href={`/day/${k}`} title={`${format(d, "EEE d MMM")}${min ? ` · ${Math.round(min)} min` : ""}`}
                        className="w-full aspect-square rounded-[2px]"
                        style={{ background: out ? "transparent" : HEAT[heatLevel(min)], gridRow: ((getDay(d) + 6) % 7) + 1 }} />
                );
              }))}
            </div>
          </div>
          <div className="flex items-center gap-1 text-[10px] text-[#71717A]">
            less {HEAT.map((c, i) => <span key={i} className="w-[9px] h-[9px] rounded-[2px] inline-block" style={{ background: c }} />)} more
            <span className="ml-2">(&lt;45m · 45–90m · 1.5–3h · 3h+)</span>
          </div>

          {/* Monthly hours, stacked by sport */}
          <div>
            <p className="text-[10px] text-[#52525B] uppercase tracking-widest mb-2">By month</p>
            <div className="flex items-end gap-1 h-28">
              {monthKeys.map((k) => {
                const m = monthTotals.get(k);
                return (
                  <div key={k} className="flex-1 flex flex-col items-center justify-end h-full"
                       title={m ? `${format(parseISO(k + "-01"), "MMMM")}: ${m.h.toFixed(1)} h · ${Math.round(m.km)} km · ${m.n} sessions` : undefined}>
                    {m && m.h > 0 && <span className="text-[9px] text-[#71717A] tabular-nums mb-0.5">{Math.round(m.h)}</span>}
                    <div className="w-full flex flex-col-reverse rounded-t overflow-hidden gap-px" style={{ height: `${((m?.h ?? 0) / maxMonthH) * 80}%` }}>
                      {SPORTS.map((s) => (m?.bySport[s] ? (
                        <div key={s} style={{ flexGrow: m.bySport[s], background: SPORT_COLORS[s] }} />
                      ) : null))}
                    </div>
                    <span className="text-[10px] text-[#52525B] mt-1">{format(parseISO(k + "-01"), "MMMMM")}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {!isLoading && (
        <>
          <div className="flex gap-3 flex-wrap text-[11px] text-[#71717A]">
            {SPORTS.map((s) => (
              <span key={s} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: SPORT_COLORS[s] }} />{SPORT_LABEL[s]}
              </span>
            ))}
            <span className="text-[#52525B]">· bubble size = load</span>
          </div>

          {/* Week rows (newest first) — fits a phone: no sideways scroll */}
          <div>
            <div className="grid text-[10px] text-[#52525B] mb-1" style={{ gridTemplateColumns: "42px repeat(7, 1fr) 58px" }}>
              <div />
              {DAY_LABELS.map((d, i) => <div key={i} className="text-center">{d}</div>)}
              <div className="text-right">week</div>
            </div>
            <div className="divide-y divide-[#18181B]">
              {rows.map((ws) => {
                const wk = iso(ws);
                const t = weekTotals.get(wk);
                return (
                  <div key={wk} className="grid items-center" style={{ gridTemplateColumns: "42px repeat(7, 1fr) 58px", minHeight: 38 }}>
                    <div className="text-[10px] text-[#52525B] tabular-nums">{format(ws, "d MMM")}</div>
                    {Array.from({ length: 7 }, (_, i) => {
                      const d = addDays(ws, i);
                      const k = iso(d);
                      const acts = dayMap.get(k) ?? [];
                      const future = d > today || (range.kind === "year" && d.getFullYear() !== range.year);
                      return (
                        <div key={k} className="flex flex-wrap items-center justify-center gap-0.5 py-1">
                          {future || acts.length === 0 ? (
                            <span className={`w-1 h-1 rounded-full ${future ? "bg-transparent" : "bg-[#27272A]"}`} />
                          ) : acts.map((a) => (
                            <a key={a.id} href={`/activity/${encodeURIComponent(a.id)}`}
                               onMouseEnter={(e) => setHover({ a, x: e.clientX, y: e.clientY })}
                               onMouseLeave={() => setHover(null)}
                               className="rounded-full shrink-0 hover:opacity-80"
                               style={{ width: bubble(a.tss), height: bubble(a.tss), background: SPORT_COLORS[sportOf(a.sport)] }} />
                          ))}
                        </div>
                      );
                    })}
                    <div className="text-right text-[10px] text-[#71717A] leading-tight tabular-nums">
                      {t ? <><div className="text-[#A1A1AA]">{fmtH(t.h)}</div><div>{Math.round(t.km)} km</div></> : <span className="text-[#3F3F46]">—</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {hover && (
        <div className="fixed z-50 pointer-events-none bg-[#09090B] border border-[#27272A] rounded-lg px-3 py-2 text-xs shadow-xl"
             style={{ left: hover.x + 12, top: hover.y - 60 }}>
          <div className="text-[#FAFAFA] capitalize">{hover.a.sport.replace(/_/g, " ")}</div>
          <div className="text-[#A1A1AA] tabular-nums">
            {hover.a.distance_m > 0 ? `${(hover.a.distance_m / 1000).toFixed(1)} km · ` : ""}{Math.round(hover.a.duration_s / 60)} min
            {hover.a.tss > 0 ? ` · ${Math.round(hover.a.tss)} TSS` : ""}
          </div>
        </div>
      )}
    </div>
  );
}
