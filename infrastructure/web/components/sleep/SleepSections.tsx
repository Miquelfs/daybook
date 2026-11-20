"use client";

import Link from "next/link";
import { format, parseISO } from "date-fns";
import { Block, Empty, Hero, Panel, Stat, Stats } from "@/components/ui/kit";
import type { SleepPeriod } from "@/lib/api";
import { hm, STAGE, StagesChart, WindowChart } from "./SleepCharts";

const day = (d: string) => format(parseISO(d), "EEE d MMM");

function delta(now: number | null | undefined, before: number | null | undefined, unit: "min" | "pts" | "bpm" | "ms") {
  if (now == null || before == null) return null;
  const d = unit === "min" ? Math.round((now - before) / 60) : Math.round((now - before) * 10) / 10;
  if (Math.abs(d) < (unit === "min" ? 3 : 1)) return "same as before";
  return `${d > 0 ? "+" : "−"}${Math.abs(d)} ${unit} vs before`;
}

/** The average night up top, then when you sleep. */
export function SleepHero({ p }: { p: SleepPeriod }) {
  const s = p.summary, prev = p.previous;
  const vs = delta(s.asleep_s, prev.asleep_s, "min");
  const sub = [s.in_bed_s ? `${hm(s.in_bed_s)} in bed` : null, s.efficiency_pct ? `${s.efficiency_pct}% asleep` : null,
               s.score != null ? `score ${Math.round(s.score)}` : null, vs].filter(Boolean).join(" · ");
  const owed = s.debt_s ?? 0;
  return (
    <div className="space-y-2">
      <Hero eyebrow={`Average night · ${s.nights} night${s.nights === 1 ? "" : "s"}`} value={hm(s.asleep_s)} unit="asleep" sub={sub} />
      <Stats cols={4}>
        <Stat label="Bedtime" value={s.bed ?? "—"} sub={s.bed_sd_min != null ? `±${s.bed_sd_min} min` : undefined} />
        <Stat label="Wake-up" value={s.wake ?? "—"} sub={s.wake_sd_min != null ? `±${s.wake_sd_min} min` : undefined} />
        <Stat label={`Under 7h`} value={s.short_nights ?? 0} unit={`of ${s.nights}`} sub="short nights" />
        <Stat label="Sleep debt" value={owed ? hm(owed) : "none"} sub={`last ${s.debt_nights ?? 0} nights vs ${p.need_h}h`} />
      </Stats>
    </div>
  );
}

export function NightsBlock({ p }: { p: SleepPeriod }) {
  return (
    <>
      <Block title="Every night" note="Time in bed, split into stages. The dashed line is an 8-hour night.">
        <Panel className="p-4">
          <StagesChart nights={p.nights} start={p.start} end={p.end} needH={p.need_h} />
        </Panel>
      </Block>
      <Block title="When you sleep" note={`Bed to wake-up. Dashed: your average ${p.summary.bed ?? ""} → ${p.summary.wake ?? ""}.`}>
        <Panel className="p-4">
          <WindowChart nights={p.nights} start={p.start} end={p.end} bed={p.summary.bed} wake={p.summary.wake} />
        </Panel>
      </Block>
    </>
  );
}

