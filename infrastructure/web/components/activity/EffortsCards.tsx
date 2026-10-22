"use client";

import Link from "next/link";
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
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
  const same = m.items.filter((i) => i.same_direction);
  const group = same.length >= 2 ? same : m.items;
  const v = m.verdict;
  const chart = group.map((i) => ({
    date: i.date.slice(2), speed: run ? +(1000 / i.mps / 60).toFixed(2) : +(i.mps * 3.6).toFixed(1),
    hr: i.hr ?? null, this: i.this,
  }));
  const tone = (pct?: number) => (pct == null ? "" : pct >= 3 ? "text-emerald-400" : pct <= -3 ? "text-amber-400" : "");
  return (
    <section className="mb-8">
      <p className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Same route</p>
      <div className="bg-[#0D0D0F] border border-[#27272A] rounded-2xl p-4">
        <div className="flex items-baseline justify-between gap-3 mb-1">
          <span className="text-xl font-semibold">
            {m.rank === 1 ? "Fastest" : `#${m.rank}`}
            <span className="text-sm text-[#A1A1AA] font-normal"> of {m.n} times on these roads, this direction</span>
          </span>
          {m.n_reverse > 0 && <span className="text-xs text-[#71717A] text-right">+{m.n_reverse} the other way round</span>}
        </div>
        {v ? (
          <div className="mb-4">
            <p className="text-sm text-[#A1A1AA]">vs {v.vs_date}: {v.text}.</p>
            {v.read && <p className={`text-sm mt-0.5 ${tone(v.efficiency_pct)}`}>{v.read[0].toUpperCase() + v.read.slice(1)}.</p>}
          </div>
        ) : (
          <p className="text-sm text-[#A1A1AA] mb-4">First time on this route — the next ride here gets compared with this one.</p>
        )}

        {chart.length >= 2 && (
          <div className="h-40 -mx-1 mb-2">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chart} margin={{ top: 6, right: 4, bottom: 0, left: -12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--viz-grid)" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: "var(--viz-axis)", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="s" reversed={run} domain={["dataMin - 1", "dataMax + 1"]} allowDecimals={false}
                       tick={{ fill: "var(--viz-axis)", fontSize: 10 }} axisLine={false} tickLine={false} width={40} />
                <YAxis yAxisId="h" orientation="right" domain={["dataMin - 10", "dataMax + 10"]} hide />
                <Tooltip contentStyle={{ background: "#09090B", border: "1px solid #27272A", borderRadius: 8, fontSize: 12 }}
                         labelStyle={{ color: "#A1A1AA" }} itemStyle={{ color: "#FAFAFA" }}
                         formatter={(val, name) => name === "hr" ? [`${val} bpm`, "Avg HR"]
                           : [run ? `${Math.floor(Number(val))}:${String(Math.round((Number(val) % 1) * 60)).padStart(2, "0")} /km` : `${val} km/h`, run ? "Pace" : "Speed"]} />
                <Line yAxisId="h" dataKey="hr" stroke="var(--viz-hr)" strokeWidth={1.5} strokeDasharray="4 3"
                      dot={false} connectNulls isAnimationActive={false} />
                <Line yAxisId="s" dataKey="speed" stroke="var(--viz-spd)" strokeWidth={2} isAnimationActive={false}
                      dot={(p: { cx?: number; cy?: number; payload?: { this: boolean }; index?: number }) => (
                        <circle key={p.index} cx={p.cx} cy={p.cy} r={p.payload?.this ? 5 : 3}
                                fill={p.payload?.this ? "var(--viz-spd)" : "var(--viz-gap)"} stroke="var(--viz-spd)" strokeWidth={2} />
                      )} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className="flex gap-4 text-[10px] text-[#71717A] mb-3">
          <span className="flex items-center gap-1"><span className="w-3 h-0.5" style={{ background: "var(--viz-spd)" }} />{run ? "pace" : "speed"}</span>
          <span className="flex items-center gap-1"><span className="w-3 border-t border-dashed" style={{ borderColor: "var(--viz-hr)" }} />avg HR</span>
        </div>

        <div className="-mx-4 border-t border-[#18181B] divide-y divide-[#18181B]">
          {[...m.items].reverse().map((i) => (
            <Link key={i.id} href={`/activity/${encodeURIComponent(i.id)}`}
                  className={`flex items-center gap-3 px-4 py-2 text-xs tabular-nums hover:bg-[#18181B] ${i.same_direction ? "" : "opacity-60"} ${i.this ? "bg-[#18181B]" : ""}`}>
              <span className="w-[72px] shrink-0 text-[#A1A1AA]">{i.this ? "this ride" : i.date}</span>
              <span className="w-[72px] shrink-0 font-semibold text-[#FAFAFA]">{fmt(i.mps)}</span>
              <span className="w-[56px] shrink-0 text-[#A1A1AA]">{i.hr ? `${i.hr} bpm` : "—"}</span>
              <span className="flex-1 min-w-0 truncate text-[#71717A]">
                {[
                  i.same_direction ? null : "↺ other way",
                  i.headwind_kmh != null ? (Math.abs(i.headwind_kmh) < 1 ? "calm" : i.headwind_kmh > 0 ? `${i.headwind_kmh} km/h headwind` : `${-i.headwind_kmh} km/h tailwind`) : null,
                  i.temp_c != null ? `${i.temp_c}°C` : null,
                  i.form != null ? `form ${i.form > 0 ? "+" : ""}${i.form}` : null,
                ].filter(Boolean).join(" · ")}
              </span>
            </Link>
          ))}
        </div>
        {m.best_efficiency && !m.best_efficiency.this && m.best_efficiency.hr && (
          <p className="text-[11px] text-[#71717A] mt-3">
            Most speed per heartbeat here: {m.best_efficiency.date} ({fmt(m.best_efficiency.mps)} at {m.best_efficiency.hr} bpm).
          </p>
        )}
      </div>
    </section>
  );
}
