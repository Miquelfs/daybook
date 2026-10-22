"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bike, Plus, Trash2, X } from "lucide-react";
import { useVisualViewport, sheetViewportStyle } from "@/lib/useVisualViewport";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Snap = { date: string; fitness: number; form: number };
type Block = {
  id: number; kind: string; name: string; start_date: string; end_date: string;
  riding_days: number; done: number; total_km: number; total_climb_m: number; planned_hours: number;
  ride_days?: { session_id: number; date: string; status: string; minutes: number;
                course: { name: string; km: number; climb_m: number; climb_raw_m: number; tss: number; tunnels: number } | null }[];
  projection?: { before?: Snap; after_block?: Snap; after_recovery?: Snap; fitness_gain?: number; block_tss: number } | null;
};
type Parsed = { file: string; name?: string; km?: number; climb_m?: number; climb_raw_m?: number; minutes?: number;
                tss?: number; tunnels?: unknown[]; climbs?: unknown[]; start?: [number, number]; end?: [number, number];
                error?: string };
type CourseRow = { file: string; gpx: string; parsed: Parsed };
type DayRow = { date: string; km: string; climb_m: string; note: string; optional: boolean };

const fmt = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const hm = (m: number) => `${Math.floor(m / 60)}h${String(Math.round(m % 60)).padStart(2, "0")}`;
const addDays = (d: string, n: number) => {
  const x = new Date(d + "T12:00:00");
  x.setDate(x.getDate() + n);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
// straight-line km between two [lat, lng] points
const gapKm = (a?: [number, number], b?: [number, number]) => {
  if (!a || !b) return 0;
  const dy = (b[0] - a[0]) * 110.54, dx = (b[1] - a[1]) * 111.32 * Math.cos((a[0] * Math.PI) / 180);
  return Math.hypot(dx, dy);
};
const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
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
    queryFn: () => fetch(`${BASE}/race-plans/goals/${goalId}/blocks`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => (Array.isArray(d) ? d : [])),
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
                {b.ride_days && b.ride_days.some((d) => d.course) && (
                  <div className="mt-2 space-y-0.5">
                    {b.ride_days.map((d) => (
                      <p key={d.session_id} className="text-[11px] tabular-nums flex gap-2">
                        <span className="w-20 shrink-0 text-[#71717A]">{fmt(d.date)}</span>
                        <span className="flex-1 min-w-0 truncate text-[#A1A1AA]">
                          {d.status === "completed" ? "✓ " : ""}{d.course ? `${d.course.name} · ${d.course.km} km · +${d.course.climb_m} m` : "typed in"}
                          {d.course?.tunnels ? " · ⚠ tunnel" : ""}
                        </span>
                        <span className="shrink-0 text-[#71717A]">{hm(d.minutes)}{d.course ? ` · ${d.course.tss}` : ""}</span>
                      </p>
                    ))}
                  </div>
                )}
                {b.projection?.before && b.projection.after_block && b.projection.after_recovery && (
                  <ProjectionNote p={b.projection as Required<Pick<NonNullable<Block["projection"]>, "before" | "after_block" | "after_recovery">> & NonNullable<Block["projection"]>} />
                )}
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

/** What the block does to fitness and form, if ridden as planned. */
function ProjectionNote({ p }: { p: { before: Snap; after_block: Snap; after_recovery: Snap; block_tss: number; fitness_gain?: number } }) {
  const gain = p.after_block.fitness - p.before.fitness;
  return (
    <div className="mt-2.5 pt-2.5 border-t border-[#27272A] text-[11px] space-y-1">
      <div className="grid grid-cols-3 gap-2 tabular-nums">
        {[["Before", p.before], ["Last day", p.after_block], ["After recovery", p.after_recovery]].map(([l, x]) => (
          <div key={l as string}>
            <p className="text-[9px] uppercase tracking-widest text-[#52525B]">{l as string}</p>
            <p className="text-sm font-semibold">{(x as Snap).fitness} <span className="text-[11px] font-normal text-[#71717A]">fitness</span></p>
            <p className={(x as Snap).form < -30 ? "text-rose-400" : (x as Snap).form < -10 ? "text-amber-400" : "text-[#71717A]"}>
              form {(x as Snap).form > 0 ? "+" : ""}{(x as Snap).form}
            </p>
          </div>
        ))}
      </div>
      <p className="text-[#A1A1AA]">
        ~{p.block_tss.toLocaleString("en-GB")} TSS in the block: fitness {gain >= 0 ? "+" : ""}{gain} by the last day
        {gain > 7 ? " — a much bigger jump than a normal week (+7 max), so ride the easy days truly easy, eat and sleep well" : ""}.
        {p.after_block.form < -30 ? " You'll finish deeply fatigued; the recovery week turns that into fitness." : ""}
      </p>
    </div>
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
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [firstRide, setFirstRide] = useState("");
  const [travelDays, setTravelDays] = useState(true);
  const [parsing, setParsing] = useState(false);
  // GPX day n rides on firstRide + n; the block wraps them (plus a travel day either side)
  const courseByDate = useMemo(() => {
    const m: Record<string, CourseRow> = {};
    if (firstRide) courses.forEach((c, i) => { if (!c.parsed.error) m[addDays(firstRide, i)] = c; });
    return m;
  }, [courses, firstRide]);

  async function importGpx(files: FileList | null) {
    if (!files?.length) return;
    setParsing(true); setErr(null);
    try {
      const read = await Promise.all(Array.from(files).map(async (f) => ({ name: f.name, gpx: await f.text() })));
      const r = await fetch(`${BASE}/race-plans/courses/parse`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files: read }),
      });
      if (!r.ok) throw new Error("Couldn't read the GPX files");
      const parsed: Parsed[] = await r.json();
      const rows = read.map((f, i) => ({ file: f.name, gpx: f.gpx, parsed: parsed[i] }))
        .sort((a, b) => natural(a.parsed.name ?? a.file, b.parsed.name ?? b.file));
      setCourses(rows);
      if (!name) {
        const names = rows.map((r) => r.parsed.name ?? "").filter(Boolean);
        const prefix = names.length ? names.reduce((p, n) => { let i = 0; while (i < p.length && p[i] === n[i]) i++; return p.slice(0, i); }) : "";
        setName(prefix.replace(/[\s\-_·]*(day|etapa|stage)?\s*$/i, "").trim());
      }
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't read the GPX files"); }
    finally { setParsing(false); }
  }

  // keep the block's range in step with the courses
  function placeCourses(first: string, withTravel = travelDays) {
    setFirstRide(first);
    const n = courses.filter((c) => !c.parsed.error).length;
    if (!first || !n) return;
    setStart(addDays(first, withTravel ? -1 : 0));
    setEnd(addDays(first, n - 1 + (withTravel ? 1 : 0)));
  }

  const dates = useMemo(() => (start && end && end >= start ? daysBetween(start, end) : []), [start, end]);
  const row = (d: string): DayRow => rows[d] ?? { date: d, km: "", climb_m: "", note: "", optional: false };
  const set = (d: string, patch: Partial<DayRow>) => setRows((r) => ({ ...r, [d]: { ...row(d), ...patch } }));
  const totalMin = dates.reduce((n, d) => n + (courseByDate[d]?.parsed.minutes
    ?? (Number(row(d).km) > 0 ? estimate(Number(row(d).km), Number(row(d).climb_m || 0)) : 0)), 0);
  const totalTss = dates.reduce((n, d) => n + (courseByDate[d]?.parsed.tss ?? 0), 0);
  const inputCls = "bg-[#18181B] border border-[#27272A] rounded-lg px-2 py-1.5 text-base sm:text-sm text-[#FAFAFA] outline-none focus:border-[#52525B] min-w-0";

  async function save() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`${BASE}/race-plans/goals/${goalId}/blocks`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, start_date: start, end_date: end, kind: "tour",
          days: dates.map((d) => courseByDate[d]
            ? { date: d, gpx: courseByDate[d].gpx, note: courseByDate[d].parsed.name ?? null, optional: false }
            : { date: d, km: Number(row(d).km || 0), climb_m: Number(row(d).climb_m || 0),
                note: row(d).note || null, optional: row(d).optional }),
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
          <div className="rounded-xl border border-dashed border-[#3F3F46] p-3 space-y-2">
            <label className="flex items-center justify-between gap-3 cursor-pointer">
              <span className="text-sm text-[#D4D4D8]">Import GPX courses <span className="text-[11px] text-[#71717A]">one per riding day</span></span>
              <span className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#18181B] text-[#F59E0B]">{parsing ? "Reading…" : "Choose files"}</span>
              <input type="file" accept=".gpx,application/gpx+xml" multiple className="hidden" onChange={(e) => importGpx(e.target.files)} />
            </label>
            {courses.length > 0 && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[11px] text-[#71717A]">First riding day
                    <input type="date" value={firstRide} onChange={(e) => placeCourses(e.target.value)} className={`w-full mt-1 ${inputCls}`} />
                  </label>
                  <label className="text-[11px] text-[#71717A] flex items-end gap-2 pb-2">
                    <input type="checkbox" checked={travelDays} onChange={(e) => { setTravelDays(e.target.checked); placeCourses(firstRide, e.target.checked); }} />
                    travel day before and after
                  </label>
                </div>
                <div className="space-y-1">
                  {courses.map((c, i) => (
                    <p key={c.file} className="text-[11px] tabular-nums flex gap-2">
                      <span className="w-16 shrink-0 text-[#71717A]">{firstRide ? fmt(addDays(firstRide, i)) : `#${i + 1}`}</span>
                      {c.parsed.error ? <span className="text-[#F87171] truncate">{c.file}: {c.parsed.error}</span> : (
                        <>
                          <span className="flex-1 min-w-0 truncate text-[#D4D4D8]">
                            {c.parsed.name} · {c.parsed.km} km · +{c.parsed.climb_m} m
                            {(c.parsed.tunnels?.length ?? 0) > 0 ? <span className="text-[#FCD34D]"> · ⚠ {c.parsed.tunnels!.length} tunnel{c.parsed.tunnels!.length > 1 ? "s" : ""} (Garmin +{c.parsed.climb_raw_m} m)</span> : null}
                          </span>
                          <span className="shrink-0 text-[#71717A]">{hm(c.parsed.minutes ?? 0)} · {c.parsed.tss} TSS</span>
                        </>
                      )}
                    </p>
                  ))}
                  {courses.slice(1).map((c, i) => {
                    const g = gapKm(courses[i].parsed.end, c.parsed.start);
                    return g >= 2 ? (
                      <p key={`gap-${c.file}`} className="text-[11px] text-[#FCD34D]">
                        ⚠ {courses[i].parsed.name} ends ~{Math.round(g)} km from where {c.parsed.name} starts — sleep near the start or add the connector.
                      </p>
                    ) : null;
                  })}
                </div>
                <p className="text-[11px] text-[#71717A]">Time from a speed-by-gradient model for a loaded touring bike (no stops); load estimated as steady Z2.</p>
              </>
            )}
          </div>
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
                const c = courseByDate[d];
                if (c) return (
                  <div key={d} className="grid grid-cols-[5.5rem_1fr_3.2rem] gap-1.5 items-center">
                    <span className="text-[11px] text-[#A1A1AA]">{fmt(d)}</span>
                    <span className="text-[11px] text-[#D4D4D8] truncate">🗺 {c.parsed.name} · {c.parsed.km} km · +{c.parsed.climb_m} m</span>
                    <span className="text-[10px] text-[#71717A] tabular-nums text-right">{hm(c.parsed.minutes ?? 0)}</span>
                  </div>
                );
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
                ~{Math.round(totalMin / 6) / 10} h of riding{totalTss ? ` · ~${totalTss.toLocaleString("en-GB")} TSS` : ""} · plan sessions on these dates step aside · the week after becomes recovery
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
