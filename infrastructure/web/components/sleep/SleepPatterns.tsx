"use client";

import { format, parseISO, getDay } from "date-fns";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fmtDuration(s: number | null): string {
  if (!s) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}

interface Correlation {
  metric_a: string;
  metric_b: string;
  lag: number;
  r: number | null;
  n: number;
}

interface Props {
  summary: Record<string, number | null> | null;
  correlations: { correlations: Correlation[] } | null;
  stages: Record<string, number | null>[];
}

function CorrelationBadge({ r, label }: { r: number | null; label: string }) {
  if (r === null) return null;
  const abs = Math.abs(r);
  const color = abs >= 0.5 ? "text-emerald-400" : abs >= 0.3 ? "text-amber-400" : "text-[#71717A]";
  const sign = r >= 0 ? "+" : "";
  return (
    <div className="flex items-center justify-between py-2 border-b border-[#27272A] last:border-0">
      <span className="text-xs text-[#A1A1AA]">{label}</span>
      <span className={`text-sm font-semibold tabular-nums ${color}`}>{sign}{r.toFixed(2)}</span>
    </div>
  );
}

export function SleepPatterns({ summary, correlations, stages }: Props) {
  const nightsBelowDeep = summary?.nights_below_deep_threshold ?? 0;
  const nightsBelowRem = summary?.nights_below_rem_threshold ?? 0;
  const totalNights = summary?.nights ?? 0;

  // Day-of-week averages
  const dowMap: Record<number, { dur: number[]; score: number[] }> = {};
  for (const r of stages) {
    if (!r.date || !r.duration_seconds) continue;
    const dow = getDay(parseISO(r.date as string));
    if (!dowMap[dow]) dowMap[dow] = { dur: [], score: [] };
    dowMap[dow].dur.push(r.duration_seconds as number);
    if (r.score) dowMap[dow].score.push(r.score as number);
  }

  const dowData = DAY_LABELS.map((label, i) => {
    const d = dowMap[i];
    if (!d || d.dur.length === 0) return { label, avgDur: null, avgScore: null };
    return {
      label,
      avgDur: Math.round(d.dur.reduce((a, b) => a + b, 0) / d.dur.length),
      avgScore: d.score.length ? Math.round(d.score.reduce((a, b) => a + b, 0) / d.score.length) : null,
    };
  });

  const maxDur = Math.max(...dowData.map((d) => d.avgDur ?? 0), 1);

  const corrs = correlations?.correlations ?? [];
  const find = (ma: string, mb: string, lag: number) =>
    corrs.find((c) => c.metric_a === ma && c.metric_b === mb && c.lag === lag)?.r ?? null;

  return (
    <section>
      <p className="text-xs text-[#F59E0B] uppercase tracking-[0.2em] mb-4">Patterns</p>

      {/* Stage adequacy */}
      <div className="grid grid-cols-2 gap-4 mb-8">
        <div className="bg-[#18181B] rounded-xl p-4 border border-[#27272A]">
          <p className="text-xs text-[#52525B] uppercase tracking-widest mb-2">Deep sleep adequacy</p>
          <p className={`text-2xl font-semibold ${nightsBelowDeep > totalNights * 0.4 ? "text-rose-400" : "text-emerald-400"}`}>
            {totalNights > 0 ? `${totalNights - nightsBelowDeep}/${totalNights}` : "—"}
          </p>
          <p className="text-xs text-[#71717A] mt-1">nights ≥ 18% deep</p>
        </div>
        <div className="bg-[#18181B] rounded-xl p-4 border border-[#27272A]">
          <p className="text-xs text-[#52525B] uppercase tracking-widest mb-2">REM adequacy</p>
          <p className={`text-2xl font-semibold ${nightsBelowRem > totalNights * 0.4 ? "text-rose-400" : "text-emerald-400"}`}>
            {totalNights > 0 ? `${totalNights - nightsBelowRem}/${totalNights}` : "—"}
          </p>
          <p className="text-xs text-[#71717A] mt-1">nights ≥ 20% REM</p>
        </div>
      </div>

      {/* Day-of-week heatmap */}
      <div className="mb-8">
        <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-4">Sleep by day of week</h2>
        <div className="flex gap-2">
          {dowData.map(({ label, avgDur, avgScore }) => {
            const pct = avgDur ? avgDur / maxDur : 0;
            return (
              <div key={label} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full rounded-sm bg-[#27272A] overflow-hidden" style={{ height: 60 }}>
                  <div
                    className="w-full bg-blue-500 rounded-sm transition-all"
                    style={{ height: `${pct * 100}%`, marginTop: `${(1 - pct) * 100}%` }}
                  />
                </div>
                <span className="text-[10px] text-[#52525B]">{label}</span>
                <span className="text-[10px] text-[#A1A1AA]">{fmtDuration(avgDur)}</span>
                {avgScore && <span className="text-[10px] text-[#52525B]">{avgScore}pts</span>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Correlations */}
      <div>
        <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Sleep correlations</h2>
        <div className="bg-[#18181B] rounded-xl border border-[#27272A] px-4 py-2">
          <CorrelationBadge r={find("sleep_duration_h", "energy", 0)} label="Sleep duration → same-day energy" />
          <CorrelationBadge r={find("sleep_duration_h", "energy", 1)} label="Sleep duration → next-day energy" />
          <CorrelationBadge r={find("sleep_duration_h", "mood", 0)} label="Sleep duration → same-day mood" />
          <CorrelationBadge r={find("sleep_duration_h", "mood", 1)} label="Sleep duration → next-day mood" />
          <CorrelationBadge r={find("deep_sleep_pct", "hrv", 0)} label="Deep sleep % → HRV" />
          <CorrelationBadge r={find("sleep_score", "energy", 1)} label="Sleep score → next-day energy" />
        </div>
        <p className="text-xs text-[#52525B] mt-2">r ≥ 0.5 strong · r ≥ 0.3 moderate · based on last 90 nights</p>
      </div>
    </section>
  );
}
