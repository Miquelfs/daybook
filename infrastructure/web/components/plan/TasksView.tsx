"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, differenceInCalendarDays, format, nextMonday, nextSaturday, parseISO } from "date-fns";
import { Check, ChevronDown, ChevronUp, CornerDownLeft, StickyNote } from "lucide-react";
import { plansApi, PLAN_KEYS, type Task, type TaskKind } from "@/lib/plans-api";
import { localISODate } from "@/lib/dates";
import { TaskRow } from "./TaskRow";
import { Block, Panel, Pill } from "./ui";
import { AREA_LIST, AREAS_WITH_PANEL, area as areaOf } from "./areas";

type When = "today" | "tomorrow" | "weekend" | "next_week" | "someday" | "date";
const WHEN: { key: When; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "weekend", label: "Weekend" },
  { key: "next_week", label: "Next week" },
  { key: "someday", label: "Someday" },
  { key: "date", label: "Pick a date" },
];

function whenToDate(w: When, today: string, picked: string): string | null {
  const t = parseISO(today);
  const iso = (d: Date) => format(d, "yyyy-MM-dd");
  switch (w) {
    case "today": return today;
    case "tomorrow": return iso(addDays(t, 1));
    case "weekend": return t.getDay() === 6 || t.getDay() === 0 ? today : iso(nextSaturday(t));
    case "next_week": return iso(nextMonday(t));
    case "date": return picked || null;
    default: return null;
  }
}

function refresh(qc: ReturnType<typeof useQueryClient>) {
  PLAN_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [...k] }));
}

