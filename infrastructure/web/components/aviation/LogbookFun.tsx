"use client";

import Link from "next/link";
import { format, parseISO, differenceInCalendarDays, addDays } from "date-fns";
import type { AirportVisit, FlightAnalytics, FlightSummary } from "@/lib/api";
import { FLAG } from "@/lib/flags";
import { aircraftFamily, timeSplit } from "@/lib/flight-time";

// The playful half of Analytics: what the logbook adds up to, the milestones on
// the way, the passport, and personal bests. Everything is derived client-side
// from the flights list + the analytics / airport rollups already fetched.

const EARTH_KM = 40_075, MOON_KM = 384_400, CAMP_NOU = 99_354, OLYMPIC_POOL_L = 2_500_000;

const hhmm = (h: number) => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
const n0 = (n: number) => Math.round(n).toLocaleString("en-GB");
const day = (d: string) => format(parseISO(d), "d MMM yyyy");
const code = (f: FlightSummary, side: "dep" | "arr") =>
  (side === "dep" ? f.dep_iata ?? f.dep_icao : f.arr_iata ?? f.arr_icao) ?? "—";
const route = (f: FlightSummary) => `${code(f, "dep")} → ${code(f, "arr")}`;
const blockH = (f: FlightSummary) => (f.block_seconds ?? f.pic_seconds + f.sic_seconds) / 3600;
const utcMinutes = (iso: string | null) => (iso && iso.length >= 16 ? +iso.slice(11, 13) * 60 + +iso.slice(14, 16) : null);
const clock = (m: number) => `${String(Math.floor((m % 1440) / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-[#0D0D0F] border border-[#27272A] rounded-2xl ${className}`}>{children}</div>;
}
function Title({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between mb-3">
      <p className="text-xs text-[#52525B] uppercase tracking-widest">{children}</p>
      {sub && <p className="text-[11px] text-[#71717A] tabular-nums">{sub}</p>}
    </div>
  );
}

// ── numbers with a sense of scale ────────────────────────────────────────────
function InNumbers({ real, analytics }: { real: FlightSummary[]; analytics: FlightAnalytics }) {
  const km = real.reduce((a, f) => a + (f.distance_nm ?? 0), 0) * 1.852;
  const aloftH = real.reduce((a, f) => a + (f.airborne_seconds ?? f.block_seconds ?? 0), 0) / 3600;
  const landings = real.reduce((a, f) => a + f.landings_day + f.landings_night, 0);
  const first = real[0]?.date;
  const daysSince = first ? differenceInCalendarDays(new Date(), parseISO(first)) : 0;
  const pax = analytics.pax_stats?.total_pax ?? 0;
  const fuelL = (analytics.fuel_stats?.total_burn_kg ?? 0) / 0.8;
  const delayH = (analytics.delay_stats?.total_delay_min ?? 0) / 60;

  const tiles: { icon: string; value: string; label: string; fun: string }[] = [];
  if (km > 0) tiles.push({ icon: "🌍", value: `${n0(km)} km`, label: "flown",
    fun: `${(km / EARTH_KM).toFixed(1)} laps of the Earth · ${km >= MOON_KM ? `${(km / MOON_KM).toFixed(1)}× the distance to the Moon` : `${Math.round((km / MOON_KM) * 100)}% of the way to the Moon`}` });
  if (aloftH > 0) tiles.push({ icon: "☁️", value: `${(aloftH / 24).toFixed(1)} days`, label: "off the ground",
    fun: `${hhmm(aloftH)} airborne — ${((aloftH / 24 / Math.max(daysSince, 1)) * 100).toFixed(1)}% of your life since the first flight` });
  if (pax > 0) tiles.push({ icon: "🧳", value: n0(pax), label: "passengers",
    fun: `${(pax / CAMP_NOU).toFixed(1)}× a sold-out Camp Nou` });
  if (fuelL > 0) tiles.push({ icon: "⛽", value: `${(fuelL / 1e6).toFixed(2)} M L`, label: "of Jet A-1",
    fun: `${(fuelL / OLYMPIC_POOL_L).toFixed(1)} Olympic pools` });
  if (landings > 0) tiles.push({ icon: "🛬", value: n0(landings), label: "landings",
    fun: daysSince > 0 ? `one every ${(daysSince / landings).toFixed(1)} days since ${format(parseISO(first!), "MMM yyyy")}` : "" });
  if (delayH > 0) tiles.push({ icon: "⏳", value: hhmm(delayH), label: "of delays",
    fun: `${(delayH / 2.2).toFixed(0)} feature films' worth of waiting` });

  return (
    <section>
      <Title>Your flying in numbers</Title>
      <div className="grid grid-cols-2 gap-3">
        {tiles.map((t) => (
          <Card key={t.label} className="p-4">
            <p className="text-2xl leading-none">{t.icon}</p>
            <p className="mt-2 text-lg font-semibold tabular-nums text-[#FAFAFA]">{t.value}
              <span className="text-xs font-normal text-[#71717A]"> {t.label}</span></p>
            {t.fun && <p className="text-[11px] text-[#A1A1AA] mt-1 leading-snug">{t.fun}</p>}
          </Card>
        ))}
      </div>
    </section>
  );
}

