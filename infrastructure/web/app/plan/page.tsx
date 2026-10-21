"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import {
  Plus, Check, ChevronDown, ChevronUp, Target, ListChecks, StickyNote, Cake, Sun,
  type LucideIcon,
} from "lucide-react";
import { api, type Contact } from "@/lib/api";
import { plansApi, type Goal, type Task, type TaskKind } from "@/lib/plans-api";
import { localISODate } from "@/lib/dates";
import { GoalCard } from "@/components/plan/GoalCard";
import { GoalSheet } from "@/components/plan/GoalSheet";
import { TaskRow } from "@/components/plan/TaskRow";
import { TaskSheet } from "@/components/plan/TaskSheet";
import { Avatar } from "@/components/plan/Avatar";
import { birthdayInput, dueLabel } from "@/components/plan/format";
import { inputCls } from "@/components/plan/Sheet";
import { AREA_LIST, area as areaOf, tint } from "@/components/plan/areas";

type Tab = "goals" | "tasks" | "notes" | "people";
const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: "goals", label: "Goals", icon: Target },
  { id: "tasks", label: "Tasks", icon: ListChecks },
  { id: "notes", label: "Notes", icon: StickyNote },
  { id: "people", label: "People", icon: Cake },
];

function Empty({ icon: Icon, title, sub }: { icon: LucideIcon; title: string; sub?: string }) {
  return (
    <div className="text-center py-12 space-y-2">
      <Icon size={28} strokeWidth={1.5} className="mx-auto text-[#52525B]" />
      <p className="text-sm text-[#A1A1AA]">{title}</p>
      {sub && <p className="text-xs text-[#52525B]">{sub}</p>}
    </div>
  );
}

function AddButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
            className="flex items-center gap-1.5 bg-[#F59E0B] text-black font-semibold rounded-xl px-3 py-1.5 text-sm hover:opacity-90">
      <Plus size={14} /> {children}
    </button>
  );
}

function GroupTitle({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-[0.15em] mb-2"
       style={color ? { color } : undefined}>
      <span className={color ? "" : "text-[#52525B]"}>{children}</span>
    </p>
  );
}

// ── Summary tiles ────────────────────────────────────────────────────────────

function Tile({ icon: Icon, label, value, sub, color, onClick }: {
  icon: LucideIcon; label: string; value: React.ReactNode; sub?: React.ReactNode; color: string; onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="text-left rounded-2xl p-3 min-w-0 transition-opacity hover:opacity-90"
            style={{ background: tint(color, 0.13) }}>
      <p className="flex items-center gap-1.5 text-[11px] text-[#71717A] truncate">
        <Icon size={12} strokeWidth={2} style={{ color }} /> {label}
      </p>
      <p className="text-lg font-semibold text-[#FAFAFA] tabular-nums mt-0.5 truncate">{value}</p>
      {sub && <p className="text-[11px] text-[#71717A] truncate">{sub}</p>}
    </button>
  );
}

function Summary({ today, go }: { today: string; go: (t: Tab) => void }) {
  const { data: a } = useQuery({ queryKey: ["agenda", today], queryFn: () => plansApi.agenda(today) });
  const { data: open = [] } = useQuery({
    queryKey: ["tasks", "open", "task"], queryFn: () => plansApi.tasks({ status: "open", kind: "task" }),
  });
  const { data: bdays = [] } = useQuery({ queryKey: ["birthdays"], queryFn: () => plansApi.birthdays() });
  const next = bdays[0];
  const overdue = open.filter((t) => t.due_date && t.due_date < today).length;

  return (
    <div className="grid grid-cols-3 gap-2">
      <Tile icon={Target} label="Goals" color="#059669" onClick={() => go("goals")}
            value={a ? <>{a.goals.on_track}<span className="text-[#71717A] text-sm">/{a.goals.total}</span></> : "–"}
            sub="on track" />
      <Tile icon={ListChecks} label="Tasks" color={overdue ? "#E11D48" : "#2563EB"} onClick={() => go("tasks")}
            value={open.length}
            sub={overdue ? <span className="text-rose-400">{overdue} overdue</span> : "open"} />
      <Tile icon={Cake} label="Next birthday" color="#DB2777" onClick={() => go("people")}
            value={next ? next.name.split(" ")[0] : "–"}
            sub={next ? (next.days_until === 0 ? "today" : dueLabel(next.date, today)) : "add some"} />
    </div>
  );
}