/** Type, pick when + area, Enter. The sheet is still there for repeats, heads-ups and notes. */
function Composer({ kind, today, onMore }: { kind: TaskKind; today: string; onMore: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState<When>(kind === "note" ? "next_week" : "today");
  const [areaKey, setAreaKey] = useState<string | null>(null);
  const [picked, setPicked] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await plansApi.createTask({ title: title.trim(), kind, due_date: whenToDate(when, today, picked), area: areaKey });
      setTitle("");
      refresh(qc);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className="p-3 space-y-3">
      <div className="flex items-center gap-2">
        <input value={title} onChange={(e) => setTitle(e.target.value)}
               onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
               placeholder={kind === "note" ? "A thought to bring back later…" : "Add a task…"}
               className="flex-1 min-w-0 bg-transparent px-1 py-1.5 text-[15px] text-[#FAFAFA] placeholder:text-[#3F3F46] outline-none" />
        <button onClick={add} disabled={busy || !title.trim() || (when === "date" && !picked)} aria-label="Add"
                className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center bg-[#F59E0B] text-black disabled:bg-[#18181B] disabled:text-[#3F3F46] transition-colors">
          <CornerDownLeft size={15} />
        </button>
      </div>
      <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] -mx-1 px-1">
        {WHEN.map((w) => (
          <Pill key={w.key} on={when === w.key} onClick={() => setWhen(w.key)}>
            {w.key === "someday" && kind === "note" ? "No date"
              : w.key === "date" && picked ? format(parseISO(picked), "EEE d MMM") : w.label}
          </Pill>
        ))}
      </div>
      {when === "date" && (
        <input type="date" value={picked} min={today} onChange={(e) => setPicked(e.target.value)} autoFocus
               className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B]" />
      )}
      <div className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] -mx-1 px-1">
        {AREA_LIST.map((a) => (
          <button key={a.key} type="button" title={a.label} aria-label={a.label}
                  onClick={() => setAreaKey(areaKey === a.key ? null : a.key)}
                  className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center border transition-colors ${
                    areaKey === a.key ? "border-[#F59E0B] text-[#F59E0B] bg-[#F59E0B]/10" : "border-[#27272A] text-[#52525B] hover:text-[#A1A1AA]"}`}>
            <a.icon size={14} strokeWidth={1.75} />
          </button>
        ))}
        <button onClick={onMore} className="shrink-0 ml-1 text-xs text-[#52525B] hover:text-[#A1A1AA] whitespace-nowrap">More…</button>
      </div>
      {areaKey && (
        <p className="text-[11px] text-[#52525B] px-1 -mt-1">
          {areaOf(areaKey).label}{AREAS_WITH_PANEL.has(areaOf(areaKey).key) ? " — it'll also show on that page." : ""}
        </p>
      )}
    </Panel>
  );
}

function Count({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div>
      <p className="text-[10px] text-[#52525B] uppercase tracking-widest">{label}</p>
      <p className={`text-2xl font-semibold tabular-nums ${value ? tone ?? "" : "text-[#3F3F46]"}`}>{value}</p>
    </div>
  );
}

/** Tasks as a timeline: overdue, today (with what you already ticked off), each day this week, later, someday. */
function TaskTimeline({ today, onEdit }: { today: string; onEdit: (t: Task) => void }) {
  const [showDone, setShowDone] = useState(false);
  const { data: open = [] } = useQuery({
    queryKey: ["tasks", "open", "task"], queryFn: () => plansApi.tasks({ status: "open", kind: "task" }), staleTime: 0,
  });
  const { data: doneToday = [] } = useQuery({
    queryKey: ["tasks", "done_on", today], queryFn: () => plansApi.tasks({ done_on: today }),
  });
  const { data: done = [] } = useQuery({
    queryKey: ["tasks", "done", "task"], queryFn: () => plansApi.tasks({ status: "done", kind: "task" }), enabled: showDone,
  });

  const groups = useMemo(() => {
    const t = parseISO(today);
    const out: { key: string; title: string; sub?: string; tone?: "warn"; tasks: Task[] }[] = [];
    const days = (d: string) => differenceInCalendarDays(parseISO(d), t);
    const dated = open.filter((x) => x.due_date).sort((a, b) => a.due_date!.localeCompare(b.due_date!));
    out.push({ key: "overdue", title: "Overdue", tone: "warn", tasks: dated.filter((x) => days(x.due_date!) < 0) });
    out.push({ key: "today", title: "Today", sub: format(t, "EEE d MMM"), tasks: dated.filter((x) => days(x.due_date!) === 0) });
    for (let i = 1; i <= 6; i++) {
      const d = addDays(t, i);
      out.push({
        key: `d${i}`, title: i === 1 ? "Tomorrow" : format(d, "EEEE"), sub: format(d, "d MMM"),
        tasks: dated.filter((x) => days(x.due_date!) === i),
      });
    }
    out.push({ key: "later", title: "Later", tasks: dated.filter((x) => days(x.due_date!) > 6) });
    out.push({ key: "someday", title: "Someday", sub: "no date yet", tasks: open.filter((x) => !x.due_date) });
    return out;
  }, [open, today]);

  const n = (k: string) => groups.find((g) => g.key === k)!.tasks.length;
  const week = groups.filter((g) => g.key.startsWith("d")).reduce((s, g) => s + g.tasks.length, 0);
  const doneTasks = doneToday.filter((x) => x.kind === "task");

  return (
    <div className="space-y-8">
      <Panel className="px-5 py-4">
        <div className="grid grid-cols-4 gap-3">
          <Count label="Overdue" value={n("overdue")} tone="text-rose-400" />
          <Count label="Today" value={n("today")} tone="text-[#F59E0B]" />
          <Count label="This week" value={week} />
          <Count label="Someday" value={n("someday")} />
        </div>
        {doneTasks.length > 0 && (
          <p className="text-xs text-emerald-400 mt-3 pt-3 border-t border-[#27272A]">
            <Check size={12} className="inline -mt-0.5 mr-1" />{doneTasks.length} done today
          </p>
        )}
      </Panel>

      {open.length === 0 && doneTasks.length === 0 && (
        <div className="border border-dashed border-[#27272A] rounded-2xl px-6 py-10 text-center text-sm text-[#71717A]">
          Nothing open. Add something above.
        </div>
      )}

      {groups.map((g) => {
        const extra = g.key === "today" ? doneTasks : [];
        if (g.tasks.length === 0 && extra.length === 0) return null;
        return (
          <Block key={g.key} tone={g.tone} title={
            <span>{g.title}{g.sub && <span className="normal-case tracking-normal text-[#3F3F46]"> · {g.sub}</span>}</span>
          }>
            <Panel className={`px-4 py-1 divide-y divide-[#18181B] ${g.tone ? "border-rose-500/30" : ""}`}>
              {g.tasks.map((x) => <TaskRow key={x.id} task={x} today={today} onEdit={onEdit} />)}
              {extra.map((x) => <TaskRow key={`d${x.id}`} task={x} today={today} onEdit={onEdit} />)}
            </Panel>
          </Block>
        );
      })}

      <div>
        <button onClick={() => setShowDone((v) => !v)}
                className="inline-flex items-center gap-1 text-xs text-[#52525B] uppercase tracking-widest hover:text-[#A1A1AA]">
          {showDone ? <ChevronUp size={12} /> : <ChevronDown size={12} />} Done
        </button>
        {showDone && (
          <Panel className="px-4 py-1 mt-2 divide-y divide-[#18181B]">
            {done.slice(0, 50).map((x) => <TaskRow key={x.id} task={x} today={today} onEdit={onEdit} />)}
            {done.length === 0 && <p className="text-xs text-[#3F3F46] py-3">Nothing yet</p>}
          </Panel>
        )}
      </div>
    </div>
  );
}