// ── milestones ───────────────────────────────────────────────────────────────
type Milestone = { icon: string; title: string; f: FlightSummary };

function milestones(all: FlightSummary[]): { list: Milestone[]; next: { label: string; left: number; pct: number } | null } {
  const list: Milestone[] = [];
  const firstWhere = (icon: string, title: string, pred: (f: FlightSummary) => boolean) => {
    const f = all.find(pred);
    if (f) list.push({ icon, title, f });
  };
  const real = all.filter((f) => !f.is_sim);
  firstWhere("🐣", "First flight", (f) => !f.is_sim);
  firstWhere("🎓", "First time in command", (f) => !f.is_sim && f.pic_seconds > 0);
  firstWhere("🎮", "First simulator session", (f) => f.is_sim);
  firstWhere("⚙️", "First twin", (f) => aircraftFamily(f) === "Seneca");
  firstWhere("🚀", "First jet", (f) => aircraftFamily(f).startsWith("737"));
  firstWhere("🌙", "First night landing", (f) => !f.is_sim && f.landings_night > 0);
  const seenOps = new Set<string>();
  for (const f of real) {
    if (f.operator && !seenOps.has(f.operator)) {
      seenOps.add(f.operator);
      list.push({ icon: "🏢", title: `First ${f.operator} flight`, f });
    }
  }

  const HOURS = [100, 250, 500, 1000, 1500, 2000, 3000, 4000, 5000, 7500, 10000];
  const SECTORS = [100, 250, 500, 1000, 2000, 5000];
  let cum = 0, h = 0, s = 0;
  real.forEach((f, i) => {
    cum += blockH(f);
    while (h < HOURS.length && cum >= HOURS[h]) list.push({ icon: "⏱️", title: `${n0(HOURS[h++])} hours`, f });
    while (s < SECTORS.length && i + 1 >= SECTORS[s]) list.push({ icon: "🔢", title: `${n0(SECTORS[s++])} sectors`, f });
  });
  list.sort((a, b) => a.f.date.localeCompare(b.f.date) || (a.f.off_block_utc ?? "").localeCompare(b.f.off_block_utc ?? ""));
  const target = HOURS[h];
  const prev = HOURS[h - 1] ?? 0;
  return {
    list,
    next: target ? { label: `${n0(target)} hours`, left: target - cum, pct: ((cum - prev) / (target - prev)) * 100 } : null,
  };
}

function Milestones({ all }: { all: FlightSummary[] }) {
  const { list, next } = milestones(all);
  if (!list.length) return null;
  return (
    <section>
      <Title sub={`${list.length} unlocked`}>Milestones</Title>
      <Card className="p-4">
        {next && (
          <div className="mb-4">
            <div className="flex items-baseline justify-between text-xs mb-1.5">
              <span className="text-[#A1A1AA]">Next up: <span className="text-[#FAFAFA] font-medium">{next.label}</span></span>
              <span className="text-[#71717A] tabular-nums">{hhmm(next.left)} to go</span>
            </div>
            <div className="h-2 rounded-full bg-[#18181B] overflow-hidden">
              <div className="h-full rounded-full bg-[#F59E0B]" style={{ width: `${Math.min(100, next.pct)}%` }} />
            </div>
          </div>
        )}
        <ol className="relative border-l border-[#27272A] ml-3 space-y-3">
          {[...list].reverse().map((m) => (
            <li key={`${m.title}-${m.f.id}`} className="ml-4">
              <span className="absolute -left-3 flex items-center justify-center w-6 h-6 rounded-full bg-[#18181B] border border-[#27272A] text-xs">{m.icon}</span>
              <Link href={`/aviation/${m.f.id}`} className="block group">
                <p className="text-sm text-[#E4E4E7] group-hover:text-[#F59E0B] transition-colors">{m.title}</p>
                <p className="text-[11px] text-[#71717A] tabular-nums">{day(m.f.date)} · {route(m.f)}{m.f.aircraft_reg ? ` · ${m.f.aircraft_reg}` : ""}</p>
              </Link>
            </li>
          ))}
        </ol>
      </Card>
    </section>
  );
}

