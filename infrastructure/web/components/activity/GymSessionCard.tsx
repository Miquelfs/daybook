"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { LinkedPlanSession } from "@/lib/api";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const RAMP = ["var(--viz-i1)", "var(--viz-i3)", "var(--viz-i4)", "var(--viz-i5)", "var(--viz-i7)"];
const RPE_LABEL: Record<number, string> = {
  1: "very easy", 2: "easy", 3: "easy", 4: "moderate", 5: "moderate", 6: "somewhat hard",
  7: "hard", 8: "very hard", 9: "very hard", 10: "max",
};

type Zones = Record<string, { max_hr: number | null; zones: { name: string; min_hr: number; max_hr: number }[] | null }>;

const mins = (s: number | null | undefined) => (s ? Math.round(s / 60) : 0);

/** Where avg and max HR landed on your own zones — works without second-by-second data. */
export function HrGauge({ avg, max }: { avg: number | null; max: number | null }) {
  const { data } = useQuery<Zones>({
    queryKey: ["athlete-zones"],
    queryFn: () => fetch(`${BASE}/training/zones`).then((r) => (r.ok ? r.json() : {})),
    staleTime: 86_400_000,
  });
  if (!avg) return null;
  const z = data?.ride?.zones ?? data?.run?.zones ?? null;
  const top = Math.max(data?.ride?.max_hr ?? data?.run?.max_hr ?? 190, max ?? 0, 150);
  const bands = z?.length ? z.map((b) => ({ name: b.name, lo: b.min_hr, hi: Math.min(b.max_hr, top) }))
    : [0.6, 0.7, 0.8, 0.9, 1].map((p, i) => ({ name: `Z${i + 1}`, lo: i ? top * [0.6, 0.7, 0.8, 0.9][i - 1] : 0, hi: top * p }));
  const lo = Math.min(90, avg - 15);
  const x = (v: number) => `${Math.max(0, Math.min(100, ((v - lo) / (top - lo)) * 100))}%`;
  const zoneOf = (v: number) => bands.find((b) => v >= b.lo && v < b.hi)?.name ?? (v >= top ? "Z5" : "Z1");

  return (
    <div>
      <div className="relative h-3 rounded-full overflow-hidden flex gap-[2px]">
        {bands.map((b, i) => {
          const w = Math.max(0, Math.min(b.hi, top) - Math.max(b.lo, lo));
          return w > 0 ? <div key={b.name} style={{ flexGrow: w, flexBasis: 0, background: RAMP[i] }} title={`${b.name} ${Math.round(b.lo)}–${Math.round(b.hi)}`} /> : null;
        })}
      </div>
      <div className="relative h-8">
        {[["avg", avg], ["max", max]].map(([l, v]) => v ? (
          <div key={l as string} className="absolute top-0 -translate-x-1/2 flex flex-col items-center" style={{ left: x(v as number) }}>
            <span className="w-0.5 h-2 bg-[#FAFAFA]" />
            <span className="text-[10px] text-[#A1A1AA] tabular-nums whitespace-nowrap">{l} {v} · {zoneOf(v as number)}</span>
          </div>
        ) : null)}
      </div>
    </div>
  );
}

export function GymSessionCard({ plan, activity }: {
  plan: (LinkedPlanSession & { rpe_actual?: number | null }) | null;
  activity: { duration_seconds: number | null; moving_time_seconds: number | null; avg_heart_rate: number | null; max_heart_rate: number | null; calories: number | null };
}) {
  const [rpe, setRpe] = useState<number | null>(plan?.rpe_actual ?? null);
  const [saving, setSaving] = useState(false);
  const done = mins(activity.duration_seconds || activity.moving_time_seconds);
  const planned = plan ? plan.effective_duration_min ?? plan.duration_min : null;
  const steps = (plan?.structure ?? []) as { label: string; duration_min?: number; cue?: string }[];

  async function rate(n: number) {
    if (!plan) return;
    setRpe(n);
    setSaving(true);
    try {
      await fetch(`/api/race-plans/sessions/${plan.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed", rpe_actual: n }),
      });
    } finally { setSaving(false); }
  }

  return (
    <section className="mb-8">
      <p className="text-xs text-[#52525B] uppercase tracking-widest mb-3">{plan ? "Workout" : "Session"}</p>
      <div className="bg-[#0D0D0F] border border-[#27272A] rounded-2xl p-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-xl font-semibold tabular-nums">{done} <span className="text-sm text-[#A1A1AA] font-normal">min</span></span>
          {planned != null && (
            <span className={`text-xs tabular-nums ${Math.abs(done - planned) <= 10 ? "text-emerald-400" : "text-[#A1A1AA]"}`}>
              {Math.abs(done - planned) <= 10 ? "✓ " : ""}planned {planned} min
            </span>
          )}
        </div>
        {plan && <p className="text-sm text-[#A1A1AA] mb-4">{plan.session_type.replace(/^Strength - /, "")} · week {plan.week_number} of the plan</p>}

        {steps.length > 0 && (
          <ol className="mb-5 space-y-0">
            {steps.map((s, i) => (
              <li key={i} className="flex gap-3 py-2 border-t border-[#18181B] first:border-t-0">
                <span className="w-5 h-5 rounded-full bg-[#18181B] text-[10px] text-[#A1A1AA] flex items-center justify-center shrink-0 mt-0.5 tabular-nums">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{s.label}</p>
                  {s.cue && <p className="text-xs text-[#71717A]">{s.cue}</p>}
                </div>
                {s.duration_min ? <span className="text-xs text-[#71717A] tabular-nums shrink-0">{s.duration_min}′</span> : null}
              </li>
            ))}
          </ol>
        )}

        {activity.avg_heart_rate ? (
          <div className="mb-4">
            <p className="text-[10px] text-[#52525B] uppercase tracking-widest mb-2">Heart rate</p>
            <HrGauge avg={activity.avg_heart_rate} max={activity.max_heart_rate} />
            <p className="text-xs text-[#71717A]">
              Strength work barely moves average HR — judge it by how it felt (RPE), not by load.
            </p>
          </div>
        ) : null}

        {plan && (
          <div>
            <p className="text-[10px] text-[#52525B] uppercase tracking-widest mb-2">
              How hard was it? {rpe ? <span className="normal-case tracking-normal text-[#A1A1AA]">· RPE {rpe}, {RPE_LABEL[rpe]}{saving ? " · saving…" : ""}</span> : null}
            </p>
            <div className="grid grid-cols-10 gap-1">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <button key={n} onClick={() => rate(n)}
                        className={`h-9 rounded-lg text-sm tabular-nums transition-colors ${rpe === n ? "bg-[#F59E0B] text-[#09090B] font-semibold" : "bg-[#18181B] text-[#A1A1AA] hover:text-[#FAFAFA]"}`}>
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}
        {plan && (
          <Link href="/omyra?tab=race" className="block text-xs text-[#71717A] hover:text-[#F59E0B] mt-4">Mallorca 312 plan →</Link>
        )}
      </div>
    </section>
  );
}
