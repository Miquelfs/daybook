"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import { Check, Plus, Trash2, X } from "lucide-react";
import {
  plansApi, PLAN_KEYS,
  type BudgetLine, type PlannedTripDetail, type Task, type TripDay, type TripDayKind, type TripItem,
} from "@/lib/plans-api";
import { TaskRow } from "@/components/plan/TaskRow";
import { Sheet, Field, Chips, inputCls } from "@/components/plan/Sheet";
import { Block, Label, Panel, Pill } from "@/components/plan/ui";

// ── Shared ───────────────────────────────────────────────────────────────────

export function useRefresh(id: number) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["planned-trip", id] });
    PLAN_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [...k] }));
  };
}

const SYMBOL: Record<string, string> = { TWD: "NT$", EUR: "€", USD: "$", GBP: "£", JPY: "¥" };

export function money(t: PlannedTripDetail) {
  const cur = t.currency ?? "EUR";
  const sym = SYMBOL[cur] ?? `${cur} `;
  const local = (v: number | null | undefined) => (v == null ? "—" : `${sym}${Math.round(v).toLocaleString("en-GB")}`);
  const eur = (v: number | null | undefined) =>
    v == null ? "—" : cur === "EUR" || !t.fx_rate ? `€${Math.round(v).toLocaleString("en-GB")}`
      : `€${Math.round(v / t.fx_rate).toLocaleString("en-GB")}`;
  return { cur, sym, local, eur, isEur: cur === "EUR" || !t.fx_rate };
}

/** Badge for a day: ✈ travel, ★ rest, the riding-day number. */
function dayBadge(days: TripDay[], i: number): { text: string; cls: string } {
  const d = days[i];
  if (d.kind === "travel") return { text: "✈", cls: "bg-[#27272A] text-[#D4D4D8]" };
  if (d.kind === "rest") return { text: "★", cls: "bg-[#27272A] text-[#F59E0B]" };
  if (d.kind === "ride") {
    const n = days.slice(0, i + 1).filter((x) => x.kind === "ride").length;
    return { text: String(n), cls: "bg-[#F59E0B] text-black" };
  }
  return { text: String(i + 1), cls: "bg-[#18181B] text-[#71717A]" };
}

// ── Overview ─────────────────────────────────────────────────────────────────

function DecisionRow({ item, onChange }: { item: TripItem; onChange: () => void }) {
  const [answering, setAnswering] = useState(false);
  const [answer, setAnswer] = useState(item.detail ?? "");
  async function decide() {
    await plansApi.updateTripItem(item.id, { detail: answer.trim() || null, done: true });
    setAnswering(false);
    onChange();
  }
  async function reopen() {
    await plansApi.updateTripItem(item.id, { done: false });
    onChange();
  }
  return (
    <div className="py-3 space-y-2">
      <p className={`text-sm leading-snug ${item.done ? "text-[#71717A]" : "text-[#FAFAFA]"}`}>{item.title}</p>
      {item.done ? (
        <div className="flex items-start gap-2 text-xs">
          <Check size={13} className="text-emerald-400 mt-0.5 shrink-0" />
          <span className="text-emerald-400 flex-1">{item.detail || "Decided"}</span>
          <button onClick={reopen} className="text-[#52525B] hover:text-[#A1A1AA]">Reopen</button>
        </div>
      ) : answering ? (
        <div className="flex gap-2">
          <input autoFocus value={answer} onChange={(e) => setAnswer(e.target.value)}
                 onKeyDown={(e) => { if (e.key === "Enter") decide(); }}
                 placeholder="What did you decide?" className={`${inputCls} py-1.5`} />
          <button onClick={decide} className="shrink-0 text-xs font-medium text-[#F59E0B] px-2">Save</button>
        </div>
      ) : (
        <button onClick={() => setAnswering(true)} className="text-xs text-[#F59E0B]">Decide →</button>
      )}
    </div>
  );
}

