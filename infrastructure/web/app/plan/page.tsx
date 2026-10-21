"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { differenceInCalendarDays } from "date-fns";
import { Plus, ChevronDown, ChevronUp, Target, Flame, ListChecks, StickyNote, Users, type LucideIcon } from "lucide-react";
import { plansApi, type Goal, type Task, type TaskKind } from "@/lib/plans-api";
import { localISODate } from "@/lib/dates";
import { HabitTracker } from "@/components/habits/HabitTracker";
import { PeopleView } from "@/components/people/PeopleView";
import { GoalRow } from "@/components/plan/GoalRow";
import { GoalSheet } from "@/components/plan/GoalSheet";
import { TaskRow } from "@/components/plan/TaskRow";
import { TaskSheet } from "@/components/plan/TaskSheet";
import { AREA_LIST, area as areaOf } from "@/components/plan/areas";
import { ActionButton, Block, Label, Panel, Pill, TabBar } from "@/components/plan/ui";

const TABS = [
  { key: "tasks", label: "Tasks", icon: ListChecks },
  { key: "goals", label: "Goals", icon: Target },
  { key: "habits", label: "Habits", icon: Flame },
  { key: "people", label: "People", icon: Users },
] as const;
type Tab = (typeof TABS)[number]["key"];

const CLOSED = new Set(["achieved", "missed", "done", "dropped"]);

function Empty({ icon: Icon, title, sub }: { icon: LucideIcon; title: string; sub?: string }) {
  return (
    <div className="border border-dashed border-[#27272A] rounded-2xl px-6 py-10 text-center space-y-2">
      <Icon size={22} strokeWidth={1.5} className="mx-auto text-[#3F3F46]" />
      <p className="text-sm text-[#71717A]">{title}</p>
      {sub && <p className="text-xs text-[#52525B]">{sub}</p>}
    </div>
  );
}

// ── Goals ────────────────────────────────────────────────────────────────────

