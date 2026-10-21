"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { tagsApi } from "@/lib/tags-api";
import { plansApi, PLAN_KEYS, METRIC_LABEL, type Goal, type GoalIn, type GoalMetric } from "@/lib/plans-api";
import { Sheet, Field, Chips, inputCls } from "./Sheet";

const METRIC_HINT: Record<GoalMetric, string> = {
  manual: "Ticked off by hand — optionally type a number as you go.",
  run_km: "Counted from your runs (Garmin / Strava).",
  ride_km: "Counted from your rides (Garmin / Strava).",
  swim_km: "Counted from your swims.",
  books: "Books with a finished date in the period.",
  net_worth: "Money → total net worth. Set a starting value to get a pace.",
  tag_days: "Days tagged. Negative tags (candy, alcohol) are a ceiling — without a target it's fewer than last year.",
};

const num = (s: string) => (s.trim() === "" ? null : Number(s));

export function GoalSheet({ goal, year, onClose }: { goal?: Goal; year: number; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    emoji: goal?.emoji ?? "",
    title: goal?.title ?? "",
    metric: (goal?.metric ?? "manual") as GoalMetric,
    metric_param: goal?.metric_param ?? "",
    target: goal?.target?.toString() ?? "",
    baseline: goal?.baseline?.toString() ?? "",
    current: goal?.current?.toString() ?? "",
    start_date: goal?.start_date ?? `${year}-01-01`,
    deadline: goal?.deadline ?? `${year}-12-31`,
    priority: (goal?.priority ?? 2) as 1 | 2 | 3,
    area: goal?.area ?? "",
    notes: goal?.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: tags = [] } = useQuery({
    queryKey: ["tags"],
    queryFn: () => tagsApi.list(),
    staleTime: 5 * 60 * 1000,
    enabled: f.metric === "tag_days",
  });

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

  function save() {
    if (!f.title.trim()) return;
    const body: GoalIn = {
      title: f.title.trim(),
      emoji: f.emoji.trim() || null,
      metric: f.metric,
      metric_param: f.metric === "tag_days" ? f.metric_param || null : null,
      target: num(f.target),
      baseline: f.metric === "net_worth" ? num(f.baseline) : null,
      current: f.metric === "manual" ? num(f.current) : null,
      start_date: f.start_date,
      deadline: f.deadline || null,
      priority: f.priority,
      area: f.area.trim() || null,
      notes: f.notes.trim() || null,
    };
    run(() => (goal ? plansApi.updateGoal(goal.id, body) : plansApi.createGoal(body)));
  }

  const selectedTag = tags.find((t) => t.slug === f.metric_param);

  return (
    <Sheet title={goal ? "Edit goal" : "New goal"} onClose={onClose}>
      <div className="flex gap-2">
        <input className={`${inputCls} w-14 text-center`} placeholder="🎯" maxLength={4}
               value={f.emoji} onChange={(e) => setF({ ...f, emoji: e.target.value })} />
        <input className={inputCls} placeholder="4000 km on the bike" autoFocus={!goal}
               value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      </div>

      <Field label="Progress from">
        <select className={inputCls} value={f.metric}
                onChange={(e) => setF({ ...f, metric: e.target.value as GoalMetric })}>
          {(Object.keys(METRIC_LABEL) as GoalMetric[]).map((m) => (
            <option key={m} value={m}>{METRIC_LABEL[m]}</option>
          ))}
        </select>
        <span className="text-[11px] text-[#52525B] mt-1 block">{METRIC_HINT[f.metric]}</span>
      </Field>

      {f.metric === "tag_days" && (
        <Field label="Tag">
          <select className={inputCls} value={f.metric_param}
                  onChange={(e) => setF({ ...f, metric_param: e.target.value })}>
            <option value="">Choose a tag…</option>
            {tags.map((t) => (
              <option key={t.slug} value={t.slug}>
                {t.icon ? `${t.icon} ` : ""}{t.name}{t.is_negative ? " (fewer is better)" : ""}
              </option>
            ))}
          </select>
        </Field>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label={selectedTag?.is_negative ? "Max days (optional)" : f.metric === "manual" ? "Target (optional)" : "Target"}>
          <input type="number" inputMode="decimal" className={inputCls} value={f.target}
                 placeholder={selectedTag?.is_negative ? "vs last year" : ""}
                 onChange={(e) => setF({ ...f, target: e.target.value })} />
        </Field>
        {f.metric === "net_worth" && (
          <Field label={`Net worth on ${f.start_date.slice(5)}`}>
            <input type="number" inputMode="decimal" className={inputCls} value={f.baseline}
                   onChange={(e) => setF({ ...f, baseline: e.target.value })} />
          </Field>
        )}
        {f.metric === "manual" && (
          <Field label="Current">
            <input type="number" inputMode="decimal" className={inputCls} value={f.current}
                   onChange={(e) => setF({ ...f, current: e.target.value })} />
          </Field>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="From">
          <input type="date" className={inputCls} value={f.start_date}
                 onChange={(e) => setF({ ...f, start_date: e.target.value })} />
        </Field>
        <Field label="Deadline">
          <input type="date" className={inputCls} value={f.deadline}
                 onChange={(e) => setF({ ...f, deadline: e.target.value })} />
        </Field>
      </div>

      <Field label="Importance">
        <Chips value={f.priority} onChange={(v) => setF({ ...f, priority: v })}
               options={[{ value: 1, label: "Moderate" }, { value: 2, label: "Important" }, { value: 3, label: "Very important" }]} />
      </Field>

      <Field label="Notes">
        <textarea rows={2} className={`${inputCls} resize-none`} value={f.notes}
                  onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </Field>

      {error && <p className="text-red-400 text-xs">{error}</p>}

      <button onClick={save} disabled={busy || !f.title.trim() || (f.metric === "tag_days" && !f.metric_param)}
              className="w-full bg-[#F59E0B] text-black font-semibold rounded-xl py-3 text-sm disabled:opacity-40">
        {busy ? "Saving…" : goal ? "Save" : "Add goal"}
      </button>

      {goal && (
        <div className="flex items-center justify-between text-xs pt-1">
          <div className="flex gap-3">
            {goal.status === "active" ? (
              <>
                <button disabled={busy} onClick={() => run(() => plansApi.updateGoal(goal.id, { status: "done" }))}
                        className="text-emerald-400 hover:text-emerald-300">Mark done</button>
                <button disabled={busy} onClick={() => run(() => plansApi.updateGoal(goal.id, { status: "dropped" }))}
                        className="text-[#71717A] hover:text-[#A1A1AA]">Drop</button>
              </>
            ) : (
              <button disabled={busy} onClick={() => run(() => plansApi.updateGoal(goal.id, { status: "active" }))}
                      className="text-[#A1A1AA] hover:text-[#FAFAFA]">Reopen</button>
            )}
          </div>
          <button disabled={busy}
                  onClick={() => confirm(`Delete “${goal.title}”?`) && run(() => plansApi.deleteGoal(goal.id))}
                  className="text-red-400/80 hover:text-red-400">Delete</button>
        </div>
      )}
    </Sheet>
  );
}