/** The average night's make-up: one 100 % bar, then deep and REM as a share of sleep vs the usual range. */
export function StagesBlock({ p }: { p: SleepPeriod }) {
  const s = p.summary;
  if (s.deep_pct == null) return null;
  const asleepPct = 100 - (s.awake_pct ?? 0);
  const ofSleep = (x: number | null | undefined) => (x != null && asleepPct > 0 ? Math.round((x / asleepPct) * 100) : null);
  const deep = ofSleep(s.deep_pct), rem = ofSleep(s.rem_pct);
  const parts = (["deep", "rem", "light", "awake"] as const).map((k) => ({ k, v: s[`${k}_pct`] ?? 0 }));
  const verdict = (v: number | null, lo: number, hi: number) =>
    v == null ? null : v < lo ? <span className="text-rose-400">below the usual {lo}–{hi}%</span>
      : v > hi ? <span className="text-[#A1A1AA]">above the usual {lo}–{hi}%</span>
      : <span className="text-emerald-400">within the usual {lo}–{hi}%</span>;
  return (
    <Block title="Stages">
      <Panel className="p-4">
        <div className="flex h-3 rounded-full overflow-hidden mb-3">
          {parts.map(({ k, v }) => <div key={k} style={{ width: `${v}%`, background: STAGE[k].color }} title={`${STAGE[k].label} ${v}%`} />)}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
          {parts.map(({ k, v }) => (
            <div key={k} className="text-xs text-[#71717A] flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ background: STAGE[k].color }} />
              {STAGE[k].label} <span className="text-[#FAFAFA] tabular-nums">{Math.round(v)}%</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-[#71717A] leading-relaxed">
          Of the time asleep: deep <span className="text-[#FAFAFA] tabular-nums">{deep}%</span> — {verdict(deep, 13, 23)};
          REM <span className="text-[#FAFAFA] tabular-nums">{rem}%</span> — {verdict(rem, 20, 25)}.
        </p>
      </Panel>
    </Block>
  );
}

/** What the body did overnight — the numbers recovery is read from. */
export function VitalsBlock({ p }: { p: SleepPeriod }) {
  const s = p.summary, prev = p.previous;
  const tiles = [
    s.resting_hr != null && <Stat key="rhr" label="Resting HR" value={Math.round(s.resting_hr)} unit="bpm" sub={delta(s.resting_hr, prev.resting_hr, "bpm") ?? undefined} />,
    s.hrv != null && <Stat key="hrv" label="Overnight HRV" value={Math.round(s.hrv)} unit="ms" sub={delta(s.hrv, prev.hrv, "ms") ?? undefined} />,
    s.respiration != null && <Stat key="resp" label="Breathing" value={s.respiration.toFixed(1)} unit="br/min" />,
    s.stress != null && <Stat key="stress" label="Sleep stress" value={Math.round(s.stress)} sub="0–100, lower is calmer" />,
    s.awakenings != null && <Stat key="awake" label="Awakenings" value={s.awakenings.toFixed(1)} unit="a night" sub={s.restless != null ? `${Math.round(s.restless)} restless moments` : undefined} />,
    s.body_battery != null && <Stat key="bb" label="Body Battery" value={`+${Math.round(s.body_battery)}`} sub="charged a night" />,
    s.spo2 != null && <Stat key="spo2" label="SpO₂" value={s.spo2.toFixed(1)} unit="%" />,
  ].filter(Boolean);
  if (!tiles.length) return null;
  return (
    <Block title="Overnight">
      <Stats cols={3}>{tiles}</Stats>
    </Block>
  );
}

export function NapsBlock({ p }: { p: SleepPeriod }) {
  const n = p.summary.naps;
  return (
    <Block title="Naps">
      {!n || !n.count ? (
        <Empty>No naps in this period — add the Nap tag on a day (how long, and when you woke).</Empty>
      ) : (
        <div className="space-y-2">
          <Stats cols={3}>
            <Stat label="Naps" value={n.count} sub={`on ${n.days} of ${p.days} days`} />
            <Stat label="Typical nap" value={hm(n.avg_s)} />
            <Stat label="Napped in total" value={hm(n.seconds)} />
          </Stats>
          <Panel className="divide-y divide-[#18181B]">
            {p.naps.slice(0, 8).map((x, i) => (
              <Link key={`${x.date}-${i}`} href={`/day/${x.date}`}
                    className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-[#18181B] transition-colors">
                <span className="text-[#A1A1AA]">{day(x.date)}</span>
                <span className="text-xs text-[#71717A] tabular-nums">
                  {x.start && x.end ? `${x.start}–${x.end} · ` : x.end ? `woke ${x.end} · ` : ""}
                  <span className="text-[#FAFAFA]">{x.seconds ? hm(x.seconds) : "no duration"}</span>
                  {x.source === "garmin" && <span className="text-[#52525B]"> · watch</span>}
                </span>
              </Link>
            ))}
          </Panel>
        </div>
      )}
    </Block>
  );
}

/** Which nights go short: by weekday, and the night before a day off / a duty / an early report. */
export function PatternsBlock({ p }: { p: SleepPeriod }) {
  const max = Math.max(...p.by_weekday.map((d) => d.asleep_s ?? 0), 1);
  const s = p.summary;
  return (
    <Block title="Patterns" note="The weekday is the morning you woke up.">
      <div className="space-y-2">
        <Panel className="p-4">
          <div className="flex items-end gap-2 h-24">
            {p.by_weekday.map((d) => (
              <div key={d.label} className="flex-1 flex flex-col items-center justify-end h-full" title={d.bed ? `bed ~${d.bed}` : undefined}>
                <div className="w-full rounded-sm" style={{ height: `${((d.asleep_s ?? 0) / max) * 100}%`, background: "var(--viz-deep)", opacity: d.nights ? 1 : 0.2 }} />
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-1.5">
            {p.by_weekday.map((d) => (
              <div key={d.label} className="flex-1 text-center">
                <p className="text-[10px] text-[#52525B] uppercase">{d.label}</p>
                <p className="text-xs text-[#A1A1AA] tabular-nums">{d.asleep_s ? hm(d.asleep_s).replace(/m$/, "") : "—"}</p>
              </div>
            ))}
          </div>
        </Panel>

        {p.by_duty.length > 0 && (
          <Panel className="divide-y divide-[#18181B]">
            {p.by_duty.map((g) => (
              <div key={g.key} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm text-[#FAFAFA]">{g.label}</p>
                  <p className="text-xs text-[#71717A]">{g.nights} night{g.nights === 1 ? "" : "s"}{g.bed && g.wake ? ` · ${g.bed} → ${g.wake}` : ""}</p>
                </div>
                <p className="text-sm font-semibold tabular-nums shrink-0">
                  {hm(g.asleep_s)}{g.score != null && <span className="text-xs font-normal text-[#71717A] ml-1.5">score {g.score}</span>}
                </p>
              </div>
            ))}
          </Panel>
        )}

        {s.best && s.worst && s.best.date !== s.worst.date && (
          <Stats cols={2}>
            <Stat label="Best night" value={hm(s.best.asleep_s)} sub={`${day(s.best.date)}${s.best.score != null ? ` · score ${s.best.score}` : ""}`} href={`/day/${s.best.date}`} />
            <Stat label="Worst night" value={hm(s.worst.asleep_s)} sub={`${day(s.worst.date)}${s.worst.score != null ? ` · score ${s.worst.score}` : ""}`} href={`/day/${s.worst.date}`} />
          </Stats>
        )}
      </div>
    </Block>
  );
}

type Corr = { metric_a: string; metric_b: string; lag: number; r: number | null; n: number };

/** How sleep goes with how you feel — from the questionnaire. */
export function CorrelationsBlock({ corrs, days }: { corrs: Corr[]; days: number }) {
  const find = (a: string, b: string, lag: number) => corrs.find((c) => c.metric_a === a && c.metric_b === b && c.lag === lag);
  const rows = [
    ["sleep_duration_h", "energy", 0, "Longer sleep → energy that day"],
    ["sleep_duration_h", "energy", 1, "Longer sleep → energy next day"],
    ["sleep_duration_h", "mood", 0, "Longer sleep → mood that day"],
    ["sleep_duration_h", "mood", 1, "Longer sleep → mood next day"],
    ["deep_sleep_pct", "hrv", 0, "More deep sleep → HRV"],
    ["sleep_score", "energy", 1, "Sleep score → energy next day"],
  ] as const;
  const found = rows.map(([a, b, l, label]) => ({ label, c: find(a, b, l) })).filter((x) => x.c && x.c.r != null);
  if (!found.length) return null;
  const word = (r: number) => (Math.abs(r) >= 0.5 ? "strong" : Math.abs(r) >= 0.3 ? "moderate" : Math.abs(r) >= 0.15 ? "weak" : "none");
  return (
    <Block title="Sleep and how you feel" note={`Correlation over the last ${days} nights, from your daily questionnaire.`}>
      <Panel className="divide-y divide-[#18181B]">
        {found.map(({ label, c }) => (
          <div key={label} className="flex items-center justify-between px-4 py-2.5">
            <span className="text-sm text-[#A1A1AA]">{label}</span>
            <span className="text-xs text-[#71717A] tabular-nums">
              {word(c!.r!)} · <span className="text-[#FAFAFA]">{c!.r! >= 0 ? "+" : ""}{c!.r!.toFixed(2)}</span>
            </span>
          </div>
        ))}
      </Panel>
    </Block>
  );
}