function GoalsHero({ goals, year, years, setYear }: {
  goals: Goal[]; year: number; years: number[]; setYear: (y: number) => void;
}) {
  const counted = goals.filter((g) => g.state !== "dropped");
  const onTrack = counted.filter((g) => ["on_track", "achieved", "done"].includes(g.state)).length;
  const behind = counted.filter((g) => ["behind", "overdue"].includes(g.state)).length;
  const done = counted.filter((g) => ["achieved", "done"].includes(g.state)).length;
  const today = new Date();
  const left = year === today.getFullYear() ? differenceInCalendarDays(new Date(year, 11, 31), today) : null;

  return (
    <Panel className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.2em] text-[#71717A]">{year} goals</p>
          <p className="mt-1 flex items-baseline gap-2">
            <span className="text-4xl font-semibold tracking-tight tabular-nums">{onTrack}</span>
            <span className="text-sm text-[#A1A1AA]">of {counted.length} on track</span>
          </p>
          <p className="text-xs text-[#71717A] mt-1">
            {left != null ? `${left} days left in the year` : year > today.getFullYear() ? "Next year" : "Closed year"}
          </p>
        </div>
        <div className="flex gap-1 shrink-0">
          {years.map((y) => (
            <button key={y} onClick={() => setYear(y)}
                    className={`px-2.5 py-1 rounded-lg text-xs tabular-nums transition-colors ${
                      y === year ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"}`}>
              {y}
            </button>
          ))}
        </div>
      </div>
      {counted.length > 0 && (
        <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-[#27272A]">
          <div><Label>On track</Label><p className="text-2xl font-semibold tabular-nums text-emerald-400">{onTrack - done}</p></div>
          <div><Label>Behind</Label><p className={`text-2xl font-semibold tabular-nums ${behind ? "text-amber-400" : ""}`}>{behind}</p></div>
          <div><Label>Done</Label><p className="text-2xl font-semibold tabular-nums">{done}</p></div>
        </div>
      )}
    </Panel>
  );
}

function GoalsTab({ onEdit }: { onEdit: (g: Goal) => void }) {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [showClosed, setShowClosed] = useState(false);
  const { data: meta } = useQuery({ queryKey: ["goals", "meta"], queryFn: () => plansApi.goalsMeta(), staleTime: 3600_000 });
  const { data: goals = [], isLoading } = useQuery({
    queryKey: ["goals", year], queryFn: () => plansApi.goals(year), staleTime: 30_000,
  });

  const live = goals.filter((g) => !CLOSED.has(g.state));
  const closed = goals.filter((g) => CLOSED.has(g.state));
  const byArea = useMemo(() => AREA_LIST
    .map((a) => [a, live.filter((g) => areaOf(g.area).key === a.key)] as const)
    .filter(([, list]) => list.length > 0), [live]);

  return (
    <div className="space-y-8">
      <GoalsHero goals={goals} year={year} years={meta?.years ?? [thisYear]} setYear={setYear} />

      {!isLoading && goals.length === 0 && (
        <Empty icon={Target} title={`No goals for ${year} yet`}
               sub="Most track themselves — km, books, sleep, flight hours, countries, habits…" />
      )}

      {byArea.map(([a, list]) => (
        <Block key={a.key} title={a.label}>
          <Panel className="px-4 py-3 divide-y divide-[#18181B]">
            {list.map((g) => <GoalRow key={g.id} goal={g} onClick={() => onEdit(g)} />)}
          </Panel>
        </Block>
      ))}

      {closed.length > 0 && (
        <Block title={
          <button onClick={() => setShowClosed((v) => !v)} className="inline-flex items-center gap-1 uppercase tracking-widest hover:text-[#A1A1AA]">
            {showClosed ? <ChevronUp size={12} /> : <ChevronDown size={12} />} Closed · {closed.length}
          </button>
        }>
          {showClosed && (
            <Panel className="px-4 py-3 divide-y divide-[#18181B]">
              {closed.map((g) => <GoalRow key={g.id} goal={g} onClick={() => onEdit(g)} />)}
            </Panel>
          )}
        </Block>
      )}
    </div>
  );
}

// ── Tasks & notes ────────────────────────────────────────────────────────────

function TasksTab({ kind, today, onEdit }: { kind: TaskKind; today: string; onEdit: (t: Task) => void }) {
  const [showDone, setShowDone] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);
  const { data: open = [] } = useQuery({
    queryKey: ["tasks", "open", kind], queryFn: () => plansApi.tasks({ status: "open", kind }), staleTime: 0,
  });
  const { data: done = [] } = useQuery({
    queryKey: ["tasks", "done", kind], queryFn: () => plansApi.tasks({ status: "done", kind }), enabled: showDone,
  });

  const areasUsed = AREA_LIST.filter((a) => open.some((t) => t.area === a.key));
  const shown = filter ? open.filter((t) => t.area === filter) : open;
  const dated = shown.filter((t) => t.due_date);
  const groups: [string, Task[], "warn"?][] = kind === "note"
    ? [
        ["Back now", dated.filter((t) => t.due_date! <= today)],
        ["Coming back", dated.filter((t) => t.due_date! > today)],
        ["No date", shown.filter((t) => !t.due_date)],
      ]
    : [
        ["Overdue", dated.filter((t) => t.due_date! < today), "warn"],
        ["Today", dated.filter((t) => t.due_date === today)],
        ["Upcoming", dated.filter((t) => t.due_date! > today)],
        ["Inbox", shown.filter((t) => !t.due_date)],
      ];

  return (
    <div className="space-y-8">
      {areasUsed.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] pb-1">
          <Pill on={!filter} onClick={() => setFilter(null)}>All · {open.length}</Pill>
          {areasUsed.map((a) => (
            <Pill key={a.key} on={filter === a.key} onClick={() => setFilter(filter === a.key ? null : a.key)}>
              <a.icon size={12} strokeWidth={1.75} /> {a.label}
            </Pill>
          ))}
        </div>
      )}

      {open.length === 0 && (
        <Empty icon={kind === "note" ? StickyNote : ListChecks}
               title={kind === "note" ? "No notes waiting to come back" : "Nothing open"}
               sub={kind === "note" ? "Write something down and pick the day it should come back." : undefined} />
      )}

      {groups.filter(([, ts]) => ts.length > 0).map(([title, ts, tone]) => (
        <Block key={title} title={`${title} · ${ts.length}`} tone={tone}>
          <Panel className="px-4 py-1 divide-y divide-[#18181B]">
            {ts.map((t) => <TaskRow key={t.id} task={t} today={today} onEdit={onEdit} />)}
          </Panel>
        </Block>
      ))}

      <div>
        <button onClick={() => setShowDone((v) => !v)}
                className="inline-flex items-center gap-1 text-xs text-[#52525B] uppercase tracking-widest hover:text-[#A1A1AA]">
          {showDone ? <ChevronUp size={12} /> : <ChevronDown size={12} />} {kind === "note" ? "Dismissed" : "Done"}
        </button>
        {showDone && (
          <Panel className="px-4 py-1 mt-2 divide-y divide-[#18181B]">
            {done.slice(0, 50).map((t) => <TaskRow key={t.id} task={t} today={today} onEdit={onEdit} />)}
            {done.length === 0 && <p className="text-xs text-[#3F3F46] py-3">Nothing yet</p>}
          </Panel>
        )}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