// ── passport ─────────────────────────────────────────────────────────────────
function Passport({ airports, onCountry }: { airports: AirportVisit[]; onCountry: (c: string) => void }) {
  const byCountry = new Map<string, { first: string; visits: number; airports: number }>();
  for (const a of airports) {
    if (!a.country) continue;
    const c = byCountry.get(a.country) ?? { first: a.first_visit ?? "9999", visits: 0, airports: 0 };
    c.visits += a.visit_count;
    c.airports += 1;
    if (a.first_visit && a.first_visit < c.first) c.first = a.first_visit;
    byCountry.set(a.country, c);
  }
  const stamps = [...byCountry.entries()].sort((a, b) => a[1].first.localeCompare(b[1].first));
  if (!stamps.length) return null;
  const thisYear = String(new Date().getFullYear());
  const newAirports = airports.filter((a) => a.first_visit?.startsWith(thisYear));
  const newest = airports.reduce<AirportVisit | null>((m, a) => (a.first_visit && (!m || a.first_visit > (m.first_visit ?? "")) ? a : m), null);

  return (
    <section>
      <Title sub={`${stamps.length} countries · ${airports.length} airports`}>Passport</Title>
      <Card className="p-4">
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {stamps.map(([country, c], i) => (
            <button key={country} onClick={() => onCountry(country)}
              className="relative flex flex-col items-center gap-0.5 rounded-xl border border-dashed border-[#3F3F46] px-2 py-2.5 hover:border-[#F59E0B] transition-colors">
              <span className="absolute top-1 left-1.5 text-[9px] text-[#52525B] tabular-nums">#{i + 1}</span>
              <span className="text-2xl leading-none">{FLAG[country] ?? "🏳️"}</span>
              <span className="text-[11px] text-[#E4E4E7] truncate max-w-full">{country}</span>
              <span className="text-[9px] text-[#71717A] tabular-nums">{c.first.slice(0, 4)} · {c.visits}×</span>
            </button>
          ))}
        </div>
        <p className="text-[11px] text-[#71717A] mt-3">
          {newAirports.length > 0
            ? <>{newAirports.length} new airport{newAirports.length > 1 ? "s" : ""} in {thisYear}: {newAirports.map((a) => a.iata ?? a.icao).join(", ")}</>
            : <>No new airports yet in {thisYear}.</>}
          {newest && <> · newest stamp: <span className="text-[#A1A1AA]">{newest.city ?? newest.icao}</span> ({day(newest.first_visit!)})</>}
        </p>
      </Card>
    </section>
  );
}

// ── personal bests ───────────────────────────────────────────────────────────
type Best = { icon: string; title: string; value: string; sub: string; href?: string };

