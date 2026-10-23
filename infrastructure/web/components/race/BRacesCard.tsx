"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Flag, Plus, Trash2 } from "lucide-react";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type BRace = {
  id: number; name: string; race_type: string; race_date: string; runs: number; runs_done: number; run_hours: number;
  bike_swapped: number; target_time: string; race_pace: string; paces: Record<string, string>;
};

const fmt = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const weeksTo = (d: string) => Math.max(0, Math.round((new Date(d + "T12:00:00").getTime() - Date.now()) / 6.048e8));

/** B races on the way to the main goal: their runs live inside this plan, with a short taper. */
export function BRacesCard({ goalId }: { goalId: number }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("Half marathon");
  const [day, setDay] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { data: races = [] } = useQuery<BRace[]>({
    queryKey: ["b-races", goalId],
    queryFn: () => fetch(`${BASE}/race-plans/goals/${goalId}/b-races`).then((r) => (r.ok ? r.json() : [])),
  });
  function refresh() {
    for (const k of ["b-races", "race-overview", "omyra-week", "race-today", "coach", "training-blocks"]) qc.invalidateQueries({ queryKey: [k] });
  }
  async function add() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`${BASE}/race-plans/goals/${goalId}/b-races`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, race_date: day, race_type: "half_marathon" }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.detail ?? "Couldn't add it");
      setAdding(false); refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't add it"); }
    finally { setBusy(false); }
  }
  async function remove(b: BRace) {
    if (!window.confirm(`Remove "${b.name}"? Its runs go and the bike sessions they replaced come back.`)) return;
    await fetch(`${BASE}/race-plans/b-races/${b.id}`, { method: "DELETE" });
    refresh();
  }
  const inputCls = "bg-[#18181B] border border-[#27272A] rounded-lg px-2 py-1.5 text-base sm:text-sm text-[#FAFAFA] outline-none focus:border-[#52525B] min-w-0";

  return (
    <section className="min-w-0 rounded-2xl border border-[#27272A] bg-[#0D0D0F] p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] uppercase tracking-widest text-[#71717A] flex items-center gap-1.5"><Flag size={12} /> Races on the way</p>
        {!adding && <button onClick={() => setAdding(true)} className="text-xs text-[#F59E0B] flex items-center gap-1"><Plus size={12} /> Add</button>}
      </div>
      {races.length === 0 && !adding && (
        <p className="text-sm text-[#71717A]">
          A half marathon before the big one? Add it: easy, quality and long runs are swapped into this plan (recovery
          spins first, Zone 2 rides from January), with a short taper and easy days after. Long rides stay untouched.
        </p>
      )}
      <ul className="space-y-2">
        {races.map((b) => (
          <li key={b.id} className="rounded-xl bg-[#18181B] px-3.5 py-3 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[#E4E4E7]">🏃 {b.name} · {fmt(b.race_date)}</p>
              <p className="text-[11px] text-[#71717A] mt-0.5 tabular-nums">
                {weeksTo(b.race_date)} weeks · {b.runs} runs (~{b.run_hours} h) · {b.bike_swapped} bike sessions swapped or set aside
              </p>
              <p className="text-[11px] text-[#A1A1AA] mt-1 tabular-nums">
                Target ~{b.target_time} at {b.race_pace} · easy {b.paces.easy} · tempo {b.paces.tempo} · threshold {b.paces.threshold} · intervals {b.paces.vo2}
              </p>
              <p className="text-[11px] text-[#71717A] mt-0.5">{b.runs_done}/{b.runs} runs done · paces follow your run threshold</p>
            </div>
            <button onClick={() => remove(b)} className="text-[#52525B] hover:text-[#F87171] p-1" aria-label="Remove"><Trash2 size={14} /></button>
          </li>
        ))}
      </ul>
      {adding && (
        <div className="space-y-2 mt-2">
          <div className="grid grid-cols-2 gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Name" />
            <input type="date" value={day} onChange={(e) => setDay(e.target.value)} className={inputCls} />
          </div>
          {err && <p className="text-xs text-[#F87171]">{err}</p>}
          <div className="flex gap-2">
            <button onClick={add} disabled={busy || !day}
                    className="flex-1 py-2 rounded-lg bg-[#F59E0B] text-[#09090B] text-sm font-semibold disabled:opacity-40">
              {busy ? "Adding…" : "Add to the plan"}
            </button>
            <button onClick={() => setAdding(false)} className="px-4 py-2 rounded-lg bg-[#18181B] text-sm text-[#A1A1AA]">Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}