export function Overview({ t, onTab }: { t: PlannedTripDetail; onTab: (tab: string) => void }) {
  const refresh = useRefresh(t.id);
  const m = money(t);
  const decisions = t.items.filter((i) => i.kind === "decision");
  const open = decisions.filter((d) => !d.done);
  const risks = t.items.filter((i) => i.kind === "risk");
  const nextUp = t.checklist.filter((x) => !x.done_at).slice(0, 4);
  const today = format(new Date(), "yyyy-MM-dd");
  const rideDays = t.days.filter((d) => d.kind === "ride").length;
  const midEur = t.budget_totals_eur.mid ?? (m.isEur ? t.budget_totals.mid : null);

  return (
    <div className="space-y-8">
      <Panel className="p-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div><Label>Days</Label><p className="text-2xl font-semibold tabular-nums">{t.days.length}</p>
            <p className="text-xs text-[#71717A]">{rideDays ? `${rideDays} riding` : `${t.nights} nights`}</p></div>
          <div><Label>Nights booked</Label>
            <p className={`text-2xl font-semibold tabular-nums ${t.nights_to_book ? "text-amber-400" : "text-emerald-400"}`}>
              {t.nights_booked}/{t.nights_booked + t.nights_to_book}</p>
            <p className="text-xs text-[#71717A]">{t.nights_to_book ? `${t.nights_to_book} to book` : "all set"}</p></div>
          <div><Label>Budget</Label>
            <p className="text-2xl font-semibold tabular-nums">{midEur != null && t.budget_lines.length ? `€${Math.round(midEur + (t.flights_eur ?? 0)).toLocaleString("en-GB")}` : t.budget != null ? `€${Math.round(t.budget)}` : "—"}</p>
            <p className="text-xs text-[#71717A]">{t.budget_lines.length ? `mid, all-in${t.flights_eur ? " with flights" : ""}` : "target"}</p></div>
          <div><Label>Checklist</Label><p className="text-2xl font-semibold tabular-nums">{t.checklist_done}/{t.checklist_total}</p>
            <p className="text-xs text-[#71717A]">done</p></div>
        </div>
      </Panel>

      {decisions.length > 0 && (
        <Block title={open.length ? `Open decisions · ${open.length}` : "Decisions"} tone={open.length ? "warn" : undefined}>
          <Panel className="px-4 py-1 divide-y divide-[#18181B]">
            {[...open, ...decisions.filter((d) => d.done)].map((d) => <DecisionRow key={d.id} item={d} onChange={refresh} />)}
          </Panel>
        </Block>
      )}

      {nextUp.length > 0 && (
        <Block title="Next to do" action={<button onClick={() => onTab("checklist")} className="text-xs text-[#52525B] hover:text-[#A1A1AA]">All →</button>}>
          <Panel className="px-4 py-1 divide-y divide-[#18181B]">
            {nextUp.map((x) => <TaskRow key={x.id} task={x} today={today} hideArea />)}
          </Panel>
        </Block>
      )}

      {risks.length > 0 && (
        <Block title="Risks and plan B">
          <Panel className="px-4 py-1 divide-y divide-[#18181B]">
            {risks.map((r) => (
              <div key={r.id} className="py-3">
                <p className="text-sm font-medium text-[#FAFAFA]">{r.title}</p>
                {r.section && <p className="text-[11px] text-[#52525B] mt-0.5">{r.section}</p>}
                {r.detail && <p className="text-xs text-[#A1A1AA] mt-1">{r.detail}</p>}
              </div>
            ))}
          </Panel>
        </Block>
      )}
    </div>
  );
}

// ── Itinerary ────────────────────────────────────────────────────────────────