type OpenSheet =
  | { type: "goal"; goal?: Goal; preset?: Partial<Pick<Goal, "title" | "metric" | "metric_param">> }
  | { type: "task"; kind: TaskKind; task?: Task }
  | null;

function PlanPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get("tab");
  // Old /plan?tab=notes links land on Tasks → Notes.
  const tab = (raw === "notes" ? "tasks" : TABS.find((t) => t.key === raw)?.key ?? "tasks") as Tab;
  const [kind, setKind] = useState<TaskKind>(raw === "notes" ? "note" : "task");
  const today = localISODate();
  const [sheet, setSheet] = useState<OpenSheet>(null);
  const go = (t: Tab) => router.replace(t === "tasks" ? "/plan" : `/plan?tab=${t}`, { scroll: false });
  const editGoal = (goal: Goal) => setSheet({ type: "goal", goal });

  const action = tab === "goals" ? { label: "Goal", open: () => setSheet({ type: "goal" }) }
    : tab === "tasks" ? { label: kind === "note" ? "Note" : "Task", open: () => setSheet({ type: "task", kind }) }
    : null;

  return (
    <main className="max-w-2xl mx-auto px-4 pb-24 pt-8">
      <div className="mb-6">
        <div className="flex items-end justify-between gap-3 mb-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Plan</h1>
            <p className="text-sm text-[#71717A] mt-0.5">Tasks, goals, habits & people</p>
          </div>
          {action && <ActionButton icon={Plus} onClick={action.open}>{action.label}</ActionButton>}
        </div>
        <TabBar tabs={TABS} value={tab} onChange={go} />
      </div>

      {tab === "tasks" && (
        <>
          <div className="flex gap-1.5 mb-6">
            <Pill on={kind === "task"} onClick={() => setKind("task")}><ListChecks size={12} /> Tasks</Pill>
            <Pill on={kind === "note"} onClick={() => setKind("note")}><StickyNote size={12} /> Notes to resurface</Pill>
          </div>
          <TasksTab key={kind} kind={kind} today={today} onEdit={(task) => setSheet({ type: "task", kind, task })} />
        </>
      )}
      {tab === "goals" && <GoalsTab onEdit={editGoal} />}
      {tab === "habits" && (
        <HabitTracker
          onEditGoal={editGoal}
          onMakeGoal={(slug) => setSheet({ type: "goal", preset: { metric: "tag_days", metric_param: slug } })}
        />
      )}
      {tab === "people" && (
        <PeopleView
          onEditGoal={editGoal}
          onMakeGoal={(id, name) => setSheet({ type: "goal", preset: {
            metric: "person_days", metric_param: String(id), title: `Time with ${name.split(" ")[0]}` } })}
        />
      )}

      {sheet?.type === "goal" && (
        <GoalSheet goal={sheet.goal} preset={sheet.preset} year={new Date().getFullYear()} onClose={() => setSheet(null)} />
      )}
      {sheet?.type === "task" && (
        <TaskSheet task={sheet.task} kind={sheet.kind} onClose={() => setSheet(null)} />
      )}
    </main>
  );
}

export default function PlanPage() {
  return <Suspense><PlanPageInner /></Suspense>;
}