function bests(all: FlightSummary[]): Best[] {
  const real = all.filter((f) => !f.is_sim);
  const out: Best[] = [];
  const link = (f: FlightSummary) => `/aviation/${f.id}`;

  const longest = real.reduce<FlightSummary | null>((m, f) => (!m || blockH(f) > blockH(m) ? f : m), null);
  if (longest) out.push({ icon: "🏃", title: "Marathon", value: hhmm(blockH(longest)), sub: `${route(longest)} · ${day(longest.date)}`, href: link(longest) });

  const hops = real.filter((f) => f.dep_icao && f.arr_icao && f.dep_icao !== f.arr_icao && blockH(f) > 0);
  const hop = hops.reduce<FlightSummary | null>((m, f) => (!m || blockH(f) < blockH(m) ? f : m), null);
  if (hop) out.push({ icon: "🐇", title: "Quickest hop", value: hhmm(blockH(hop)), sub: `${route(hop)} · ${day(hop.date)}`, href: link(hop) });

  const early = real.map((f) => ({ f, m: utcMinutes(f.off_block_utc) })).filter((x) => x.m != null && x.m >= 180)
    .reduce<{ f: FlightSummary; m: number } | null>((a, x) => (!a || x.m! < a.m ? (x as { f: FlightSummary; m: number }) : a), null);
  if (early) out.push({ icon: "🌅", title: "Early bird", value: `${clock(early.m)} UTC`, sub: `off-block ${route(early.f)} · ${day(early.f.date)}`, href: link(early.f) });

  // latest on-block; times before 06:00 count as "after midnight"
  const late = real.map((f) => { const m = utcMinutes(f.on_block_utc); return { f, m: m == null ? null : m < 360 ? m + 1440 : m }; })
    .filter((x) => x.m != null)
    .reduce<{ f: FlightSummary; m: number } | null>((a, x) => (!a || x.m! > a.m ? (x as { f: FlightSummary; m: number }) : a), null);
  if (late) out.push({ icon: "🦉", title: "Night owl", value: `${clock(late.m)} UTC`, sub: `on-block ${route(late.f)} · ${day(late.f.date)}`, href: link(late.f) });

  const days = [...new Set(real.map((f) => f.date))].sort();
  let best = 0, run = 0, bestEnd = "";
  days.forEach((d, i) => {
    run = i > 0 && format(addDays(parseISO(days[i - 1]), 1), "yyyy-MM-dd") === d ? run + 1 : 1;
    if (run > best) { best = run; bestEnd = d; }
  });
  if (best > 1) out.push({ icon: "🔥", title: "Longest streak", value: `${best} days`, sub: `flying in a row, ending ${day(bestEnd)}`, href: `/day/${bestEnd}` });

  const perDay = new Map<string, FlightSummary[]>();
  real.forEach((f) => perDay.set(f.date, [...(perDay.get(f.date) ?? []), f]));
  const [busyDate, busy] = [...perDay.entries()].reduce((m, e) => (e[1].length > m[1].length ? e : m), ["", [] as FlightSummary[]]);
  if (busy.length > 1) out.push({ icon: "🤹", title: "Busiest day", value: `${busy.length} sectors`,
    sub: `${[code(busy[0], "dep"), ...busy.map((f) => code(f, "arr"))].join("–")} · ${day(busyDate)}`, href: `/day/${busyDate}` });

  const tally = (key: (f: FlightSummary) => string | null | undefined, src: FlightSummary[]) => {
    const m = new Map<string, number>();
    src.forEach((f) => { const k = key(f); if (k) m.set(k, (m.get(k) ?? 0) + 1); });
    return [...m.entries()].sort((a, b) => b[1] - a[1])[0];
  };
  const reg = tally((f) => f.aircraft_reg, real);
  if (reg) out.push({ icon: "💙", title: "Favourite plane", value: reg[0], sub: `${reg[1]} sectors together` });
  const capt = tally((f) => f.pic_name, real.filter((f) => f.crew_role !== "pic"));
  if (capt) out.push({ icon: "👨‍✈️", title: "Most flown captain", value: capt[0].split(",")[0], sub: `${capt[1]} sectors side by side` });

  // most-visited destination that isn't one of your bases (each year's most common departure)
  const bases = new Set<string>();
  const byYear = new Map<string, FlightSummary[]>();
  real.forEach((f) => byYear.set(f.date.slice(0, 4), [...(byYear.get(f.date.slice(0, 4)) ?? []), f]));
  byYear.forEach((fs) => { const b = tally((f) => f.dep_icao, fs); if (b) bases.add(b[0]); });
  const away = tally((f) => (f.arr_icao && !bases.has(f.arr_icao) ? (f.arr_iata ?? f.arr_icao) : null), real);
  if (away) out.push({ icon: "🏝️", title: "Home away from home", value: away[0], sub: `${away[1]} arrivals (bases excluded)` });

  const sims = all.filter((f) => f.is_sim);
  if (sims.length) {
    const simH = sims.reduce((a, f) => a + timeSplit(f).sim, 0) / 3600;
    out.push({ icon: "🎮", title: "Simulator", value: hhmm(simH), sub: `${sims.length} sessions — every failure on purpose` });
  }
  return out;
}

function PersonalBests({ all }: { all: FlightSummary[] }) {
  const list = bests(all);
  if (!list.length) return null;
  return (
    <section>
      <Title>Personal bests</Title>
      <div className="grid grid-cols-2 gap-3">
        {list.map((b) => {
          const body = (
            <>
              <p className="flex items-center gap-1.5 text-[11px] text-[#71717A] uppercase tracking-wider">
                <span className="text-base leading-none normal-case">{b.icon}</span>{b.title}
              </p>
              <p className="mt-1.5 text-base font-semibold text-[#FAFAFA] tabular-nums truncate">{b.value}</p>
              <p className="text-[11px] text-[#A1A1AA] mt-0.5 truncate">{b.sub}</p>
            </>
          );
          return b.href
            ? <Link key={b.title} href={b.href} className="bg-[#0D0D0F] border border-[#27272A] rounded-2xl p-3.5 hover:border-[#3F3F46] transition-colors">{body}</Link>
            : <Card key={b.title} className="p-3.5">{body}</Card>;
        })}
      </div>
    </section>
  );
}

export function LogbookFun({ flights, analytics, airports, onCountry }: {
  flights: FlightSummary[];             // chronological
  analytics: FlightAnalytics;
  airports: AirportVisit[];
  onCountry: (country: string) => void;
}) {
  const real = flights.filter((f) => !f.is_sim);
  return (
    <div className="space-y-6">
      <InNumbers real={real} analytics={analytics} />
      <PersonalBests all={flights} />
      <Passport airports={airports} onCountry={onCountry} />
      <Milestones all={flights} />
    </div>
  );
}