function DaySheet({ t, day, index, onClose }: { t: PlannedTripDetail; day: TripDay; index: number; onClose: () => void }) {
  const refresh = useRefresh(t.id);
  const m = money(t);
  const [f, setF] = useState({
    kind: day.kind, note: day.note ?? "", sleep: day.sleep ?? "",
    cost: day.sleep_cost != null ? String(day.sleep_cost) : "", booked: day.booked, ref: day.booking_ref ?? "",
  });
  async function save() {
    await plansApi.setTripDay(t.id, day.date, {
      kind: f.kind, note: f.note, sleep: f.sleep || null,
      sleep_cost: f.cost.trim() ? Number(f.cost.replace(",", ".")) : null, booked: f.booked, booking_ref: f.ref || null,
    });
    refresh();
    onClose();
  }
  return (
    <Sheet title={`Day ${index + 1} · ${format(parseISO(day.date), "EEE d MMM")}`} onClose={onClose}>
      <Chips value={f.kind} onChange={(v) => setF({ ...f, kind: v })}
             options={[{ value: "ride" as TripDayKind | null, label: "Riding / main day" }, { value: "rest", label: "Rest / city" },
                       { value: "travel", label: "Travel" }, { value: null, label: "—" }]} />
      <Field label="Plan">
        <textarea rows={3} className={`${inputCls} resize-none`} value={f.note} autoFocus
                  placeholder="Taipei → Nan'ao · 130 km · +1,786 m · start 06:30"
                  onChange={(e) => setF({ ...f, note: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Sleep in"><input className={inputCls} value={f.sleep} placeholder="Nan'ao"
                                       onChange={(e) => setF({ ...f, sleep: e.target.value })} /></Field>
        <Field label={`Price (${m.sym.trim()})`}><input inputMode="decimal" className={inputCls} value={f.cost}
                                       onChange={(e) => setF({ ...f, cost: e.target.value })} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3 items-end">
        <Field label="Booking ref"><input className={inputCls} value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} /></Field>
        <Pill on={f.booked} onClick={() => setF({ ...f, booked: !f.booked })}>{f.booked ? "✓ Booked" : "Not booked yet"}</Pill>
      </div>
      <button onClick={save} className="w-full bg-[#F59E0B] text-black font-semibold rounded-xl py-3 text-sm">Save</button>
    </Sheet>
  );
}

export function Itinerary({ t }: { t: PlannedTripDetail }) {
  const refresh = useRefresh(t.id);
  const m = money(t);
  const [open, setOpen] = useState<number | null>(null);
  async function toggleBooked(day: TripDay) {
    await plansApi.setTripDay(t.id, day.date, { booked: !day.booked });
    refresh();
  }
  return (
    <div className="space-y-6">
      <Panel className="px-5 py-4">
        <div className="grid grid-cols-3 gap-4">
          <div><Label>Nights booked</Label><p className="text-2xl font-semibold tabular-nums">{t.nights_booked}/{t.nights_booked + t.nights_to_book}</p></div>
          <div><Label>Sleeping</Label><p className="text-2xl font-semibold tabular-nums">{m.local(t.sleep_total)}</p></div>
          {!m.isEur && <div><Label>In €</Label><p className="text-2xl font-semibold tabular-nums">{m.eur(t.sleep_total)}</p></div>}
        </div>
      </Panel>
      <div className="space-y-2">
        {t.days.map((d, i) => {
          const b = dayBadge(t.days, i);
          return (
            <div key={d.date} className="bg-[#0D0D0F] border border-[#27272A] rounded-2xl p-3.5 flex gap-3">
              <span className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-sm font-semibold ${b.cls}`}>{b.text}</span>
              <button onClick={() => setOpen(i)} className="flex-1 min-w-0 text-left">
                <p className="text-[11px] uppercase tracking-widest text-[#52525B]">{format(parseISO(d.date), "EEE d MMM")}</p>
                <p className={`text-sm leading-snug mt-0.5 ${d.note ? "text-[#FAFAFA]" : "text-[#3F3F46]"}`}>{d.note ?? "Add the plan for this day"}</p>
              </button>
              {(d.sleep || d.sleep_cost != null) && (
                <div className="shrink-0 text-right">
                  <p className="text-xs text-[#A1A1AA]">🛏 {d.sleep ?? "—"}</p>
                  {d.sleep_cost != null && <p className="text-[11px] text-[#52525B] tabular-nums">{m.local(d.sleep_cost)}</p>}
                  {d.sleep && d.kind !== "travel" && (
                    <button onClick={() => toggleBooked(d)}
                            className={`mt-1 text-[10px] px-2 py-0.5 rounded-full ${d.booked ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"}`}>
                      {d.booked ? "✓ booked" : "to book"}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {open != null && <DaySheet t={t} day={t.days[open]} index={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

// ── Checklist (tasks, grouped by how long before the trip they're due) ───────

const PHASES = ["Now", "Within two weeks", "Final week", "On the trip", "Anytime"] as const;

function phaseOf(task: Task, start: string): (typeof PHASES)[number] {
  if (!task.due_date) return "Anytime";
  const before = differenceInCalendarDays(parseISO(start), parseISO(task.due_date));
  if (before < 0) return "On the trip";
  if (before < 7) return "Final week";
  if (before < 14) return "Within two weeks";
  return "Now";
}

export function Checklist({ t, onEdit }: { t: PlannedTripDetail; onEdit: (x: Task) => void }) {
  const refresh = useRefresh(t.id);
  const today = format(new Date(), "yyyy-MM-dd");
  const [title, setTitle] = useState("");
  const [phase, setPhase] = useState<(typeof PHASES)[number]>("Now");
  const groups = useMemo(() => PHASES.map((p) => [p, t.checklist.filter((x) => phaseOf(x, t.start_date) === p)] as const)
    .filter(([, xs]) => xs.length), [t.checklist, t.start_date]);

  function dueFor(p: (typeof PHASES)[number]): string | null {
    const start = parseISO(t.start_date);
    if (p === "Now") return today;
    if (p === "Within two weeks") return format(addDays(start, -7), "yyyy-MM-dd");
    if (p === "Final week") return format(addDays(start, -2), "yyyy-MM-dd");
    if (p === "On the trip") return t.start_date;
    return null;
  }
  async function add() {
    if (!title.trim()) return;
    await plansApi.createTask({ title: title.trim(), planned_trip_id: t.id, due_date: dueFor(phase), area: "travel" });
    setTitle("");
    refresh();
  }
  const pct = t.checklist_total ? Math.round((t.checklist_done / t.checklist_total) * 100) : 0;

  return (
    <div className="space-y-8">
      <Panel className="p-3 space-y-3">
        <div className="flex items-center gap-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }}
                 placeholder="Book the Nan'ao hotel…" className="flex-1 bg-transparent px-1 py-1.5 text-[15px] text-[#FAFAFA] placeholder:text-[#3F3F46] outline-none" />
          <button onClick={add} disabled={!title.trim()} aria-label="Add"
                  className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#F59E0B] text-black disabled:bg-[#18181B] disabled:text-[#3F3F46]"><Plus size={15} /></button>
        </div>
        <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
          {PHASES.map((p) => <Pill key={p} on={phase === p} onClick={() => setPhase(p)}>{p}</Pill>)}
        </div>
      </Panel>
      {t.checklist_total > 0 && (
        <div>
          <div className="flex justify-between text-xs text-[#71717A] mb-1"><span>{t.checklist_done} of {t.checklist_total} done</span><span>{pct}%</span></div>
          <div className="h-1.5 bg-[#18181B] rounded-full"><div className={`h-full rounded-full ${pct === 100 ? "bg-emerald-500" : "bg-[#F59E0B]"}`} style={{ width: `${pct}%` }} /></div>
        </div>
      )}
      {groups.map(([p, xs]) => (
        <Block key={p} title={`${p} · ${xs.filter((x) => !x.done_at).length} open`}>
          <Panel className="px-4 py-1 divide-y divide-[#18181B]">
            {xs.map((x) => <TaskRow key={x.id} task={x} today={today} onEdit={onEdit} hideArea />)}
          </Panel>
        </Block>
      ))}
    </div>
  );
}

// ── Packing ──────────────────────────────────────────────────────────────────

export function Packing({ t }: { t: PlannedTripDetail }) {
  const refresh = useRefresh(t.id);
  const items = t.items.filter((i) => i.kind === "pack");
  const sections = [...new Set(items.map((i) => i.section ?? "Other"))];
  const [adding, setAdding] = useState<Record<string, string>>({});
  const [newSection, setNewSection] = useState("");
  const packed = items.filter((i) => i.done).length;

  async function toggle(i: TripItem) { await plansApi.updateTripItem(i.id, { done: !i.done }); refresh(); }
  async function remove(i: TripItem) { await plansApi.deleteTripItem(i.id); refresh(); }
  async function add(section: string) {
    const title = (adding[section] ?? "").trim();
    if (!title) return;
    await plansApi.addTripItem(t.id, { kind: "pack", title, section });
    setAdding({ ...adding, [section]: "" });
    refresh();
  }

  return (
    <div className="space-y-8">
      {items.length > 0 && (
        <div>
          <div className="flex justify-between text-xs text-[#71717A] mb-1"><span>{packed} of {items.length} packed</span>
            <span>{Math.round((packed / items.length) * 100)}%</span></div>
          <div className="h-1.5 bg-[#18181B] rounded-full"><div className="h-full rounded-full bg-[#F59E0B]" style={{ width: `${(packed / items.length) * 100}%` }} /></div>
        </div>
      )}
      {sections.map((s) => (
        <Block key={s} title={`${s} · ${items.filter((i) => (i.section ?? "Other") === s && i.done).length}/${items.filter((i) => (i.section ?? "Other") === s).length}`}>
          <Panel className="px-4 py-1">
            <div className="divide-y divide-[#18181B]">
              {items.filter((i) => (i.section ?? "Other") === s).map((i) => (
                <div key={i.id} className="flex items-center gap-3 py-2 group">
                  <button onClick={() => toggle(i)} aria-label={i.done ? "Unpack" : "Packed"}
                          className={`w-5 h-5 shrink-0 rounded-md border flex items-center justify-center ${i.done ? "bg-emerald-500/80 border-emerald-500" : "border-[#3F3F46]"}`}>
                    {i.done && <Check size={12} className="text-black" />}
                  </button>
                  <span className={`flex-1 text-sm ${i.done ? "text-[#52525B] line-through" : "text-[#FAFAFA]"}`}>{i.title}</span>
                  <button onClick={() => remove(i)} aria-label="Remove" className="text-[#3F3F46] hover:text-rose-400 sm:opacity-0 sm:group-hover:opacity-100"><X size={13} /></button>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3 py-2 border-t border-[#18181B]">
              <Plus size={14} className="text-[#52525B]" />
              <input value={adding[s] ?? ""} onChange={(e) => setAdding({ ...adding, [s]: e.target.value })}
                     onKeyDown={(e) => { if (e.key === "Enter") add(s); }} placeholder="Add…"
                     className="flex-1 bg-transparent text-sm text-[#FAFAFA] placeholder:text-[#3F3F46] outline-none py-1" />
            </div>
          </Panel>
        </Block>
      ))}
      <Panel className="p-3 space-y-2">
        <p className="text-[10px] uppercase tracking-widest text-[#52525B]">New section</p>
        <div className="grid grid-cols-2 gap-2">
          <input value={newSection} onChange={(e) => setNewSection(e.target.value)} placeholder="Section — e.g. Documents"
                 className={`${inputCls} py-1.5`} />
          <input value={adding["__new"] ?? ""} onChange={(e) => setAdding({ ...adding, __new: e.target.value })}
                 placeholder="First item" className={`${inputCls} py-1.5`}
                 onKeyDown={async (e) => {
                   const first = (adding["__new"] ?? "").trim();
                   if (e.key === "Enter" && newSection.trim() && first) {
                     await plansApi.addTripItem(t.id, { kind: "pack", title: first, section: newSection.trim() });
                     setNewSection(""); setAdding({ ...adding, __new: "" }); refresh();
                   }
                 }} />
        </div>
      </Panel>
    </div>
  );
}

// ── Budget ───────────────────────────────────────────────────────────────────

function Cell({ line, k, onSaved }: { line: BudgetLine; k: "low" | "mid" | "high" | "actual"; onSaved: () => void }) {
  const [v, setV] = useState(line[k] != null ? String(line[k]) : "");
  async function save() {
    const n = v.trim() ? Number(v.replace(/[,\s]/g, "")) : null;
    if (n === line[k]) return;
    await plansApi.updateBudgetLine(line.id, { [k]: n });
    onSaved();
  }
  return (
    <input value={v} onChange={(e) => setV(e.target.value)} onBlur={save} inputMode="decimal"
           onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
           className={`w-full bg-transparent text-right tabular-nums text-sm outline-none border-b border-transparent focus:border-[#27272A] ${
             k === "actual" ? "text-[#F59E0B]" : k === "mid" ? "text-[#FAFAFA]" : "text-[#71717A]"}`} />
  );
}

export function Budget({ t }: { t: PlannedTripDetail }) {
  const refresh = useRefresh(t.id);
  const m = money(t);
  const [line, setLine] = useState("");
  const cols = "grid grid-cols-[1fr_4rem_4.5rem_4rem_4.5rem_1rem] gap-2 items-center";
  const tot = t.budget_totals;
  const flights = t.flights_eur ?? 0;
  const allIn = (v: number) => (m.isEur ? v : v / (t.fx_rate || 1)) + flights;

  return (
    <div className="space-y-6">
      <Panel className="p-5">
        <div className="grid grid-cols-3 gap-4">
          {(["low", "mid", "high"] as const).map((k) => (
            <div key={k}>
              <Label>{k}{flights ? " · all-in" : ""}</Label>
              <p className={`text-2xl font-semibold tabular-nums ${k === "mid" ? "" : "text-[#A1A1AA]"}`}>€{Math.round(allIn(tot[k])).toLocaleString("en-GB")}</p>
              {!m.isEur && <p className="text-xs text-[#71717A] tabular-nums">{m.local(tot[k])} on the ground</p>}
            </div>
          ))}
        </div>
        {(tot.actual > 0 || flights > 0) && (
          <p className="text-xs text-[#71717A] mt-4 pt-3 border-t border-[#27272A]">
            {flights > 0 && <>Flights €{Math.round(flights)} · </>}
            {tot.actual > 0 && <>Spent so far <span className="text-[#F59E0B] tabular-nums">{m.local(tot.actual)}</span>{!m.isEur && ` (${m.eur(tot.actual)})`}</>}
            {!m.isEur && <> · €1 = {m.sym}{t.fx_rate}</>}
          </p>
        )}
      </Panel>

      <Panel className="px-4 py-2">
        <div className={`${cols} text-[10px] uppercase tracking-widest text-[#52525B] py-2`}>
          <span>{m.cur}</span><span className="text-right">Low</span><span className="text-right">Mid</span>
          <span className="text-right">High</span><span className="text-right">Actual</span><span />
        </div>
        <div className="divide-y divide-[#18181B]">
          {t.budget_lines.map((ln) => (
            <div key={ln.id} className={`${cols} py-2 group`}>
              <span className="text-sm text-[#D4D4D8] truncate" title={ln.line}>{ln.line}</span>
              {(["low", "mid", "high", "actual"] as const).map((k) => <Cell key={k} line={ln} k={k} onSaved={refresh} />)}
              <button onClick={async () => { await plansApi.deleteBudgetLine(ln.id); refresh(); }} aria-label="Remove line"
                      className="text-[#3F3F46] hover:text-rose-400 sm:opacity-0 sm:group-hover:opacity-100"><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
        <div className={`${cols} py-2 border-t border-[#27272A] text-sm font-semibold tabular-nums`}>
          <span>Total</span>
          {(["low", "mid", "high", "actual"] as const).map((k) => <span key={k} className="text-right">{Math.round(tot[k]).toLocaleString("en-GB")}</span>)}
          <span />
        </div>
        <div className="flex items-center gap-3 py-2 border-t border-[#18181B]">
          <Plus size={14} className="text-[#52525B]" />
          <input value={line} onChange={(e) => setLine(e.target.value)} placeholder="Add a line…"
                 onKeyDown={async (e) => {
                   if (e.key === "Enter" && line.trim()) {
                     await plansApi.addBudgetLine(t.id, { line: line.trim(), low: null, mid: null, high: null, actual: null });
                     setLine(""); refresh();
                   }
                 }}
                 className="flex-1 bg-transparent text-sm text-[#FAFAFA] placeholder:text-[#3F3F46] outline-none py-1" />
        </div>
      </Panel>
      {t.sleep_total > 0 && (
        <p className="text-xs text-[#52525B] px-1">Itinerary nights add up to {m.local(t.sleep_total)}{!m.isEur && ` (${m.eur(t.sleep_total)})`}.</p>
      )}
    </div>
  );
}

// ── Info ─────────────────────────────────────────────────────────────────────

export function Info({ t }: { t: PlannedTripDetail }) {
  const refresh = useRefresh(t.id);
  const items = t.items.filter((i) => i.kind === "info");
  const sections = [...new Set(items.map((i) => i.section ?? "Notes"))];
  const [draft, setDraft] = useState({ section: sections[0] ?? "Notes", title: "", detail: "" });

  return (
    <div className="space-y-8">
      {t.flights.length > 0 && (
        <Block title="Flights logged">
          <Panel className="px-4 py-1 divide-y divide-[#18181B]">
            {t.flights.map((f) => (
              <div key={f.id} className="flex items-center gap-3 py-2.5">
                <span className="shrink-0 w-16 text-xs text-[#71717A] tabular-nums">{format(parseISO(f.date), "EEE d MMM")}</span>
                <span className="flex-1 min-w-0 text-sm text-[#FAFAFA] font-mono">{f.origin ?? "—"} → {f.destination ?? "—"}
                  {f.flight_number && <span className="text-xs text-[#52525B] font-sans ml-2">{f.flight_number}</span>}</span>
                {f.dep_time && <span className="text-xs text-[#71717A] tabular-nums">{f.dep_time}{f.arr_time ? `–${f.arr_time}` : ""}</span>}
              </div>
            ))}
          </Panel>
        </Block>
      )}
      {sections.map((s) => (
        <Block key={s} title={s}>
          <Panel className="px-4 py-1 divide-y divide-[#18181B]">
            {items.filter((i) => (i.section ?? "Notes") === s).map((i) => (
              <div key={i.id} className="py-3 group">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-[#FAFAFA]">{i.title}</p>
                  <button onClick={async () => { await plansApi.deleteTripItem(i.id); refresh(); }} aria-label="Remove"
                          className="text-[#3F3F46] hover:text-rose-400 sm:opacity-0 sm:group-hover:opacity-100"><X size={13} /></button>
                </div>
                {i.detail && <p className="text-xs text-[#A1A1AA] mt-1 whitespace-pre-line select-text">{i.detail}</p>}
              </div>
            ))}
          </Panel>
        </Block>
      ))}
      <Panel className="p-3 space-y-2">
        <p className="text-[10px] uppercase tracking-widest text-[#52525B]">Add a note</p>
        <div className="grid grid-cols-2 gap-2">
          <input className={`${inputCls} py-1.5`} list="info-sections" value={draft.section} placeholder="Section"
                 onChange={(e) => setDraft({ ...draft, section: e.target.value })} />
          <datalist id="info-sections">{sections.map((s) => <option key={s} value={s} />)}</datalist>
          <input className={`${inputCls} py-1.5`} value={draft.title} placeholder="Title"
                 onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        </div>
        <textarea rows={2} className={`${inputCls} resize-none`} value={draft.detail} placeholder="Detail"
                  onChange={(e) => setDraft({ ...draft, detail: e.target.value })} />
        <button disabled={!draft.title.trim()} onClick={async () => {
          await plansApi.addTripItem(t.id, { kind: "info", section: draft.section.trim() || "Notes", title: draft.title.trim(), detail: draft.detail.trim() || null });
          setDraft({ ...draft, title: "", detail: "" }); refresh();
        }} className="text-xs font-medium text-[#F59E0B] disabled:text-[#3F3F46]">Add</button>
      </Panel>
      {t.notes && (
        <Block title="Notes"><Panel className="p-4 text-sm text-[#A1A1AA] whitespace-pre-line">{t.notes}</Panel></Block>
      )}
    </div>
  );
}
