"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, CalendarPlus, Copy, Check, ChevronDown, ChevronUp } from "lucide-react";
import { api, type Contact } from "@/lib/api";
import { plansApi, type Goal, type Task, type TaskKind } from "@/lib/plans-api";
import { localISODate } from "@/lib/dates";
import { GoalCard } from "@/components/plan/GoalCard";
import { GoalSheet } from "@/components/plan/GoalSheet";
import { TaskRow } from "@/components/plan/TaskRow";
import { TaskSheet } from "@/components/plan/TaskSheet";
import { dueLabel } from "@/components/plan/format";
import { inputCls } from "@/components/plan/Sheet";

type Tab = "goals" | "tasks" | "notes" | "birthdays";
const TABS: { id: Tab; label: string }[] = [
  { id: "goals", label: "Goals" },
  { id: "tasks", label: "Tasks" },
  { id: "notes", label: "Notes" },
  { id: "birthdays", label: "Birthdays" },
];

function Group({ title, tone, children }: { title: string; tone?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className={`text-[11px] uppercase tracking-wider mb-1 ${tone ?? "text-[#52525B]"}`}>{title}</p>
      {children}
    </div>
  );
}

// ── Goals ────────────────────────────────────────────────────────────────────

function GoalsTab() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [editing, setEditing] = useState<Goal | "new" | null>(null);
  const { data: goals = [], isLoading } = useQuery({
    queryKey: ["goals", year],
    queryFn: () => plansApi.goals(year),
    staleTime: 30_000,
  });
  const live = goals.filter((g) => g.status === "active" && g.state !== "achieved" && g.state !== "missed");
  const closed = goals.filter((g) => !live.includes(g));
  const onTrack = goals.filter((g) => ["on_track", "achieved", "done"].includes(g.state)).length;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          {[thisYear - 1, thisYear, thisYear + 1].map((y) => (
            <button key={y} onClick={() => setYear(y)}
                    className={`px-2.5 py-1 rounded-lg text-sm tabular-nums ${y === year ? "bg-[#18181B] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"}`}>
              {y}
            </button>
          ))}
        </div>
        <button onClick={() => setEditing("new")}
                className="flex items-center gap-1.5 bg-[#18181B] border border-[#27272A] hover:border-[#3F3F46] rounded-xl px-3 py-1.5 text-sm">
          <Plus size={14} /> Goal
        </button>
      </div>

      {goals.length > 0 && (
        <p className="text-xs text-[#71717A]">
          {onTrack} of {goals.filter((g) => g.state !== "dropped").length} on track or done in {year}
        </p>
      )}

      {!isLoading && goals.length === 0 && (
        <p className="text-sm text-[#52525B] text-center py-12">No goals for {year} yet.</p>
      )}

      <div className="space-y-2">
        {live.map((g) => <GoalCard key={g.id} goal={g} onClick={() => setEditing(g)} />)}
      </div>

      {closed.length > 0 && (
        <Group title="Closed">
          <div className="space-y-2">
            {closed.map((g) => <GoalCard key={g.id} goal={g} onClick={() => setEditing(g)} />)}
          </div>
        </Group>
      )}

      {editing && (
        <GoalSheet goal={editing === "new" ? undefined : editing} year={year} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

// ── Tasks & notes ────────────────────────────────────────────────────────────

function TasksTab({ kind, today }: { kind: TaskKind; today: string }) {
  const [editing, setEditing] = useState<Task | "new" | null>(null);
  const [showDone, setShowDone] = useState(false);
  const { data: open = [] } = useQuery({
    queryKey: ["tasks", "open", kind],
    queryFn: () => plansApi.tasks({ status: "open", kind }),
    staleTime: 0,
  });
  const { data: done = [] } = useQuery({
    queryKey: ["tasks", "done", kind],
    queryFn: () => plansApi.tasks({ status: "done", kind }),
    enabled: showDone,
  });

  const row = (t: Task) => <TaskRow key={t.id} task={t} today={today} onEdit={setEditing} />;
  const dated = open.filter((t) => t.due_date);
  const groups: [string, Task[], string?][] = kind === "note"
    ? [
        ["Resurfaced", dated.filter((t) => t.due_date! <= today), "text-[#F59E0B]"],
        ["Coming back", dated.filter((t) => t.due_date! > today)],
        ["Undated", open.filter((t) => !t.due_date)],
      ]
    : [
        ["Overdue", dated.filter((t) => t.due_date! < today), "text-red-400"],
        ["Today", dated.filter((t) => t.due_date === today), "text-[#F59E0B]"],
        ["Upcoming", dated.filter((t) => t.due_date! > today)],
        ["Inbox", open.filter((t) => !t.due_date)],
      ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[#71717A]">
          {kind === "note"
            ? "Thoughts to bring back on a date — they show on Today until dismissed."
            : `${open.length} open`}
        </p>
        <button onClick={() => setEditing("new")}
                className="flex items-center gap-1.5 bg-[#18181B] border border-[#27272A] hover:border-[#3F3F46] rounded-xl px-3 py-1.5 text-sm">
          <Plus size={14} /> {kind === "note" ? "Note" : "Task"}
        </button>
      </div>

      {open.length === 0 && (
        <p className="text-sm text-[#52525B] text-center py-10">
          {kind === "note" ? "No notes waiting to resurface." : "Nothing open — enjoy it."}
        </p>
      )}

      {groups.filter(([, ts]) => ts.length > 0).map(([title, ts, tone]) => (
        <Group key={title} title={title} tone={tone}>
          <div className="divide-y divide-[#18181B]">{ts.map(row)}</div>
        </Group>
      ))}

      <button onClick={() => setShowDone((v) => !v)} className="flex items-center gap-1 text-xs text-[#52525B] hover:text-[#A1A1AA]">
        {showDone ? <ChevronUp size={12} /> : <ChevronDown size={12} />} {kind === "note" ? "Dismissed" : "Done"}
      </button>
      {showDone && (
        <div className="divide-y divide-[#18181B]">
          {done.slice(0, 50).map(row)}
          {done.length === 0 && <p className="text-xs text-[#3F3F46] py-2">Nothing yet</p>}
        </div>
      )}

      {editing && (
        <TaskSheet task={editing === "new" ? undefined : editing} kind={kind} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

// ── Birthdays ────────────────────────────────────────────────────────────────

function BirthdayInput({ contact }: { contact: Contact }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(contact.birthday?.replace(/^--/, "") ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    if ((contact.birthday?.replace(/^--/, "") ?? "") === value.trim()) return;
    setError(null);
    try {
      await api.updateContact(contact.id, { birthday: value.trim() || null });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["birthdays"] });
      qc.invalidateQueries({ queryKey: ["agenda"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid date");
    }
  }

  return (
    <div className="flex items-center gap-3 py-2">
      <span className="flex-1 text-sm text-[#FAFAFA] truncate">
        {contact.emoji && <span className="mr-1.5">{contact.emoji}</span>}{contact.name}
      </span>
      <div className="w-36">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          placeholder="1992-03-14 / 03-14"
          className={`${inputCls} py-1.5 text-xs ${error ? "border-red-500" : ""}`}
        />
        {error && <p className="text-[10px] text-red-400 mt-0.5">{error}</p>}
      </div>
      <span className="w-3">{saved && <Check size={12} className="text-emerald-400" />}</span>
    </div>
  );
}

function BirthdaysTab({ today }: { today: string }) {
  const { data: bdays = [] } = useQuery({ queryKey: ["birthdays"], queryFn: () => plansApi.birthdays() });
  const { data: contacts = [] } = useQuery({ queryKey: ["contacts"], queryFn: () => api.contacts() });
  const missing = contacts.filter((c) => !c.birthday);

  return (
    <div className="space-y-6">
      {bdays.length > 0 && (
        <Group title="Next up">
          <div className="divide-y divide-[#18181B]">
            {bdays.map((b) => (
              <div key={b.contact_id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm text-[#FAFAFA] truncate">
                    {b.emoji && <span className="mr-1.5">{b.emoji}</span>}{b.name}
                    {b.turning != null && <span className="text-[#71717A]"> · {b.turning}</span>}
                  </p>
                  <p className="text-[11px] text-[#52525B]">
                    {b.days_since_seen == null ? "Not logged together yet"
                      : b.days_since_seen === 0 ? "Together today"
                      : `Last together ${b.days_since_seen}d ago`}
                    {b.days_together_this_year > 0 && ` · ${b.days_together_this_year} days this year`}
                  </p>
                </div>
                <span className={`text-xs shrink-0 tabular-nums ${b.days_until <= 7 ? "text-[#F59E0B]" : "text-[#71717A]"}`}>
                  {b.days_until === 0 ? "Today" : dueLabel(b.date, today)}
                </span>
              </div>
            ))}
          </div>
        </Group>
      )}

      <Group title={bdays.length ? "Edit" : "Add birthdays"}>
        <p className="text-[11px] text-[#52525B] mb-1">YYYY-MM-DD, or MM-DD if you don't know the year.</p>
        <div className="divide-y divide-[#18181B]">
          {[...contacts.filter((c) => c.birthday), ...missing].map((c) => <BirthdayInput key={c.id} contact={c} />)}
        </div>
      </Group>
    </div>
  );
}

// ── Calendar subscription ────────────────────────────────────────────────────

function CalendarSubscribe() {
  const [copied, setCopied] = useState(false);
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
  const url = `${base.replace(/^https?:\/\//, "webcal://")}/calendar.ics`;
  return (
    <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4 space-y-2">
      <p className="text-sm text-[#FAFAFA] flex items-center gap-2"><CalendarPlus size={14} /> Reminders on your phone</p>
      <p className="text-xs text-[#71717A]">
        Subscribe once in Calendar: dated tasks, notes, cutoffs, birthdays and goal deadlines show up with
        alerts at 09:00 — and stay visible offline.
      </p>
      <div className="flex items-center gap-2">
        <a href={url} className="flex-1 min-w-0 truncate text-xs text-[#F59E0B] font-mono">{url}</a>
        <button
          onClick={() => { navigator.clipboard?.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
          className="p-1.5 text-[#52525B] hover:text-[#FAFAFA]" aria-label="Copy link">
          {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
        </button>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

function PlanPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const tab = (TABS.find((t) => t.id === params.get("tab"))?.id ?? "goals") as Tab;
  const today = localISODate();

  return (
    <main className="max-w-2xl mx-auto px-4 pb-20 pt-6 space-y-6">
      <h1 className="text-xl font-semibold text-[#FAFAFA]">Plan</h1>

      <div className="flex border-b border-[#27272A]">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => router.replace(`/plan?tab=${t.id}`, { scroll: false })}
                  className={`px-3 sm:px-4 py-2 text-sm font-medium transition-colors ${
                    tab === t.id ? "text-[#FAFAFA] border-b-2 border-[#F59E0B]" : "text-[#71717A] hover:text-[#A1A1AA]"
                  }`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "goals" && <GoalsTab />}
      {tab === "tasks" && <TasksTab kind="task" today={today} />}
      {tab === "notes" && <TasksTab kind="note" today={today} />}
      {tab === "birthdays" && <BirthdaysTab today={today} />}

      <CalendarSubscribe />
    </main>
  );
}

export default function PlanPage() {
  return <Suspense><PlanPageInner /></Suspense>;
}
