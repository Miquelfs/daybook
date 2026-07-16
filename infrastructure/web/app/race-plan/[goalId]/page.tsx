"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface Feed { at: string; carbs_g: number; item: string; }
interface Leg { duration_min: number; carbs_g_h?: number; fluid_ml_h?: number; total_carbs_g?: number; note?: string; plan?: string; schedule?: Feed[]; }
interface RacePlan {
  weight_kg: number;
  target_time: string | null;
  projected_finish: string;
  splits: Record<string, string>;
  carb_load: { target_g_per_day: number; days: { day: string; note: string }[]; warning: string };
  breakfast: { timing: string; carbs_g: number; examples: string[]; note: string };
  pre_start: { timing: string; items: string[]; note: string };
  legs: { swim: Leg; bike: Leg; run: Leg };
  caffeine: { total_mg: number; plan: { when: string; mg: number; source: string }[]; note: string };
  hydration: { bike_ml_h: number; run_ml_h: number; sweat_rate_l_h: number | null; acceptable_loss_kg: number; note: string };
  totals: { race_carbs_g: number; bike_carbs_g_h: number; run_carbs_g_h: number };
  recovery: { title: string; immediate: string; week: string };
  warnings: string[];
  contingency: string[];
}
interface Goal { id: number; name: string; race_date: string; target_time: string | null; }

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border border-[#27272A] print:border-gray-300 rounded-xl print:rounded-none p-4 space-y-2 break-inside-avoid">
      <h3 className="text-sm font-semibold text-[#FAFAFA] print:text-black">{title}</h3>
      {children}
    </section>
  );
}

