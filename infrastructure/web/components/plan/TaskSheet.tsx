"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { plansApi, PLAN_KEYS, type Task, type TaskIn, type TaskKind, type TaskRepeat } from "@/lib/plans-api";
import { Sheet, Field, Chips, inputCls } from "./Sheet";
import { AREA_LIST, tint } from "./areas";

export function TaskSheet({ task, kind = "task", defaultDate, defaultArea, onClose }: {
  task?: Task;
  kind?: TaskKind;
  defaultDate?: string;
  defaultArea?: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    title: task?.title ?? "",
    notes: task?.notes ?? "",
    kind: task?.kind ?? kind,
    due_date: task?.due_date ?? defaultDate ?? "",
    repeat: (task?.repeat ?? null) as TaskRepeat | null,
    remind_days: task?.remind_days ?? null,
    area: (task?.area ?? defaultArea ?? null) as string | null,
    goal_id: task?.goal_id ?? null,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const year = new Date().getFullYear();
  const { data: goals = [] } = useQuery({
    queryKey: ["goals", year],
    queryFn: () => plansApi.goals(year),
    staleTime: 60_000,
  });
  const liveGoals = goals.filter((g) => g.status === "active");
  const isNote = f.kind === "note";

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      PLAN_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [...k] }));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  function save() {
    if (!f.title.trim()) return;
    const body: TaskIn = {
      title: f.title.trim(),
      notes: f.notes.trim() || null,
      kind: f.kind,
      due_date: f.due_date || null,
      repeat: f.due_date && !isNote ? f.repeat : null,
      remind_days: f.due_date && !isNote ? f.remind_days : null,
      area: f.area,
      goal_id: f.goal_id,
    };
    run(() => (task ? plansApi.updateTask(task.id, body) : plansApi.createTask(body)));
  }

  return (
    <Sheet title={task ? (isNote ? "Edit note" : "Edit task") : isNote ? "Note for later" : "New task"} onClose={onClose}>
      <Chips value={f.kind} onChange={(v) => setF({ ...f, kind: v })}
             options={[{ value: "task", label: "Task" }, { value: "note", label: "Note to resurface" }]} />

      <input className={inputCls} placeholder={isNote ? "Re-read the PARA notes" : "Renew DNI"} autoFocus={!task}
             value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })}
             onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } }} />

      <textarea rows={isNote ? 4 : 2} className={`${inputCls} resize-none`}
                placeholder={isNote ? "The thought, link or context you want back later" : "Details (optional)"}
                value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />

      <Field label={isNote ? "Bring it back on" : "Due (leave empty for the inbox)"}>
        <input type="date" className={inputCls} value={f.due_date}
               onChange={(e) => setF({ ...f, due_date: e.target.value })} />
      </Field>

      {f.due_date && !isNote && (
        <>
          <Field label="Repeat">
            <Chips value={f.repeat} onChange={(v) => setF({ ...f, repeat: v })}
                   options={[{ value: null, label: "Never" }, { value: "weekly", label: "Weekly" },
                             { value: "monthly", label: "Monthly" }, { value: "yearly", label: "Yearly" }]} />
          </Field>
          <Field label="Heads-up before the date">
            <Chips value={f.remind_days} onChange={(v) => setF({ ...f, remind_days: v })}
                   options={[{ value: null, label: "None" }, { value: 3, label: "3 days" }, { value: 7, label: "1 week" },
                             { value: 14, label: "2 weeks" }, { value: 30, label: "1 month" }]} />
          </Field>
        </>
      )}

      <Field label="Area — also shows it on that page">
        <div className="flex flex-wrap gap-1.5">
          {AREA_LIST.map((a) => {
            const on = f.area === a.key;
            return (
              <button key={a.key} type="button" onClick={() => setF({ ...f, area: on ? null : a.key })}
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

      {liveGoals.length > 0 && (
        <Field label="Towards a goal">
          <select className={inputCls} value={f.goal_id ?? ""}
                  onChange={(e) => setF({ ...f, goal_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">—</option>
            {liveGoals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
          </select>
        </Field>
      )}

      {error && <p className="text-rose-400 text-xs">{error}</p>}

      <button onClick={save} disabled={busy || !f.title.trim()}
              className="w-full bg-[#F59E0B] text-black font-semibold rounded-xl py-3 text-sm disabled:opacity-40">
        {busy ? "Saving…" : task ? "Save" : "Add"}
      </button>

      {task && (
        <div className="flex justify-end text-xs">
          <button disabled={busy}
                  onClick={() => confirm(`Delete “${task.title}”?`) && run(() => plansApi.deleteTask(task.id))}
                  className="text-rose-400/80 hover:text-rose-400">Delete</button>
        </div>
      )}
    </Sheet>
  );
}
