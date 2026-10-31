"use client";

import { useQuery } from "@tanstack/react-query";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { format, parseISO } from "date-fns";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Component = { key: string; label: string; value: number; unit: string; years: number; gain: number; good: string; why: string };
type FitnessAge = {
  now: {
    date: string; age: number; fitness_age: number; precise: number; delta: number;
    vo2max: number; vo2_age: number; adjust_years: number; raw_adjust_years: number; achievable: number; components: Component[];
    biggest_gain: string | null; floor: number; vo2_goal: number;
    plan: { key: string; title: string; now: number; unit: string; target: string; how: string; years: number }[];
  } | null;
  history: { date: string; fitness_age: number; vo2max: number }[];
  garmin: { date: string; fitness_age: number } | null;
};

const fmtVal = (c: Component) => `${c.key === "steps" ? c.value.toLocaleString("en-GB") : c.value}${c.unit ? ` ${c.unit}` : ""}`;
const yrs = (y: number) => `${y > 0 ? "+" : y < 0 ? "−" : ""}${Math.abs(y).toFixed(1)} y`;

/** Daybook's fitness age: VO₂max sets the base, everyday health signals move it — every step shown. */
export function FitnessAgeCard() {
  const { data } = useQuery<FitnessAge>({
    queryKey: ["fitness-age"],
    queryFn: () => fetch(`${BASE}/health/fitness-age`).then((r) => r.json()),
    staleTime: 600_000,
  });
  const n = data?.now;
  if (!n) return null;

  const maxAbs = Math.max(3, ...n.components.map((c) => Math.abs(c.years)));
  const younger = n.delta < 0;

  return (
    <section className="mb-8">
      <p className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Fitness age</p>
      <div className="bg-[#0D0D0F] border border-[#27272A] rounded-2xl p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="flex items-baseline gap-2">
              <span className="text-4xl font-semibold tracking-tight tabular-nums">{n.fitness_age}</span>
              <span className={`text-sm ${younger ? "text-emerald-400" : n.delta > 0 ? "text-amber-400" : "text-[#A1A1AA]"}`}>
                {n.delta === 0 ? "same as your age" : `${Math.abs(n.delta)} years ${younger ? "younger" : "older"} than you are (${n.age})`}
              </span>
            </p>
            <p className="text-xs text-[#71717A] mt-1">
              Daybook&apos;s own · lowest realistic <b className="text-[#A1A1AA]">{n.floor}</b>
              {data?.garmin ? <> · Garmin says {data.garmin.fitness_age}</> : null}
            </p>
          </div>
        </div>

        {/* how it adds up: the VO2max base, then each factor's years */}
        <div className="mt-5 space-y-2">
          <div className="flex items-center gap-3 text-xs">
            <span className="w-24 shrink-0 text-[#A1A1AA]">VO₂max</span>
            <span className="flex-1 text-[#71717A] tabular-nums">{n.vo2max} — average for a {Math.round(n.vo2_age)}-year-old</span>
            <span className="w-14 text-right tabular-nums font-semibold">{n.vo2_age.toFixed(1)}</span>
          </div>
          {n.components.map((c) => {
            const w = (Math.abs(c.years) / maxAbs) * 50;
            return (
              <div key={c.key} className="flex items-center gap-3 text-xs" title={`${c.why} · best: ${c.good}`}>
                <span className="w-24 shrink-0 text-[#A1A1AA] truncate">{c.label}</span>
                <span className="w-24 shrink-0 text-[#71717A] tabular-nums truncate">{fmtVal(c)}</span>
                <div className="relative flex-1 h-2.5">
                  <div className="absolute inset-y-0 left-1/2 w-px bg-[#27272A]" />
                  {c.years !== 0 && (
                    <div className="absolute inset-y-0 rounded-full"
                         style={{ width: `${w}%`, [c.years < 0 ? "right" : "left"]: "50%",
                                  background: c.years < 0 ? "var(--viz-cad)" : "var(--viz-i4)" }} />
                  )}
                </div>
                <span className={`w-14 text-right tabular-nums ${c.years < 0 ? "text-emerald-400" : c.years > 0 ? "text-amber-400" : "text-[#71717A]"}`}>
                  {yrs(c.years)}
                </span>
              </div>
            );
          })}
          <div className="flex items-center gap-3 text-xs pt-1 border-t border-[#18181B]">
            <span className="w-24 shrink-0 text-[#A1A1AA]">Together</span>
            <span className="flex-1 text-[#71717A]">
              {Math.abs(n.raw_adjust_years - n.adjust_years) >= 0.3
                ? <>not {yrs(n.raw_adjust_years)}: these overlap — a strong heart shows in several of them — so they don&apos;t simply add up</>
                : <>the factors above combined</>}
            </span>
            <span className={`w-14 text-right tabular-nums font-semibold ${n.adjust_years < 0 ? "text-emerald-400" : n.adjust_years > 0 ? "text-amber-400" : ""}`}>
              {yrs(n.adjust_years)}
            </span>
          </div>
          <div className="flex items-center gap-3 text-[10px] text-[#71717A]">
            <span className="w-24 shrink-0" /><span className="w-24 shrink-0" />
            <div className="flex-1 flex justify-between"><span>← younger</span><span>older →</span></div>
            <span className="w-14 shrink-0" />
          </div>
        </div>

        {n.plan.length > 0 && (
          <div className="mt-4 pt-4 border-t border-[#27272A]">
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <p className="text-[10px] text-[#52525B] uppercase tracking-widest">How to bring it down</p>
              <p className="text-xs text-[#71717A]">all of it: <b className="text-[#FAFAFA]">{n.floor}</b></p>
            </div>
            <div className="space-y-2.5">
              {n.plan.map((p) => (
                <div key={p.key} className="flex items-start gap-3">
                  <span className="w-12 shrink-0 text-right tabular-nums text-sm font-semibold text-emerald-400">−{p.years.toFixed(1)}</span>
                  <div className="min-w-0">
                    <p className="text-sm">
                      {p.title} <span className="text-[#71717A] tabular-nums">
                        · {p.key === "steps" ? p.now.toLocaleString("en-GB") : p.now}{p.unit ? ` ${p.unit}` : ""} → {p.target}
                      </span>
                    </p>
                    <p className="text-xs text-[#71717A]">{p.how}</p>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-[#71717A] mt-3">
              Years each change is worth on its own — they overlap, so together they reach {n.floor}, not the sum.
              {n.floor <= 20 ? " 20 is the bottom of the scale (the norms start at 20–29)." : ""}
            </p>
          </div>
        )}

        {data && data.history.length >= 3 && (
          <div className="mt-4 -mx-1">
            <ResponsiveContainer width="100%" height={80}>
              <LineChart data={data.history} margin={{ top: 4, right: 6, bottom: 0, left: -18 }}>
                <XAxis dataKey="date" tick={{ fill: "var(--viz-axis)", fontSize: 10 }} axisLine={false} tickLine={false}
                       tickFormatter={(d) => format(parseISO(String(d)), "MMM")} interval="preserveStartEnd" />
                <YAxis domain={["dataMin - 1", "dataMax + 1"]} tick={{ fill: "var(--viz-axis)", fontSize: 10 }}
                       axisLine={false} tickLine={false} width={40} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "#09090B", border: "1px solid #27272A", borderRadius: 8, fontSize: 12 }}
                         labelStyle={{ color: "#A1A1AA" }} itemStyle={{ color: "#FAFAFA" }}
                         labelFormatter={(d) => format(parseISO(String(d)), "MMM yyyy")}
                         formatter={(v, name) => [name === "vo2max" ? `${v}` : `${Number(v).toFixed(1)} y`, name === "vo2max" ? "VO₂max" : "Fitness age"]} />
                <Line dataKey="fitness_age" stroke="var(--viz-i4)" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
            <p className="text-[10px] text-[#71717A] px-1">Fitness age at the end of each month</p>
          </div>
        )}

        <details className="mt-3">
          <summary className="text-xs text-[#71717A] cursor-pointer hover:text-[#A1A1AA] list-none">How is this worked out? →</summary>
          <p className="mt-2 text-xs text-[#A1A1AA] leading-relaxed">
            The base is the age at which the average man has your VO₂max (HUNT study norms — the same research behind
            Garmin&apos;s number). The last 28 days then move it: resting heart rate, overnight HRV against what&apos;s typical for your age,
            weekly training (WHO minutes, vigorous counting double), daily steps, sleep length and — lightly, because it
            misreads muscle — BMI. Each factor is capped so no single one dominates, and the bonuses overlap (a fit heart
            already shows in VO₂max, resting HR and HRV), so together they add with diminishing returns; penalties
            count in full.
          </p>
        </details>
      </div>
    </section>
  );
}