// ── Goals ────────────────────────────────────────────────────────────────────

const CLOSED = new Set(["achieved", "missed", "done", "dropped"]);

function GoalsTab() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [editing, setEditing] = useState<Goal | "new" | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const { data: meta } = useQuery({ queryKey: ["goals", "meta"], queryFn: () => plansApi.goalsMeta(), staleTime: 3600_000 });
  const { data: goals = [], isLoading } = useQuery({
    queryKey: ["goals", year], queryFn: () => plansApi.goals(year), staleTime: 30_000,
  });

  const live = goals.filter((g) => !CLOSED.has(g.state));
  const closed = goals.filter((g) => CLOSED.has(g.state));
  const byArea = useMemo(() => {
    const m = new Map<string, Goal[]>();
    for (const g of live) m.set(areaOf(g.area).key, [...(m.get(areaOf(g.area).key) ?? []), g]);
    return AREA_LIST.filter((a) => m.has(a.key)).map((a) => [a, m.get(a.key)!] as const);
  }, [live]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none]">
          {(meta?.years ?? [thisYear]).map((y) => (
            <button key={y} onClick={() => setYear(y)}
                    className={`px-3 py-1 rounded-full text-sm tabular-nums transition-colors ${
                      y === year ? "bg-[#FAFAFA] text-[#09090B] font-semibold" : "text-[#71717A] hover:text-[#FAFAFA]"}`}>
              {y}
            </button>
          ))}
        </div>
        <AddButton onClick={() => setEditing("new")}>Goal</AddButton>
      </div>

      {!isLoading && goals.length === 0 && (
        <Empty icon={Target} title={`No goals for ${year} yet`}
               sub="Most can track themselves — km, books, sleep, hours, countries…" />
      )}

      {byArea.map(([a, list]) => (
        <div key={a.key}>
          <GroupTitle color={a.color}>
            <span className="inline-flex items-center gap-1.5"><a.icon size={13} strokeWidth={2} /> {a.label}</span>
          </GroupTitle>
          <div className="space-y-2">
            {list.map((g) => <GoalCard key={g.id} goal={g} onClick={() => setEditing(g)} />)}
          </div>
        </div>
      ))}

      {closed.length > 0 && (
        <div>
          <button onClick={() => setShowClosed((v) => !v)}
                  className="flex items-center gap-1 text-xs text-[#71717A] hover:text-[#A1A1AA] mb-2">
            {showClosed ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            Closed · {closed.filter((g) => g.state === "achieved" || g.state === "done").length} done of {closed.length}
          </button>
          {showClosed && (
            <div className="space-y-2">
              {closed.map((g) => <GoalCard key={g.id} goal={g} onClick={() => setEditing(g)} />)}
            </div>
          )}
        </div>
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
  const groups: [string, Task[], string?][] = kind === "note"
    ? [
        ["Back now", dated.filter((t) => t.due_date! <= today), "#D97706"],
        ["Coming back", dated.filter((t) => t.due_date! > today)],
        ["No date", shown.filter((t) => !t.due_date)],
      ]
    : [
        ["Overdue", dated.filter((t) => t.due_date! < today), "#E11D48"],
        ["Today", dated.filter((t) => t.due_date === today), "#D97706"],
        ["Upcoming", dated.filter((t) => t.due_date! > today)],
        ["Inbox", shown.filter((t) => !t.due_date)],
      ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-[#71717A]">
          {kind === "note" ? "Thoughts that come back on Today on their date." : `${open.length} open`}
        </p>
        <AddButton onClick={() => setEditing("new")}>{kind === "note" ? "Note" : "Task"}</AddButton>
      </div>

      {areasUsed.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] -mx-4 px-4">
          <button onClick={() => setFilter(null)}
                  className={`shrink-0 px-3 py-1 rounded-full text-xs ${filter ? "text-[#71717A]" : "bg-[#FAFAFA] text-[#09090B] font-semibold"}`}>
            All
          </button>
          {areasUsed.map((a) => (
            <button key={a.key} onClick={() => setFilter(filter === a.key ? null : a.key)}
                    className="shrink-0 px-3 py-1 rounded-full text-xs border"
                    style={filter === a.key ? { background: tint(a.color, 0.2), borderColor: a.color, color: a.color }
                                            : { borderColor: "transparent", background: tint(a.color, 0.08) }}>
              <span className="inline-flex items-center gap-1.5"><a.icon size={12} strokeWidth={2} /> {a.label}</span>
            </button>
          ))}
        </div>
      )}

      {open.length === 0 && (
        <Empty icon={kind === "note" ? StickyNote : Sun}
               title={kind === "note" ? "No notes waiting to come back" : "Nothing open — enjoy it"} />
      )}

      {groups.filter(([, ts]) => ts.length > 0).map(([title, ts, color]) => (
        <div key={title}>
          <GroupTitle color={color}>{title} · {ts.length}</GroupTitle>
          <div className="bg-[#0D0D0F] border border-[#27272A] rounded-2xl px-4 py-1 divide-y divide-[#18181B]">
            {ts.map((t) => <TaskRow key={t.id} task={t} today={today} onEdit={setEditing} />)}
          </div>
        </div>
      ))}

      <button onClick={() => setShowDone((v) => !v)} className="flex items-center gap-1 text-xs text-[#52525B] hover:text-[#A1A1AA]">
        {showDone ? <ChevronUp size={12} /> : <ChevronDown size={12} />} {kind === "note" ? "Dismissed" : "Done"}
      </button>
      {showDone && (
        <div className="divide-y divide-[#18181B] px-1">
          {done.slice(0, 50).map((t) => <TaskRow key={t.id} task={t} today={today} onEdit={setEditing} />)}
          {done.length === 0 && <p className="text-xs text-[#3F3F46] py-2">Nothing yet</p>}
        </div>
      )}

      {editing && (
        <TaskSheet task={editing === "new" ? undefined : editing} kind={kind} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

// ── People ───────────────────────────────────────────────────────────────────

function BirthdayRow({ contact }: { contact: Contact }) {
  const qc = useQueryClient();
  const initial = birthdayInput(contact.birthday);
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    if (value.trim() === initial) return;
    setError(null);
    try {
      await api.updateContact(contact.id, { birthday: value.trim() || null });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      for (const k of ["contacts", "birthdays", "agenda"]) qc.invalidateQueries({ queryKey: [k] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid date");
    }
  }

  return (
    <div className="flex items-center gap-3 py-2">
      <Avatar name={contact.name} size={30} />
      <span className="flex-1 min-w-0 text-sm text-[#FAFAFA] truncate">{contact.name}</span>
      <div className="w-32">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          placeholder="dd-mm-yyyy"
          inputMode="numeric"
          className={`${inputCls} py-1.5 text-xs text-center tabular-nums ${error ? "border-rose-500" : ""}`}
        />
      </div>
      <span className="w-3">{saved && <Check size={12} className="text-emerald-400" />}</span>
      {error && <span className="sr-only">{error}</span>}
    </div>
  );
}

function PeopleTab() {
  const [showAll, setShowAll] = useState(false);
  const { data: bdays = [] } = useQuery({ queryKey: ["birthdays"], queryFn: () => plansApi.birthdays() });
  const { data: contacts = [] } = useQuery({ queryKey: ["contacts"], queryFn: () => api.contacts() });
  const missing = contacts.filter((c) => !c.birthday);

  const byMonth = useMemo(() => {
    const m = new Map<string, typeof bdays>();
    for (const b of bdays) {
      const k = format(parseISO(b.date), "MMMM yyyy");
      m.set(k, [...(m.get(k) ?? []), b]);
    }
    return [...m.entries()];
  }, [bdays]);

  return (
    <div className="space-y-6">
      {bdays.length === 0 && (
        <Empty icon={Cake} title="No birthdays yet — add them below" />
      )}

      {byMonth.map(([month, list]) => (
        <div key={month}>
          <GroupTitle color="#DB2777">{month}</GroupTitle>
          <div className="space-y-2">
            {list.map((b) => {
              const soon = b.days_until <= 7;
              return (
                <div key={b.contact_id}
                     className="flex items-center gap-3 rounded-2xl px-3 py-2.5 border border-[#27272A] bg-[#0D0D0F]"
                     style={soon ? { background: tint("#DB2777", 0.1), borderColor: tint("#DB2777", 0.35) } : undefined}>
                  <Avatar name={b.name} size={40} ring={b.days_until === 0} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#FAFAFA] truncate">
                      {b.name}
                      {b.turning != null && <span className="text-[#71717A] font-normal"> · turns {b.turning}</span>}
                    </p>
                    <p className="text-[11px] text-[#71717A]">
                      {format(parseISO(b.date), "EEE d MMM")}
                      {" · "}
                      {b.days_since_seen == null ? "not logged together yet"
                        : b.days_since_seen === 0 ? "together today"
                        : `last together ${b.days_since_seen}d ago`}
                      {b.days_together_this_year > 0 && ` · ${b.days_together_this_year} day${b.days_together_this_year === 1 ? "" : "s"} this year`}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs font-semibold tabular-nums px-2 py-1 rounded-full"
                        style={{ background: tint("#DB2777", soon ? 0.22 : 0.1), color: "#DB2777" }}>
                    {b.days_until === 0 ? "Today" : b.days_until === 1 ? "Tomorrow" : `${b.days_until}d`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div>
        <button onClick={() => setShowAll((v) => !v)}
                className="flex items-center gap-1 text-xs text-[#71717A] hover:text-[#A1A1AA]">
          {showAll ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {missing.length > 0 ? `Add birthdays · ${missing.length} people without one` : "Edit birthdays"}
        </button>
        {showAll && (
          <div className="mt-2 bg-[#0D0D0F] border border-[#27272A] rounded-2xl px-4 py-1">
            <p className="text-[11px] text-[#52525B] pt-2">dd-mm-yyyy, or dd-mm if you don&apos;t know the year.</p>
            <div className="divide-y divide-[#18181B]">
              {[...missing, ...contacts.filter((c) => c.birthday)].map((c) => <BirthdayRow key={c.id} contact={c} />)}
            </div>
          </div>
        )}
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
  const go = (t: Tab) => router.replace(`/plan?tab=${t}`, { scroll: false });

  return (
    <main className="max-w-2xl mx-auto px-4 pb-24 pt-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[#FAFAFA]">Plan</h1>
        <p className="text-sm text-[#71717A] mt-0.5">What&apos;s ahead — goals, tasks, notes and people</p>
      </div>

      <Summary today={today} go={go} />

      <div className="flex gap-1 bg-[#0D0D0F] border border-[#27272A] rounded-xl p-1">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => go(t.id)}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-sm transition-colors ${
                    tab === t.id ? "bg-[#27272A] text-[#FAFAFA] font-medium" : "text-[#71717A] hover:text-[#A1A1AA]"}`}>
            <t.icon size={15} strokeWidth={1.75} /><span className="hidden min-[380px]:inline">{t.label}</span>
          </button>
        ))}
      </div>

      {tab === "goals" && <GoalsTab />}
      {tab === "tasks" && <TasksTab kind="task" today={today} />}
      {tab === "notes" && <TasksTab kind="note" today={today} />}
      {tab === "people" && <PeopleTab />}
    </main>
  );
}

export default function PlanPage() {
  return <Suspense><PlanPageInner /></Suspense>;
}
