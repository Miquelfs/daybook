"use client";

import Link from "next/link";
import type { ActivityEffort, ActivityImpact } from "@/lib/api";

function clock(s: number): string {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.round(s % 60);
  const ss = String(sec).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
const pace = (secs: number, meters: number) => clock(secs / (meters / 1000));
const kmh = (secs: number, meters: number) => (meters / 1000 / (secs / 3600)).toFixed(1);
const MEDAL = ["", "🥇", "🥈", "🥉"];
const ORD = ["", "", "2nd", "3rd"];

function Trophy({ e }: { e: ActivityEffort }) {
  if (e.n < 2) return null;
  if (e.rank_all <= 3)
    return <span className="text-xs whitespace-nowrap">{MEDAL[e.rank_all]} <span className="text-[#A1A1AA]">{e.rank_all === 1 ? "PR" : `${ORD[e.rank_all]} best`}</span></span>;
  if (e.rank_year <= 3)
    return <span className="text-xs text-[#A1A1AA] whitespace-nowrap">{e.rank_year === 1 ? "best" : ORD[e.rank_year]} of {e.year}</span>;
  return null;
}

/** Strava-style best efforts inside this activity, with trophies vs your history. */
export function BestEffortsCard({ efforts, sport }: { efforts: ActivityEffort[]; sport: string }) {
  const dist = efforts.filter((e) => e.kind === "dist");
  const power = efforts.filter((e) => e.kind === "power");
  const prs = efforts.filter((e) => e.rank_all === 1 && e.n > 1).length;
  const podium = efforts.filter((e) => e.rank_all > 1 && e.rank_all <= 3).length;
  const run = sport === "run";

  const Row = ({ e }: { e: ActivityEffort }) => {
    const isP = e.kind === "power";
    const gap = e.pr && e.pr.value && e.rank_all > 1
      ? isP ? (1 - e.value / e.pr.value) * 100 : (e.value / e.pr.value - 1) * 100 : 0;
    return (
      <div className="flex items-center gap-3 px-4 py-2.5">
        <span className="text-sm text-[#A1A1AA] w-24 shrink-0">{e.label}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold tabular-nums">
            {isP ? `${Math.round(e.value)} W` : clock(e.value)}
            {!isP && <span className="text-xs text-[#71717A] font-normal"> · {run ? `${pace(e.value, e.key)} /km` : `${kmh(e.value, e.key)} km/h`}</span>}
          </p>
          {e.pr && e.rank_all > 1 && (
            <Link href={`/activity/${encodeURIComponent(e.pr.activity_id)}`} className="text-[11px] text-[#71717A] hover:text-[#F59E0B] tabular-nums">
              PR {isP ? `${Math.round(e.pr.value)} W` : clock(e.pr.value)} · {gap.toFixed(1)}% {isP ? "below" : "slower"} · {e.pr.date}
            </Link>
          )}
        </div>
        <Trophy e={e} />
      </div>
    );
  };

  return (
    <section className="mb-8">
      <p className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Best efforts</p>
      <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl overflow-hidden">
        {(prs > 0 || podium > 0) && (
          <p className="px-4 pt-3 text-sm text-[#A1A1AA]">
            {prs > 0 && <>🥇 {prs} personal record{prs > 1 ? "s" : ""}</>}
            {prs > 0 && podium > 0 && " · "}
            {podium > 0 && <>{podium} top-3 effort{podium > 1 ? "s" : ""}</>}
          </p>
        )}
        <div className="divide-y divide-[#18181B]">
          {dist.map((e) => <Row key={`d${e.key}`} e={e} />)}
        </div>
        {power.length > 0 && (
          <>
            <p className="px-4 pt-3 pb-1 text-[10px] text-[#52525B] uppercase tracking-widest border-t border-[#27272A]">Power</p>
            <div className="divide-y divide-[#18181B]">{power.map((e) => <Row key={`p${e.key}`} e={e} />)}</div>
          </>
        )}
      </div>
    </section>
  );
}

/** Same route: every time you've done (roughly) this route, this one highlighted. */
export function SameRouteCard({ m, sport }: { m: NonNullable<ActivityImpact["matched"]>; sport: string }) {
  const run = sport === "run";
  const fmt = (mps: number) => (run ? `${clock(1000 / mps)} /km` : `${(mps * 3.6).toFixed(1)} km/h`);
  const vals = m.items.map((i) => i.mps);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  return (
    <section className="mb-8">
      <p className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Same route</p>
      <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4">
        <div className="flex items-baseline justify-between gap-3 mb-1">
          <span className="text-xl font-semibold">
            {m.rank === 1 ? "Fastest" : `#${m.rank}`}<span className="text-sm text-[#A1A1AA] font-normal"> of {m.n} times on this route</span>
          </span>
        </div>
        {m.vs_last_pct != null && (
          <p className="text-sm text-[#A1A1AA] mb-4">
            {Math.abs(m.vs_last_pct) < 1 ? "Same pace as last time" : m.vs_last_pct > 0
              ? `${m.vs_last_pct}% faster than last time` : `${Math.abs(m.vs_last_pct)}% slower than last time`}
            {m.rank !== 1 && <> · best {fmt(m.best.mps)} on {m.best.date}</>}
          </p>
        )}
        <div className="flex items-end gap-1.5 h-20">
          {m.items.map((i) => (
            <Link key={i.id} href={`/activity/${encodeURIComponent(i.id)}`} className="flex-1 flex flex-col justify-end h-full group"
                  title={`${i.date}: ${clock(i.secs)} · ${fmt(i.mps)}${i.hr ? ` · ${Math.round(i.hr)} bpm` : ""}`}>
              <div className="rounded-t transition-opacity group-hover:opacity-80"
                   style={{ height: `${30 + ((i.mps - lo) / Math.max(1e-6, hi - lo)) * 70}%`,
                            background: i.this ? "var(--viz-spd)" : "var(--viz-i1)" }} />
            </Link>
          ))}
        </div>
        <div className="flex justify-between text-[10px] text-[#52525B] mt-1">
          <span>{m.items[0]?.date}</span><span>taller = faster</span><span>{m.items[m.items.length - 1]?.date}</span>
        </div>
      </div>
    </section>
  );
}
