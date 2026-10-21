"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { tagsApi } from "@/lib/tags-api";
import { plansApi, PLAN_KEYS, type Goal, type GoalIn, type Metric } from "@/lib/plans-api";
import { Sheet, Field, Chips, inputCls } from "./Sheet";
import { AREA_LIST, area as areaOf, goalIcon, tint, type AreaKey } from "./areas";
import { fmtTime, parseTime } from "./format";

const DISTANCES = [
  { value: "5000", label: "5 k" }, { value: "10000", label: "10 k" },
  { value: "21097", label: "Half" }, { value: "42195", label: "Marathon" },
];

const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));

export function GoalSheet({ goal, year, onClose }: { goal?: Goal; year: number; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: meta } = useQuery({ queryKey: ["goals", "meta"], queryFn: () => plansApi.goalsMeta(), staleTime: 3600_000 });
  const metrics = useMemo(() => meta?.metrics ?? [], [meta]);

  const [f, setF] = useState({
    emoji: goal?.emoji ?? "",
    title: goal?.title ?? "",
    metric: goal?.metric ?? "manual",
    metric_param: goal?.metric_param ?? "",
    target: goal?.target == null ? "" : goal.metric === "best_time" ? fmtTime(goal.target) : String(goal.target),
    baseline: goal?.baseline?.toString() ?? "",
    current: goal?.current?.toString() ?? "",
    area: (goal?.area ?? null) as string | null,          // null → the metric's area
    start_date: goal?.start_date ?? `${year}-01-01`,
    deadline: goal?.deadline ?? `${year}-12-31`,
    priority: (goal?.priority ?? 2) as 1 | 2 | 3,
    notes: goal?.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const m: Metric | undefined = metrics.find((x) => x.key === f.metric);
  const effectiveArea = areaOf(f.area ?? m?.area);
  const Icon = goalIcon(f.metric, effectiveArea.key);

  const { data: tags = [] } = useQuery({
    queryKey: ["tags"], queryFn: () => tagsApi.list(), staleTime: 300_000, enabled: m?.param === "tag",
  });
  const { data: contacts = [] } = useQuery({
    queryKey: ["contacts"], queryFn: () => api.contacts(), staleTime: 300_000, enabled: m?.param === "contact",
  });
  const negativeTag = m?.param === "tag" && tags.find((t) => t.slug === f.metric_param)?.is_negative;

  const grouped = useMemo(() => {
    const by = new Map<string, Metric[]>();
    for (const x of metrics) by.set(x.area, [...(by.get(x.area) ?? []), x]);
    return [...by.entries()];
  }, [metrics]);

  const refresh = () => PLAN_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [...k] }));

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  function body(): GoalIn {
    return {
      title: f.title.trim(),
      emoji: f.emoji || null,                // kept as stored; the card shows the metric's icon
      metric: f.metric,
      metric_param: m?.param ? f.metric_param || null : null,
      target: f.metric === "best_time" ? parseTime(f.target) : num(f.target),
      baseline: m?.kind === "level" ? num(f.baseline) : null,
      current: f.metric === "manual" ? num(f.current) : null,
      area: f.area,
      start_date: f.start_date,
      deadline: f.deadline || null,
      priority: f.priority,
      notes: f.notes.trim() || null,
    };
  }

  function save() {
    if (!f.title.trim()) return;
    run(() => (goal ? plansApi.updateGoal(goal.id, body()) : plansApi.createGoal(body())));
  }

  function repeatNextYear() {
    if (!goal) return;
    const shift = (d: string | null) => (d ? `${Number(d.slice(0, 4)) + 1}${d.slice(4)}` : null);
    const y = goal.start_date.slice(0, 4);
    run(() => plansApi.createGoal({
      ...body(),
      title: goal.title.replace(y, String(Number(y) + 1)),
      start_date: shift(goal.start_date)!,
      deadline: shift(goal.deadline),
      current: null,
      baseline: null,
    }));
  }

  const targetLabel = negativeTag ? "Max days (optional)"
    : m?.kind === "streak" ? "Days in a row"
    : m?.kind === "manual" ? "Target (optional)"
    : "Target";
  const unit = f.metric === "best_time" ? "mm:ss" : m?.unit ?? "";
  const needsParam = m?.param && !f.metric_param;

  return (
    <Sheet title={goal ? "Edit goal" : "New goal"} onClose={onClose}>
      {/* Icon (follows what the goal measures) + title */}
      <div className="flex items-center gap-2.5">
        <span className="shrink-0 w-12 h-12 rounded-xl flex items-center justify-center"
              style={{ background: tint(effectiveArea.color, 0.14), color: effectiveArea.color }}>
          <Icon size={22} strokeWidth={1.75} />
        </span>
        <input
          className={`${inputCls} flex-1 min-w-0 h-12 text-base`}
          placeholder="Cycle 4000 km"
          autoFocus={!goal}
          value={f.title}
          onChange={(e) => setF({ ...f, title: e.target.value })}
        />
      </div>

      <Field label="Progress counts from">
        <select className={inputCls} value={f.metric}
                onChange={(e) => setF({ ...f, metric: e.target.value, metric_param: "", target: "", baseline: "" })}>
          {grouped.map(([a, list]) => (
            <optgroup key={a} label={areaOf(a).label}>
              {list.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </optgroup>
          ))}
        </select>
        {m && <span className="text-[11px] text-[#52525B] mt-1 block">{m.hint}</span>}
      </Field>

      {m?.param === "tag" && (
        <Field label="Tag">
          <select className={inputCls} value={f.metric_param} onChange={(e) => setF({ ...f, metric_param: e.target.value })}>
            <option value="">Choose a tag…</option>
            {tags.map((t) => (
              <option key={t.slug} value={t.slug}>
                {t.icon ? `${t.icon} ` : ""}{t.name}{t.is_negative ? " — fewer is better" : ""}
              </option>
            ))}
          </select>
        </Field>
      )}
      {m?.param === "contact" && (
        <Field label="Person">
          <select className={inputCls} value={f.metric_param} onChange={(e) => setF({ ...f, metric_param: e.target.value })}>
            <option value="">Choose someone…</option>
            {contacts.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
          </select>
        </Field>
      )}
      {m?.param === "distance" && (
        <Field label="Distance">
          <Chips value={f.metric_param} onChange={(v) => setF({ ...f, metric_param: v })} options={DISTANCES} />
        </Field>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label={targetLabel}>
          <div className="relative">
            <input
              inputMode={f.metric === "best_time" ? "text" : "decimal"}
              className={`${inputCls} pr-14`}
              value={f.target}
              placeholder={negativeTag ? "vs last year" : f.metric === "best_time" ? "40:00" : ""}
              onChange={(e) => setF({ ...f, target: e.target.value })}
            />
            {unit && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#52525B] pointer-events-none">{unit}</span>}
          </div>
        </Field>
        {m?.kind === "level" && (
          <Field label={f.metric === "net_worth" ? "Value at the start" : "Start value (auto)"}>
            <input inputMode="decimal" className={inputCls} value={f.baseline}
                   placeholder={f.metric === "net_worth" ? "for the pace" : "first logged"}
                   onChange={(e) => setF({ ...f, baseline: e.target.value })} />
          </Field>
        )}
        {f.metric === "manual" && (
          <Field label="Where you are">
            <input inputMode="decimal" className={inputCls} value={f.current}
                   onChange={(e) => setF({ ...f, current: e.target.value })} />
          </Field>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="From">
          <input type="date" className={inputCls} value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} />
        </Field>
        <Field label="Deadline">
          <input type="date" className={inputCls} value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} />
        </Field>
      </div>

      <Field label="Area">
        <div className="flex flex-wrap gap-1.5">
          {AREA_LIST.map((a) => {
            const on = effectiveArea.key === a.key;
            return (
              <button key={a.key} type="button"
                      onClick={() => setF({ ...f, area: a.key === m?.area ? null : (a.key as AreaKey) })}
                      className="px-2.5 py-1 rounded-full text-xs transition-colors border"
                      style={on ? { background: tint(a.color, 0.2), borderColor: a.color, color: a.color }
                                : { borderColor: "transparent" }}>
                <span className={`inline-flex items-center gap-1.5 ${on ? "" : "text-[#71717A]"}`}>
                  <a.icon size={13} strokeWidth={1.75} /> {a.label}
                </span>
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="Importance">
        <Chips value={f.priority} onChange={(v) => setF({ ...f, priority: v })}
               options={[{ value: 1, label: "Moderate" }, { value: 2, label: "Important" }, { value: 3, label: "Very important" }]} />
      </Field>

      <Field label="Notes">
        <textarea rows={2} className={`${inputCls} resize-none`} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </Field>

      {error && <p className="text-rose-400 text-xs">{error}</p>}

      <button onClick={save} disabled={busy || !f.title.trim() || !!needsParam}
              className="w-full bg-[#F59E0B] text-black font-semibold rounded-xl py-3 text-sm disabled:opacity-40">
        {busy ? "Saving…" : goal ? "Save" : "Add goal"}
      </button>

      {goal && (
        <div className="flex items-center justify-between gap-3 text-xs pt-1 flex-wrap">
          <div className="flex gap-3">
            {goal.status === "active" ? (
              <>
                <button disabled={busy} onClick={() => run(() => plansApi.updateGoal(goal.id, { status: "done" }))}
                        className="text-emerald-400">Mark done</button>
                <button disabled={busy} onClick={() => run(() => plansApi.updateGoal(goal.id, { status: "dropped" }))}
                        className="text-[#71717A] hover:text-[#A1A1AA]">Drop</button>
              </>
            ) : (
              <button disabled={busy} onClick={() => run(() => plansApi.updateGoal(goal.id, { status: "active" }))}
                      className="text-[#A1A1AA] hover:text-[#FAFAFA]">Reopen</button>
            )}
            <button disabled={busy} onClick={repeatNextYear} className="text-[#A1A1AA] hover:text-[#FAFAFA]">
              ↻ Repeat in {Number(goal.start_date.slice(0, 4)) + 1}
            </button>
          </div>
          <button disabled={busy}
                  onClick={() => confirm(`Delete “${goal.title}”?`) && run(() => plansApi.deleteGoal(goal.id))}
                  className="text-rose-400/80 hover:text-rose-400">Delete</button>
        </div>
      )}
    </Sheet>
  );
}
