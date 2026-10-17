"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bike, Plus, Trash2, X } from "lucide-react";
import { useVisualViewport, sheetViewportStyle } from "@/lib/useVisualViewport";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Block = {
  id: number; kind: string; name: string; start_date: string; end_date: string;
  riding_days: number; done: number; total_km: number; total_climb_m: number; planned_hours: number;
};
type DayRow = { date: string; km: string; climb_m: string; note: string; optional: boolean };

const fmt = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const estimate = (km: number, climb: number) => Math.round((km / 24 + climb / 800) * 12) * 5; // minutes, same as backend

function daysBetween(a: string, b: string): string[] {
  const out: string[] = [];
  const d = new Date(a + "T12:00:00");
  const end = new Date(b + "T12:00:00");
  while (d <= end && out.length < 60) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/** Tours & camps: deliberate blocks that replace the plan for their dates. */
export function BlocksCard({ goalId }: { goalId: number }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const { data: blocks = [] } = useQuery<Block[]>({
    queryKey: ["training-blocks", goalId],
    queryFn: () => fetch(`${BASE}/race-plans/goals/${goalId}/blocks`).then((r) => r.json()),
  });
  function refresh() {
    for (const k of ["training-blocks", "race-overview", "omyra-week", "race-today", "coach"]) qc.invalidateQueries({ queryKey: [k] });
  }
  async function remove(b: Block) {
    if (!window.confirm(`Remove "${b.name}"? The plan for those dates comes back as it was.`)) return;
    await fetch(`${BASE}/race-plans/blocks/${b.id}`, { method: "DELETE" });
    refresh();
  }

  return (
    <section className="min-w-0 rounded-2xl border border-[#27272A] bg-[#0D0D0F] p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] uppercase tracking-widest text-[#71717A] flex items-center gap-1.5"><Bike size={12} /> Tours & camps</p>
        <button onClick={() => setAdding(true)} className="text-xs text-[#F59E0B] flex items-center gap-1"><Plus size={12} /> Add</button>
      </div>
      {blocks.length === 0 ? (
        <p className="text-sm text-[#71717A]">
          Going on a bike tour or training camp? Add it here. The plan steps aside for those dates, each riding day
          becomes a session your rides count towards, and the week after turns into recovery.
        </p>
      ) : (
        <ul className="space-y-2">
          {blocks.map((b) => (
            <li key={b.id} className="rounded-xl bg-[#18181B] px-3.5 py-3 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[#E4E4E7]">{b.name}</p>
                <p className="text-[11px] text-[#71717A] mt-0.5">
                  {fmt(b.start_date)} – {fmt(b.end_date)} · {b.riding_days} riding days · {b.total_km} km · {b.total_climb_m.toLocaleString()} m
                  · ~{b.planned_hours} h
                </p>
                <p className="text-[11px] text-[#A1A1AA] mt-0.5">
                  {b.done}/{b.riding_days} days ridden · recovery week after
                </p>
              </div>
              <button onClick={() => remove(b)} className="text-[#52525B] hover:text-[#F87171] p-1" aria-label="Remove"><Trash2 size={14} /></button>
            </li>
          ))}
        </ul>
      )}
      {adding && <AddBlockSheet goalId={goalId} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); refresh(); }} />}
    </section>
  );
}

function AddBlockSheet({ goalId, onClose, onSaved }: { goalId: number; onClose: () => void; onSaved: () => void }) {
  const vv = useVisualViewport(true);
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [rows, setRows] = useState<Record<string, DayRow>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dates = useMemo(() => (start && end && end >= start ? daysBetween(start, end) : []), [start, end]);
  const row = (d: string): DayRow => rows[d] ?? { date: d, km: "", climb_m: "", note: "", optional: false };
  const set = (d: string, patch: Partial<DayRow>) => setRows((r) => ({ ...r, [d]: { ...row(d), ...patch } }));
  const totalMin = dates.reduce((n, d) => n + (Number(row(d).km) > 0 ? estimate(Number(row(d).km), Number(row(d).climb_m || 0)) : 0), 0);
  const inputCls = "bg-[#18181B] border border-[#27272A] rounded-lg px-2 py-1.5 text-base sm:text-sm text-[#FAFAFA] outline-none focus:border-[#52525B] min-w-0";

  async function save() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`${BASE}/race-plans/goals/${goalId}/blocks`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, start_date: start, end_date: end, kind: "tour",
          days: dates.map((d) => ({ date: d, km: Number(row(d).km || 0), climb_m: Number(row(d).climb_m || 0),
                                    note: row(d).note || null, optional: row(d).optional })),
        }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.detail ?? "Couldn't save");
      onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save"); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="fixed left-0 right-0 mx-auto w-full max-w-lg bg-[#09090B] border-t border-[#27272A] rounded-t-2xl p-5 overflow-y-auto overflow-x-hidden overscroll-contain"
        style={sheetViewportStyle(vv, "90vh")}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-[#FAFAFA]">Add tour / camp</h2>
          <button onClick={onClose} className="text-[#52525B]"><X size={18} /></button>
        </div>
        <div className="space-y-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Taiwan north → south" className={`w-full ${inputCls}`} />
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] text-[#71717A]">From<input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={`w-full mt-1 ${inputCls}`} /></label>
            <label className="text-[11px] text-[#71717A]">To<input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={`w-full mt-1 ${inputCls}`} /></label>
          </div>
          {dates.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] text-[#71717A]">Riding days: km and climbing (leave km empty for travel / rest days)</p>
              {dates.map((d) => {
                const r = row(d);
                const mins = Number(r.km) > 0 ? estimate(Number(r.km), Number(r.climb_m || 0)) : 0;
                return (
                  <div key={d} className="grid grid-cols-[5.5rem_1fr_1fr_3.2rem] gap-1.5 items-center">
                    <span className="text-[11px] text-[#A1A1AA]">{fmt(d)}</span>
                    <input inputMode="decimal" value={r.km} onChange={(e) => set(d, { km: e.target.value })} placeholder="km" className={inputCls} />
                    <input inputMode="numeric" value={r.climb_m} onChange={(e) => set(d, { climb_m: e.target.value })} placeholder="m up" className={inputCls} />
                    <span className="text-[10px] text-[#71717A] tabular-nums text-right">{mins ? `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, "0")}` : "—"}</span>
                  </div>
                );
              })}
              <p className="text-xs text-[#A1A1AA] pt-1">
                ~{Math.round(totalMin / 6) / 10} h of riding · plan sessions on these dates step aside · the week after becomes recovery
              </p>
            </div>
          )}
          {err && <p className="text-xs text-[#F87171]">{err}</p>}
          <button onClick={save} disabled={busy || !name || dates.length === 0}
            className="w-full py-3 rounded-xl bg-[#F59E0B] text-[#09090B] text-sm font-semibold disabled:opacity-40">
            {busy ? "Saving…" : "Add to the plan"}
          </button>
        </div>
      </div>
    </div>
  );
}
