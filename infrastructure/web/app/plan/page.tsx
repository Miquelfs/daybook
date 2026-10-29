"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { differenceInCalendarDays } from "date-fns";
import { Plus, CalendarDays, ChevronDown, ChevronUp, Target, Flame, GraduationCap, ListChecks, StickyNote, Users, type LucideIcon } from "lucide-react";
import { plansApi, PLAN_KEYS, type Goal, type Task, type TaskKind } from "@/lib/plans-api";
import { localISODate } from "@/lib/dates";
import { HabitTracker } from "@/components/habits/HabitTracker";
import { PeopleView } from "@/components/people/PeopleView";
import { LearnView } from "@/components/learning/LearnView";
import { GoalRow } from "@/components/plan/GoalRow";
import { GoalSheet } from "@/components/plan/GoalSheet";
import { TaskSheet } from "@/components/plan/TaskSheet";
import { TasksView } from "@/components/plan/TasksView";
import { PlanCalendar } from "@/components/plan/PlanCalendar";
import { AREA_LIST, area as areaOf } from "@/components/plan/areas";
import { ActionButton, Block, Label, Panel, Pill, TabBar } from "@/components/plan/ui";

const TABS = [
  { key: "tasks", label: "Tasks", icon: ListChecks },
  { key: "calendar", label: "Calendar", icon: CalendarDays },
  { key: "goals", label: "Goals", icon: Target },
  { key: "learn", label: "Learn", icon: GraduationCap },
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
  const daysInYear = differenceInCalendarDays(new Date(year + 1, 0, 1), new Date(year, 0, 1));
  const day = Math.min(daysInYear, Math.max(0, differenceInCalendarDays(today, new Date(year, 0, 1)) + 1));
  const yearPct = Math.round((day / daysInYear) * 100);

  return (
    <Panel className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.2em] text-[#71717A]">{year} goals</p>
          <p className="mt-1 flex items-baseline gap-2">
            <span className="text-4xl font-semibold tracking-tight tabular-nums">{onTrack}</span>
            <span className="text-sm text-[#A1A1AA]">of {counted.length} on track</span>
          </p>
          <p className="text-xs text-[#71717A] mt-1 tabular-nums">
            {day === 0 ? `Starts in ${differenceInCalendarDays(new Date(year, 0, 1), today)} days`
              : `Day ${day}/${daysInYear} · ${yearPct}% of the year`}
          </p>
          {day > 0 && day < daysInYear && (
            <div className="h-1 w-40 bg-[#18181B] rounded-full mt-2">
              <div className="h-full rounded-full bg-[#52525B]" style={{ width: `${yearPct}%` }} />
            </div>
          )}
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
  const qc = useQueryClient();
  const thisYear = new Date().getFullYear();
  async function tick(g: Goal) {
    await plansApi.updateGoal(g.id, { status: g.status === "done" ? "active" : "done" });
    PLAN_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [...k] }));
  }
  const [year, setYear] = useState(thisYear);
  const [showClosed, setShowClosed] = useState(false);
  const { data: meta } = useQuery({ queryKey: ["goals", "meta"], queryFn: () => plansApi.goalsMeta(), staleTime: 3600_000 });
  const { data: goals = [], isLoading } = useQuery({
    queryKey: ["goals", year], queryFn: () => plansApi.goals(year), staleTime: 30_000,
  });

  const live = goals.filter((g) => !CLOSED.has(g.state));
  const achieved = goals.filter((g) => g.state === "achieved" || g.state === "done");
  const closed = goals.filter((g) => g.state === "missed" || g.state === "dropped");
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
            {list.map((g) => <GoalRow key={g.id} goal={g} onClick={() => onEdit(g)} onTick={tick} />)}
          </Panel>
        </Block>
      ))}

      {achieved.length > 0 && (
        <Block title={`Achieved · ${achieved.length}`}>
          <Panel className="px-4 py-3 divide-y divide-[#18181B] border-emerald-500/25">
            {achieved.map((g) => <GoalRow key={g.id} goal={g} onClick={() => onEdit(g)} onTick={tick} />)}
          </Panel>
        </Block>
      )}

      {closed.length > 0 && (
        <Block title={
          <button onClick={() => setShowClosed((v) => !v)} className="inline-flex items-center gap-1 uppercase tracking-widest hover:text-[#A1A1AA]">
            {showClosed ? <ChevronUp size={12} /> : <ChevronDown size={12} />} Missed & dropped · {closed.length}
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

// ── Page ─────────────────────────────────────────────────────────────────────

type OpenSheet =
  | { type: "goal"; goal?: Goal; preset?: Partial<Pick<Goal, "title" | "metric" | "metric_param">> }
  | { type: "task"; kind: TaskKind; task?: Task; defaultDate?: string }
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
            <p className="text-sm text-[#71717A] mt-0.5">Tasks, goals, learning, habits & people</p>
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
          <TasksView kind={kind} onEdit={(task) => setSheet({ type: "task", kind, task })}
                     onMore={() => setSheet({ type: "task", kind })} />
        </>
      )}
      {tab === "calendar" && (
        <PlanCalendar
          onEditTask={(task) => setSheet({ type: "task", kind: task.kind, task })}
          onNewTask={(d) => setSheet({ type: "task", kind: "task", defaultDate: d })}
          onEditGoal={editGoal}
        />
      )}
      {tab === "goals" && <GoalsTab onEdit={editGoal} />}
      {tab === "learn" && <LearnView today={today} />}
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
        <TaskSheet task={sheet.task} kind={sheet.kind} defaultDate={sheet.defaultDate} onClose={() => setSheet(null)} />
      )}
    </main>
  );
}

export default function PlanPage() {
  return <Suspense><PlanPageInner /></Suspense>;
}