/** Notes as cards: the thought, and when it comes back. Tick to dismiss. */
function NoteCards({ today, onEdit }: { today: string; onEdit: (t: Task) => void }) {
  const qc = useQueryClient();
  const { data: notes = [] } = useQuery({
    queryKey: ["tasks", "open", "note"], queryFn: () => plansApi.tasks({ status: "open", kind: "note" }), staleTime: 0,
  });
  const back = notes.filter((x) => x.due_date && x.due_date <= today);
  const later = notes.filter((x) => !x.due_date || x.due_date > today);

  async function dismiss(t: Task) {
    await plansApi.completeTask(t.id, today);
    refresh(qc);
  }

  const card = (t: Task, now: boolean) => {
    const a = t.area ? areaOf(t.area) : null;
    return (
      <div key={t.id} className={`relative bg-[#0D0D0F] border rounded-2xl p-4 flex flex-col gap-2 min-h-[7.5rem] ${
        now ? "border-[#F59E0B]/40" : "border-[#27272A]"}`}>
        <button onClick={() => onEdit(t)} className="text-left flex-1">
          <p className="text-sm font-semibold text-[#FAFAFA] leading-snug pr-6">{t.title}</p>
          {t.notes && <p className="text-xs text-[#71717A] mt-1 whitespace-pre-line line-clamp-4">{t.notes}</p>}
        </button>
        <div className="flex items-center gap-1.5 text-[11px]">
          {a && <a.icon size={12} strokeWidth={1.75} className="text-[#52525B]" />}
          <span className={now ? "text-[#F59E0B]" : "text-[#52525B]"}>
            {now ? "Back now" : t.due_date ? `Back ${format(parseISO(t.due_date), "d MMM")}` : "No date"}
          </span>
        </div>
        <button onClick={() => dismiss(t)} aria-label="Dismiss"
                className="absolute top-3 right-3 w-6 h-6 rounded-full border border-[#27272A] text-transparent hover:text-emerald-400 hover:border-emerald-500/50 flex items-center justify-center transition-colors">
          <Check size={12} />
        </button>
      </div>
    );
  };

  if (notes.length === 0) {
    return (
      <div className="border border-dashed border-[#27272A] rounded-2xl px-6 py-10 text-center space-y-2">
        <StickyNote size={22} strokeWidth={1.5} className="mx-auto text-[#3F3F46]" />
        <p className="text-sm text-[#71717A]">Write a thought down and pick the day it should come back.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {back.length > 0 && (
        <Block title="Back now">
          <div className="grid grid-cols-2 gap-2">{back.map((t) => card(t, true))}</div>
        </Block>
      )}
      {later.length > 0 && (
        <Block title="Coming back">
          <div className="grid grid-cols-2 gap-2">{later.map((t) => card(t, false))}</div>
        </Block>
      )}
    </div>
  );
}

export function TasksView({ kind, onEdit, onMore }: {
  kind: TaskKind;
  onEdit: (t: Task) => void;
  onMore: () => void;
}) {
  const today = localISODate();
  return (
    <div className="space-y-8">
      <Composer key={kind} kind={kind} today={today} onMore={onMore} />
      {kind === "task"
        ? <TaskTimeline today={today} onEdit={onEdit} />
        : <NoteCards today={today} onEdit={onEdit} />}
    </div>
  );
}
