"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Chips, Field, Sheet, inputCls } from "@/components/plan/Sheet";
import {
  learningApi, LEARNING_KEYS, KIND_LABEL, TIER_LABEL,
  type LearningItem, type LearningItemStatus, type LearningKind, type LearningPhase,
  type LearningPlan, type LearningPlanDetail, type LearningTier,
} from "@/lib/learning-api";

const KINDS = Object.entries(KIND_LABEL).map(([value, label]) => ({ value: value as LearningKind, label }));
const TIERS = Object.entries(TIER_LABEL).map(([value, label]) => ({ value: value as LearningTier, label }));
const STATUSES: { value: LearningItemStatus; label: string }[] = [
  { value: "todo", label: "To do" }, { value: "done", label: "Done" }, { value: "skipped", label: "Dropped" },
];
const num = (s: string) => (s.trim() === "" ? null : Number(s));

/** Add or edit one roadmap item — move it to another week, park it as Later, drop it. */
export function ItemSheet({ planId, item, phase, onClose }: {
  planId: number;
  item?: LearningItem;
  phase?: LearningPhase;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(item?.title ?? "");
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [resource, setResource] = useState(item?.resource ?? "");
  const [url, setUrl] = useState(item?.url ?? "");
  const [week, setWeek] = useState(String(item ? item.week ?? "" : phase?.week_from ?? ""));
  const [weeks, setWeeks] = useState(String(item?.weeks ?? 1));
  const [est, setEst] = useState(String(item?.est_hours ?? ""));
  const [kind, setKind] = useState<LearningKind>(item?.kind ?? "learn");
  const [tier, setTier] = useState<LearningTier>(item?.tier ?? "core");
  const [status, setStatus] = useState<LearningItemStatus>(item?.status ?? "todo");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const done = () => { LEARNING_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [...k] })); onClose(); };

  async function save() {
    if (!title.trim()) return;
    setSaving(true);
    setErr(null);
    const body = {
      title: title.trim(), notes: notes.trim() || null, resource: resource.trim() || null, url: url.trim() || null,
      week: num(week), weeks: num(weeks) ?? 1, est_hours: num(est), kind, tier,
    };
    try {
      if (item) {
        await learningApi.updateItem(item.id, status !== item.status ? { ...body, status } : body);
      } else {
        await learningApi.createItem({ ...body, plan_id: planId, phase_id: phase?.id ?? null });
      }
      done();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!item || !confirm(`Delete “${item.title}”?`)) return;
    await learningApi.deleteItem(item.id);
    done();
  }

  return (
    <Sheet title={item ? "Edit item" : `Add to ${phase?.title.split("·")[0].trim() ?? "plan"}`} onClose={onClose}>
      <Field label="What">
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} autoFocus={!item} />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Week"><input value={week} onChange={(e) => setWeek(e.target.value)} inputMode="numeric" placeholder="any" className={inputCls} /></Field>
        <Field label="For (weeks)"><input value={weeks} onChange={(e) => setWeeks(e.target.value)} inputMode="numeric" className={inputCls} /></Field>
        <Field label="Est. hours"><input value={est} onChange={(e) => setEst(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
      </div>
      <Field label="Tier"><Chips value={tier} options={TIERS} onChange={setTier} /></Field>
      <Field label="Kind"><Chips value={kind} options={KINDS} onChange={setKind} /></Field>
      {item && <Field label="Status"><Chips value={status} options={STATUSES} onChange={setStatus} /></Field>}
      <Field label="Resource"><input value={resource} onChange={(e) => setResource(e.target.value)} placeholder="McWhorter, Onshape pathways…" className={inputCls} /></Field>
      <Field label="Link"><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" className={inputCls} /></Field>
      {item?.url && (
        <a href={item.url} target="_blank" rel="noreferrer" className="block text-xs text-[#F59E0B] truncate -mt-2">{item.url}</a>
      )}
      <Field label="Notes"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={inputCls} /></Field>
      {err && <p className="text-xs text-rose-400">{err}</p>}
      <div className="flex items-center gap-3 pt-1">
        {item && <button onClick={remove} className="text-xs text-rose-400 hover:text-rose-300">Delete</button>}
        <button onClick={save} disabled={saving || !title.trim()}
                className="ml-auto px-4 py-2 rounded-lg bg-[#F59E0B] text-black text-sm font-medium disabled:opacity-40">
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </Sheet>
  );
}

const PLAN_STATUSES: { value: LearningPlan["status"]; label: string }[] = [
  { value: "active", label: "Active" }, { value: "paused", label: "Paused" }, { value: "done", label: "Done" },
];

/** Start week, weekly hours target, pause. Paused plans leave Today. */
export function PlanSheet({ d, onClose }: { d: LearningPlanDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const [start, setStart] = useState(d.plan.start_date);
  const [hours, setHours] = useState(String(d.plan.weekly_hours ?? ""));
  const [status, setStatus] = useState(d.plan.status);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await learningApi.updatePlan(d.plan.id, { start_date: start, weekly_hours: num(hours), status });
      LEARNING_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [...k] }));
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet title={`${d.plan.emoji ?? ""} ${d.plan.title}`.trim()} onClose={onClose}>
      <Field label="Week 1 starts (moved to its Monday)">
        <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={inputCls} />
      </Field>
      <Field label="Hours per week (target)">
        <input value={hours} onChange={(e) => setHours(e.target.value)} inputMode="decimal" className={inputCls} />
      </Field>
      <Field label="Status"><Chips value={status} options={PLAN_STATUSES} onChange={setStatus} /></Field>
      <p className="text-xs text-[#52525B]">Moving the start shifts every week; items keep their week numbers.</p>
      <div className="flex pt-1">
        <button onClick={save} disabled={saving}
                className="ml-auto px-4 py-2 rounded-lg bg-[#F59E0B] text-black text-sm font-medium disabled:opacity-40">
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </Sheet>
  );
}