function LegBlock({ label, leg }: { label: string; leg: Leg }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-sm font-semibold text-[#FAFAFA] print:text-black">{label}</span>
        <span className="text-xs text-[#71717A] print:text-gray-600">{leg.duration_min} min
          {leg.carbs_g_h ? ` · ${leg.carbs_g_h} g/h` : ""}{leg.fluid_ml_h ? ` · ${leg.fluid_ml_h} ml/h` : ""}
          {leg.total_carbs_g ? ` · ${leg.total_carbs_g} g total` : ""}</span>
      </div>
      {leg.plan && <p className="text-xs text-[#71717A] print:text-gray-600">{leg.plan}</p>}
      {leg.note && <p className="text-xs text-[#71717A] print:text-gray-600">{leg.note}</p>}
      {leg.schedule && leg.schedule.length > 0 && (
        <div className="overflow-x-auto">
          <table className="text-xs w-full">
            <tbody>
              {leg.schedule.map((f, i) => (
                <tr key={i} className="border-b border-[#18181B] print:border-gray-200">
                  <td className="py-1 pr-3 tabular-nums text-[#A1A1AA] print:text-gray-700 w-16">{f.at}</td>
                  <td className="py-1 pr-3 text-[#D4D4D8] print:text-black">{f.item}</td>
                  <td className="py-1 tabular-nums text-[#71717A] print:text-gray-600 text-right">{f.carbs_g} g</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function RacePlanPage() {
  const params = useParams();
  const goalId = params?.goalId as string;
  const [goal, setGoal] = useState<Goal | null>(null);
  const [plan, setPlan] = useState<RacePlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [weight, setWeight] = useState("85");
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    const [g, p] = await Promise.all([
      fetch(`${BASE}/race-plans/goals/${goalId}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/race-plans/goals/${goalId}/nutrition-plan`).then((r) => (r.ok ? r.json() : null)),
    ]);
    setGoal(g);
    if (p?.plan) { setPlan(p.plan); if (p.plan.weight_kg) setWeight(String(p.plan.weight_kg)); }
    setLoading(false);
  }, [goalId]);

  useEffect(() => { load(); }, [load]);

  async function generate() {
    setGenerating(true);
    try {
      const res = await fetch(`/api/race-plans/goals/${goalId}/nutrition-plan/generate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weight_kg: parseFloat(weight) || 85 }),
      });
      if (res.ok) setPlan(await res.json());
    } finally { setGenerating(false); }
  }

  if (loading) return <div className="p-6 text-sm text-[#52525B]">Loading…</div>;

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-4 print:text-black">
      {/* Header (hidden in print except title) */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <Link href="/training" className="text-xs text-[#F59E0B] print:hidden">← Training</Link>
          <h1 className="text-lg font-bold text-[#FAFAFA] print:text-black">Race-day nutrition — {goal?.name ?? "Race"}</h1>
          <p className="text-xs text-[#52525B] print:text-gray-600">{goal?.race_date}{plan ? ` · target ${plan.target_time ?? "—"} · projected ${plan.projected_finish}` : ""}</p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <input value={weight} onChange={(e) => setWeight(e.target.value)}
            className="w-16 bg-[#18181B] border border-[#27272A] rounded-lg px-2 py-1.5 text-sm text-[#FAFAFA]" />
          <span className="text-xs text-[#52525B]">kg</span>
          <button onClick={generate} disabled={generating}
            className="px-3 py-1.5 bg-[#27272A] rounded-lg text-xs text-[#A1A1AA] hover:bg-[#3F3F46] disabled:opacity-50">
            {generating ? "…" : plan ? "Regenerate" : "Generate"}
          </button>
          {plan && (
            <button onClick={() => window.print()}
              className="px-3 py-1.5 bg-[#F59E0B] text-[#09090B] rounded-lg text-xs font-semibold hover:bg-[#D97706]">
              Print / PDF
            </button>
          )}
        </div>
      </div>

      {!plan ? (
        <p className="text-sm text-[#71717A]">No plan yet — set your weight and hit Generate.</p>
      ) : (
        <>
          {plan.warnings.length > 0 && (
            <div className="bg-[#1C0A0A] print:bg-white border border-[#7F1D1D] print:border-red-400 rounded-xl px-4 py-3 space-y-1 break-inside-avoid">
              {plan.warnings.map((w, i) => <p key={i} className="text-xs text-[#F87171] print:text-red-700">⚠ {w}</p>)}
            </div>
          )}

          {/* Splits */}
          <Section title="Target splits">
            <div className="flex gap-3 flex-wrap text-xs">
              {Object.entries(plan.splits).map(([k, v]) => (
                <span key={k} className="text-[#A1A1AA] print:text-gray-700"><span className="uppercase text-[#52525B] print:text-gray-500">{k}</span> {v}</span>
              ))}
              <span className="text-[#FAFAFA] print:text-black font-semibold ml-auto">Finish {plan.projected_finish}</span>
            </div>
          </Section>

          {/* Carb load */}
          <Section title={`Carb loading — ~${plan.carb_load.target_g_per_day} g/day`}>
            {plan.carb_load.days.map((d) => (
              <p key={d.day} className="text-xs text-[#71717A] print:text-gray-700"><b className="text-[#A1A1AA] print:text-black">{d.day}:</b> {d.note}</p>
            ))}
            <p className="text-[11px] text-[#52525B] print:text-gray-500 italic">{plan.carb_load.warning}</p>
          </Section>

          {/* Breakfast + pre-start */}
          <Section title="Race morning">
            <p className="text-xs text-[#71717A] print:text-gray-700"><b className="text-[#A1A1AA] print:text-black">Breakfast ({plan.breakfast.timing}):</b> ~{plan.breakfast.carbs_g} g carbs — {plan.breakfast.examples.join(", ")}. {plan.breakfast.note}</p>
            <p className="text-xs text-[#71717A] print:text-gray-700"><b className="text-[#A1A1AA] print:text-black">Pre-start ({plan.pre_start.timing}):</b> {plan.pre_start.items.join(" + ")}. {plan.pre_start.note}</p>
          </Section>

          {/* Legs */}
          <Section title="On-course fuelling">
            <LegBlock label="🏊 Swim" leg={plan.legs.swim} />
            <div className="border-t border-[#18181B] print:border-gray-200 my-1" />
            <LegBlock label="🚴 Bike" leg={plan.legs.bike} />
            <div className="border-t border-[#18181B] print:border-gray-200 my-1" />
            <LegBlock label="🏃 Run" leg={plan.legs.run} />
          </Section>

          {/* Caffeine + hydration */}
          <Section title="Caffeine & hydration">
            <p className="text-xs text-[#71717A] print:text-gray-700"><b className="text-[#A1A1AA] print:text-black">Caffeine (~{plan.caffeine.total_mg} mg):</b> {plan.caffeine.plan.map((c) => `${c.when} ${c.mg}mg`).join(" · ")}. {plan.caffeine.note}</p>
            <p className="text-xs text-[#71717A] print:text-gray-700"><b className="text-[#A1A1AA] print:text-black">Hydration:</b> bike ~{plan.hydration.bike_ml_h} ml/h, run ~{plan.hydration.run_ml_h} ml/h{plan.hydration.sweat_rate_l_h ? ` (sweat ${plan.hydration.sweat_rate_l_h} L/h)` : ""}. {plan.hydration.note}</p>
          </Section>

          {/* Contingency */}
          <Section title="If things go sideways">
            {plan.contingency.map((c, i) => <p key={i} className="text-xs text-[#71717A] print:text-gray-700">• {c}</p>)}
          </Section>

          {/* Recovery */}
          <Section title={plan.recovery.title}>
            <p className="text-xs text-[#71717A] print:text-gray-700"><b className="text-[#A1A1AA] print:text-black">Immediately:</b> {plan.recovery.immediate}</p>
            <p className="text-xs text-[#71717A] print:text-gray-700"><b className="text-[#A1A1AA] print:text-black">Week after:</b> {plan.recovery.week}</p>
          </Section>
        </>
      )}
    </div>
  );
}
