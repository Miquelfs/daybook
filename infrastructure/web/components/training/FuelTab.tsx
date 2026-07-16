"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface RaceGoal { id: number; name: string; race_type: string; status: string; }
interface GutWeek {
  week: number; session_date: string; session_id: number; session_type: string;
  duration_min: number; target_g_h: number; best_logged_g_h: number | null; on_track: boolean;
}
interface SweatTest {
  id: number; date: string; sport: string; duration_min: number; conditions: string | null;
  weight_pre_kg: number; weight_post_kg: number; sweat_rate_l_h: number | null;
}
interface SweatSummary {
  overall: number | null;
  by_conditions: { conditions: string; sweat_rate_l_h: number; n: number }[];
  race_planning_rate?: number;
}
interface Product {
  id: number; name: string; kind: string; carbs_g: number; sodium_mg: number;
  caffeine_mg: number; fluid_ml: number; notes: string | null; archived: boolean;
}

// ── Gut-training ramp ────────────────────────────────────────────────────────

function GutTrainingCard({ goalId }: { goalId: number }) {
  const { data } = useQuery<GutWeek[]>({
    queryKey: ["fuel-gut-training", goalId],
    queryFn: () => fetch(`/api/nutrition/gut-training?goal_id=${goalId}`).then((r) => (r.ok ? r.json() : [])),
    staleTime: 60_000,
  });
  const weeks = data ?? [];
  if (weeks.length === 0) return null;
  const maxG = 100;

  return (
    <section className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-[#FAFAFA]">Gut training — carb intake ramp</h3>
        <p className="text-xs text-[#52525B] mt-0.5">Build to 90 g/h on your key long session each week. Target line rises as race day nears.</p>
      </div>
      <div className="space-y-1.5">
        {weeks.map((w) => {
          const logged = w.best_logged_g_h ?? 0;
          return (
            <div key={w.session_id} className="flex items-center gap-2">
              <span className="text-[10px] text-[#52525B] w-10 tabular-nums">Wk {w.week}</span>
              <div className="flex-1 relative h-5 bg-[#18181B] rounded">
                {/* logged bar */}
                <div
                  className="absolute inset-y-0 left-0 rounded"
                  style={{ width: `${Math.min(100, (logged / maxG) * 100)}%`, background: w.on_track ? "#4ADE80" : "#F59E0B" }}
                />
                {/* target marker */}
                <div className="absolute inset-y-0 w-0.5 bg-[#FAFAFA]" style={{ left: `${(w.target_g_h / maxG) * 100}%` }} title={`Target ${w.target_g_h} g/h`} />
              </div>
              <span className="text-[10px] tabular-nums w-24 text-right text-[#71717A]">
                {logged ? `${logged}` : "—"}<span className="text-[#3F3F46]"> / {w.target_g_h} g/h</span>
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-[#3F3F46]">White line = target · bar = best logged (green = on track)</p>
    </section>
  );
}

// ── Sweat tests ──────────────────────────────────────────────────────────────

function SweatCard() {
  const qc = useQueryClient();
  const { data: tests } = useQuery<SweatTest[]>({
    queryKey: ["fuel-sweat-tests"],
    queryFn: () => fetch(`/api/nutrition/sweat-tests`).then((r) => (r.ok ? r.json() : [])),
  });
  const { data: summary } = useQuery<SweatSummary>({
    queryKey: ["fuel-sweat-rate"],
    queryFn: () => fetch(`/api/nutrition/sweat-rate`).then((r) => (r.ok ? r.json() : { overall: null, by_conditions: [] })),
  });
  const [form, setForm] = useState({ sport: "ride", duration_min: "60", conditions: "warm", weight_pre_kg: "", weight_post_kg: "", fluid_intake_ml: "0" });
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function submit() {
    if (!form.weight_pre_kg || !form.weight_post_kg) return;
    setSaving(true); setResult(null);
    try {
      const res = await fetch(`/api/nutrition/sweat-tests`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sport: form.sport, duration_min: parseInt(form.duration_min, 10), conditions: form.conditions,
          weight_pre_kg: parseFloat(form.weight_pre_kg), weight_post_kg: parseFloat(form.weight_post_kg),
          fluid_intake_ml: parseFloat(form.fluid_intake_ml || "0"),
        }),
      });
      const d = await res.json();
      setResult(`Sweat rate ${d.sweat_rate_l_h} L/h → drink ~${d.hydration_target?.ml_per_h} ml/h`);
      setForm({ ...form, weight_pre_kg: "", weight_post_kg: "" });
      qc.invalidateQueries({ queryKey: ["fuel-sweat-tests"] });
      qc.invalidateQueries({ queryKey: ["fuel-sweat-rate"] });
    } finally { setSaving(false); }
  }

  return (
    <section className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-[#FAFAFA]">Sweat rate</h3>
        <p className="text-xs text-[#52525B] mt-0.5">Weigh yourself before &amp; after a session (record fluid drunk). Repeat across conditions.</p>
      </div>
      {summary && summary.overall != null && (
        <div className="flex gap-2 flex-wrap">
          <span className="text-xs px-2 py-1 rounded bg-[#18181B] text-[#A1A1AA]">Overall {summary.overall} L/h</span>
          {summary.by_conditions.map((b) => (
            <span key={b.conditions} className="text-xs px-2 py-1 rounded bg-[#18181B] text-[#71717A]">
              {b.conditions}: {b.sweat_rate_l_h} L/h <span className="text-[#3F3F46]">(n={b.n})</span>
            </span>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <select value={form.sport} onChange={(e) => setForm({ ...form, sport: e.target.value })}
          className="bg-[#18181B] border border-[#27272A] rounded-lg px-2 py-2 text-sm text-[#FAFAFA]">
          <option value="ride">Bike</option><option value="run">Run</option><option value="swim">Swim</option>
        </select>
        <select value={form.conditions} onChange={(e) => setForm({ ...form, conditions: e.target.value })}
          className="bg-[#18181B] border border-[#27272A] rounded-lg px-2 py-2 text-sm text-[#FAFAFA]">
          <option value="cool">Cool</option><option value="warm">Warm</option><option value="hot">Hot</option>
          <option value="humid">Humid</option><option value="indoor">Indoor</option>
        </select>
        <input value={form.duration_min} onChange={(e) => setForm({ ...form, duration_min: e.target.value })} placeholder="min"
          className="bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA]" />
        <input value={form.weight_pre_kg} onChange={(e) => setForm({ ...form, weight_pre_kg: e.target.value })} placeholder="pre kg"
          className="bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA]" />
        <input value={form.weight_post_kg} onChange={(e) => setForm({ ...form, weight_post_kg: e.target.value })} placeholder="post kg"
          className="bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA]" />
        <input value={form.fluid_intake_ml} onChange={(e) => setForm({ ...form, fluid_intake_ml: e.target.value })} placeholder="drank ml"
          className="bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA]" />
      </div>
      <div className="flex items-center gap-3">
        <button onClick={submit} disabled={saving}
          className="px-4 py-2 bg-[#27272A] rounded-lg text-xs text-[#A1A1AA] hover:bg-[#3F3F46] disabled:opacity-50">
          {saving ? "Saving…" : "Add sweat test"}
        </button>
        {result && <span className="text-xs text-[#4ADE80]">{result}</span>}
      </div>
      {tests && tests.length > 0 && (
        <div className="space-y-1 pt-1">
          {tests.slice(0, 5).map((t) => (
            <div key={t.id} className="flex items-center gap-2 text-xs text-[#71717A]">
              <span className="text-[#52525B] tabular-nums">{t.date}</span>
              <span>{t.sport} · {t.conditions ?? "?"}</span>
              <span className="ml-auto tabular-nums text-[#A1A1AA]">{t.sweat_rate_l_h} L/h</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Product library ──────────────────────────────────────────────────────────

const KIND_LABEL: Record<string, string> = {
  gel: "Gel", drink_mix: "Drink", bar: "Bar", chew: "Chew", real_food: "Food",
};

function ProductCard() {
  const qc = useQueryClient();
  const { data: products } = useQuery<Product[]>({
    queryKey: ["fuel-products"],
    queryFn: () => fetch(`/api/nutrition/products`).then((r) => (r.ok ? r.json() : [])),
  });
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", kind: "gel", carbs_g: "", sodium_mg: "", caffeine_mg: "" });

  async function add() {
    if (!form.name || !form.carbs_g) return;
    await fetch(`/api/nutrition/products`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name, kind: form.kind, carbs_g: parseFloat(form.carbs_g),
        sodium_mg: parseFloat(form.sodium_mg || "0"), caffeine_mg: parseFloat(form.caffeine_mg || "0"),
      }),
    });
    setForm({ name: "", kind: "gel", carbs_g: "", sodium_mg: "", caffeine_mg: "" });
    setAdding(false);
    qc.invalidateQueries({ queryKey: ["fuel-products"] });
  }

  async function archive(id: number) {
    await fetch(`/api/nutrition/products/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: true }),
    });
    qc.invalidateQueries({ queryKey: ["fuel-products"] });
  }

  return (
    <section className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[#FAFAFA]">Product library</h3>
        <button onClick={() => setAdding((a) => !a)} className="text-xs text-[#F59E0B] hover:text-[#D97706]">
          {adding ? "Cancel" : "+ Add"}
        </button>
      </div>
      {adding && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="name"
            className="col-span-2 bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA]" />
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}
            className="bg-[#18181B] border border-[#27272A] rounded-lg px-2 py-2 text-sm text-[#FAFAFA]">
            {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input value={form.carbs_g} onChange={(e) => setForm({ ...form, carbs_g: e.target.value })} placeholder="carbs g"
            className="bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA]" />
          <input value={form.caffeine_mg} onChange={(e) => setForm({ ...form, caffeine_mg: e.target.value })} placeholder="caf mg"
            className="bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA]" />
          <button onClick={add} className="col-span-2 sm:col-span-5 px-4 py-2 bg-[#27272A] rounded-lg text-xs text-[#A1A1AA] hover:bg-[#3F3F46]">Save product</button>
        </div>
      )}
      <div className="space-y-1">
        {(products ?? []).map((p) => (
          <div key={p.id} className="flex items-center gap-2 text-xs">
            <span className="px-1.5 py-0.5 rounded bg-[#18181B] text-[#71717A] w-12 text-center">{KIND_LABEL[p.kind] ?? p.kind}</span>
            <span className="text-[#FAFAFA] flex-1 truncate">{p.name}</span>
            <span className="text-[#71717A] tabular-nums">{p.carbs_g}g{p.caffeine_mg ? ` · ${p.caffeine_mg}mg caf` : ""}{p.sodium_mg ? ` · ${p.sodium_mg}mg Na` : ""}</span>
            <button onClick={() => archive(p.id)} className="text-[#3F3F46] hover:text-[#F87171] ml-1">✕</button>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function FuelTab() {
  const { data: goals } = useQuery<RaceGoal[]>({
    queryKey: ["fuel-goals"],
    queryFn: () => fetch(`${BASE}/race-plans/goals?status=active`).then((r) => (r.ok ? r.json() : [])),
  });
  const goal = goals?.[0];

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-base font-semibold text-[#FAFAFA]">Fuel — the fourth discipline</h2>
          <p className="text-xs text-[#52525B]">Train your gut, know your sweat, plan race day.</p>
        </div>
        {goal && (
          <Link href={`/race-plan/${goal.id}`}
            className="text-xs px-3 py-1.5 bg-[#F59E0B] text-[#09090B] rounded-lg font-semibold hover:bg-[#D97706]">
            Race-day nutrition plan →
          </Link>
        )}
      </div>

      {goal ? <GutTrainingCard goalId={goal.id} /> : (
        <p className="text-xs text-[#52525B]">Create a race goal in Omyra to unlock gut-training tracking.</p>
      )}
      <SweatCard />
      <ProductCard />
    </section>
  );
}
