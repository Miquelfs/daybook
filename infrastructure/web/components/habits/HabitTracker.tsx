"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ArrowLeft, Check, ChevronRight, Flame, Pin, Search, Target, X } from "lucide-react";
import { plansApi, type Goal, type Habit, type HabitWhy } from "@/lib/plans-api";
import { tagsApi } from "@/lib/tags-api";
import { localISODate } from "@/lib/dates";
import { GoalRow } from "@/components/plan/GoalRow";
import { ActionButton, Block, Panel, Pill } from "@/components/plan/ui";
import { inputCls } from "@/components/plan/Sheet";
import { MonthBars, Stat, WeekdayBars, YearHeatmap, YearSwitcher } from "@/components/plan/charts";

const DOW = ["S", "M", "T", "W", "T", "F", "S"];
const WHY: Record<HabitWhy, string> = { pinned: "Pinned", goal: "Goal", experiment: "Experiment" };

function refreshAll(qc: ReturnType<typeof useQueryClient>, date?: string) {
  for (const k of ["habits", "habit", "habit-tags", "goals", "agenda", "area-plan"]) qc.invalidateQueries({ queryKey: [k] });
  if (date) qc.invalidateQueries({ queryKey: ["day-tags", date] });
}

/** Tap a day to log / unlog the habit's tag on it — the same as tagging the day on Today. */
function DayDot({ habit, day }: { habit: Habit; day: { date: string; done: boolean } }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const today = day.date === localISODate();
  const slip = habit.is_negative;

  async function toggle() {
    setBusy(true);
    try {
      if (day.done) await tagsApi.removeDayTag(day.date, habit.id);
      else await tagsApi.addDayTag(day.date, habit.id);
      refreshAll(qc, day.date);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button onClick={toggle} disabled={busy}
            aria-label={`${habit.name} ${format(parseISO(day.date), "EEE d")}: ${day.done ? "logged" : "not logged"}`}
            className={`w-6 h-6 rounded-full flex items-center justify-center border transition-colors ${busy ? "opacity-40" : ""} ${
              day.done
                ? slip ? "bg-rose-500/15 border-rose-500/50 text-rose-400" : "bg-[#F59E0B] border-[#F59E0B] text-black"
                : `border-[#27272A] text-transparent hover:border-[#52525B] ${today ? "border-[#52525B]" : ""}`}`}>
      {day.done && (slip ? <X size={12} strokeWidth={2.5} /> : <Check size={12} strokeWidth={3} />)}
    </button>
  );
}

function HabitList({ habits, onOpen }: { habits: Habit[]; onOpen: (slug: string) => void }) {
  const week = habits[0]?.week ?? [];
  return (
    <Panel className="px-4 py-2">
      <div className="flex items-center gap-2 pb-1">
        <span className="flex-1" />
        <div className="flex gap-0.5">
          {week.map((d) => (
            <span key={d.date} className={`w-6 text-center text-[10px] ${d.date === localISODate() ? "text-[#F59E0B]" : "text-[#52525B]"}`}>
              {DOW[parseISO(d.date).getDay()]}
            </span>
          ))}
        </div>
      </div>
      <div className="divide-y divide-[#18181B]">
        {habits.map((h) => (
          <div key={h.id} className="flex items-center gap-2 py-2.5">
            <button onClick={() => onOpen(h.slug)} className="flex-1 min-w-0 flex items-center gap-2 text-left">
              <span className="w-6 text-lg text-center shrink-0">{h.icon ?? "•"}</span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-[#FAFAFA] truncate">
                  {h.name}
                  {!h.why.includes("pinned") && <span className="ml-1.5 text-[10px] text-[#52525B]">{WHY[h.why[0]]}</span>}
                </p>
                <p className="text-[11px] text-[#71717A] tabular-nums truncate">
                  {h.is_negative ? (
                    <>{h.streak_current}d clean · {h.rate_30}%</>
                  ) : (
                    <>
                      {h.streak_current > 0 && <span className="text-[#F59E0B]"><Flame size={10} className="inline -mt-0.5" /> {h.streak_current} · </span>}
                      {h.count_30}/30d
                    </>
                  )}
                </p>
              </div>
            </button>
            <div className="flex gap-0.5 shrink-0">
              {h.week.map((d) => <DayDot key={d.date} habit={h} day={d} />)}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function HabitDetailView({ slug, goals, onBack, onMakeGoal, onEditGoal }: {
  slug: string;
  goals: Goal[];
  onBack: () => void;
  onMakeGoal: (slug: string) => void;
  onEditGoal: (g: Goal) => void;
}) {
  const qc = useQueryClient();
  const [year, setYear] = useState(new Date().getFullYear());
  const [allDays, setAllDays] = useState(false);
  const { data: h } = useQuery({ queryKey: ["habit", slug, year], queryFn: () => plansApi.habit(slug, year) });

  async function track(on: boolean) {
    await plansApi.track(slug, on);
    refreshAll(qc);
  }
  const linked = goals.filter((g) => g.metric_param === slug);

  async function setDirection(negative: boolean) {
    if (!h || h.is_negative === negative) return;
    await tagsApi.updateTag(h.id, { is_negative: negative });
    refreshAll(qc);
  }

  if (!h) return <div className="h-64 rounded-2xl bg-[#18181B] animate-pulse" />;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const bestMonth = h.by_month.indexOf(Math.max(...h.by_month));

  return (
    <div className="space-y-8">
      <div>
        <button onClick={onBack} className="inline-flex items-center gap-1 text-xs text-[#71717A] hover:text-[#A1A1AA] uppercase tracking-widest mb-3">
          <ArrowLeft size={12} /> Habits
        </button>
        <div className="flex items-center gap-3">
          <span className="text-4xl">{h.icon ?? "•"}</span>
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-semibold tracking-tight">{h.name}</h2>
            <p className="text-xs text-[#71717A]">
              {h.total} days logged{h.first ? ` since ${format(parseISO(h.first), "d MMM yyyy")}` : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 mt-3">
          {h.why.includes("pinned")
            ? <Pill on onClick={() => track(false)}><Pin size={11} /> Tracking</Pill>
            : <ActionButton icon={Pin} onClick={() => track(true)}>Track as habit</ActionButton>}
          {linked.length === 0 && <ActionButton icon={Target} onClick={() => onMakeGoal(slug)}>Make it a goal</ActionButton>}
          {h.why.filter((w) => w !== "pinned").map((w) => (
            <span key={w} className="text-[11px] text-[#52525B]">tracked by its {WHY[w].toLowerCase()}</span>
          ))}
        </div>
        <div className="flex gap-1.5 mt-2">
          <Pill on={!h.is_negative} onClick={() => setDirection(false)}>Do more</Pill>
          <Pill on={h.is_negative} onClick={() => setDirection(true)}>Do less — count clean days</Pill>
        </div>
      </div>

      <Panel className="p-5">
        <div className="grid grid-cols-2 gap-x-4 gap-y-5">
          <Stat label={h.is_negative ? "Clean streak" : "Current streak"} value={h.streak_current}
                sub={h.streak_current === 1 ? "day" : "days"} tone={h.streak_current ? "text-[#F59E0B]" : ""} />
          <Stat label="Best streak" value={h.streak_best}
                sub={h.streak_best_end ? `ended ${format(parseISO(h.streak_best_end), "d MMM yy")}` : undefined} />
          <Stat label={`${h.year}`} value={h.count}
                sub={h.per_week != null ? `${h.per_week}× a week` : `${h.count === 1 ? "day" : "days"}`} />
          <Stat label={h.is_negative ? "Clean days" : "Completion"} value={`${h.rate}%`}
                sub={`of ${h.days_elapsed} days`} tone={h.is_negative ? (h.rate >= 80 ? "text-emerald-400" : "") : ""} />
        </div>
      </Panel>

      {linked.length > 0 && (
        <Block title="Goals">
          <Panel className="px-4 py-3 divide-y divide-[#18181B]">
            {linked.map((g) => <GoalRow key={g.id} goal={g} onClick={() => onEditGoal(g)} />)}
          </Panel>
        </Block>
      )}

      <Block title="Calendar" action={<YearSwitcher years={h.years} year={year} onChange={setYear} />}>
        <Panel className="p-4">
          <YearHeatmap dates={h.dates} year={year} slip={h.is_negative} />
        </Panel>
      </Block>

      <Block title="By month" note={h.count ? `Most in ${months[bestMonth]} (${h.by_month[bestMonth]} days).` : undefined}>
        <Panel className="p-4"><MonthBars counts={h.by_month} year={year} /></Panel>
      </Block>

      <Block title="By weekday">
        <Panel className="p-4"><WeekdayBars counts={h.by_weekday} /></Panel>
      </Block>

      {h.dates.length > 0 && (
        <Block title={`Every day · ${year}`} note={`${h.dates.length} ${h.dates.length === 1 ? "day" : "days"} — tap one to open it.`}>
          <Panel className="px-4 py-1 divide-y divide-[#18181B]">
            {[...h.dates].reverse().slice(0, allDays ? undefined : 10).map((d) => (
              <Link key={d} href={`/day/${d}`} className="flex items-center justify-between py-2.5 text-sm hover:opacity-80">
                <span className="text-[#A1A1AA]">{format(parseISO(d), "EEEE d MMM")}</span>
                <ChevronRight size={14} className="text-[#3F3F46]" />
              </Link>
            ))}
          </Panel>
          {h.dates.length > 10 && (
            <button onClick={() => setAllDays((v) => !v)} className="mt-2 text-xs text-[#52525B] hover:text-[#A1A1AA]">
              {allDays ? "Show fewer" : `Show all ${h.dates.length}`}
            </button>
          )}
        </Block>
      )}
    </div>
  );
}

/** Every tag ever logged — search it, open it, see all its days. */
function Explore({ onOpen }: { onOpen: (slug: string) => void }) {
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const { data: tags = [] } = useQuery({ queryKey: ["habit-tags"], queryFn: () => plansApi.exploreTags() });
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? tags.filter((t) => t.name.toLowerCase().includes(n) || t.slug.includes(n)) : tags;
  }, [tags, q]);
  const visible = q || all ? shown : shown.slice(0, 10);
  const year = new Date().getFullYear();

  return (
    <Block title="Explore" note="Every tag you've logged — open one to see all its days, its rhythm, or to track it.">
      <div className="relative mb-2">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#52525B]" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tags — cooking, sauna, reading…"
               className={`${inputCls} pl-9`} />
      </div>
      <Panel className="px-4 py-1 divide-y divide-[#18181B]">
        {visible.map((t) => (
          <button key={t.slug} onClick={() => onOpen(t.slug)} className="w-full flex items-center gap-3 py-2.5 text-left">
            <span className="w-6 text-lg text-center shrink-0">{t.icon ?? "•"}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-[#FAFAFA] truncate">
                {t.name}
                {t.tracked && <Pin size={10} className="inline ml-1.5 -mt-0.5 text-[#F59E0B]" aria-label="Tracked" />}
              </p>
              <p className="text-[11px] text-[#52525B]">
                {t.this_year} in {year} · last {format(parseISO(t.last), "d MMM yy")}
              </p>
            </div>
            <span className="text-sm font-semibold tabular-nums text-[#A1A1AA]">{t.total}</span>
          </button>
        ))}
        {visible.length === 0 && <p className="text-xs text-[#52525B] py-4 text-center">No tag matches “{q}”.</p>}
      </Panel>
      {!q && shown.length > 10 && (
        <button onClick={() => setAll((v) => !v)} className="mt-2 text-xs text-[#52525B] hover:text-[#A1A1AA]">
          {all ? "Show fewer" : `Show all ${shown.length} tags`}
        </button>
      )}
    </Block>
  );
}

/**
 * Habits: the ones you chose to work on (pinned, a goal or an experiment) with
 * the last seven days tappable — and Explore for every other tag you've logged.
 */
export function HabitTracker({ onMakeGoal, onEditGoal }: {
  onMakeGoal: (slug: string) => void;
  onEditGoal: (g: Goal) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const year = new Date().getFullYear();
  const { data: habits = [], isLoading } = useQuery({ queryKey: ["habits"], queryFn: () => plansApi.habits() });
  const { data: goals = [] } = useQuery({ queryKey: ["goals", year], queryFn: () => plansApi.goals(year) });
  const habitGoals = goals.filter((g) => g.metric_param && (g.metric === "tag_days" || g.metric === "tag_streak"));

  if (open) {
    return <HabitDetailView slug={open} goals={habitGoals} onBack={() => setOpen(null)}
                            onMakeGoal={onMakeGoal} onEditGoal={onEditGoal} />;
  }

  const doing = habits.filter((h) => !h.is_negative);
  const cutting = habits.filter((h) => h.is_negative);

  return (
    <div className="space-y-8">
      {isLoading && <div className="h-40 rounded-2xl bg-[#18181B] animate-pulse" />}

      {!isLoading && habits.length === 0 && (
        <Block title="Tracking">
          <div className="border border-dashed border-[#27272A] rounded-2xl px-6 py-8 text-center space-y-1">
            <p className="text-sm text-[#A1A1AA]">No habits yet</p>
            <p className="text-xs text-[#52525B]">Open a tag below and tap <span className="text-[#A1A1AA]">Track as habit</span> — or give it a goal.</p>
          </div>
        </Block>
      )}

      {doing.length > 0 && (
        <Block title="Doing" note="Tap a day to log it. Open a habit for its year and streaks.">
          <HabitList habits={doing} onOpen={setOpen} />
        </Block>
      )}
      {cutting.length > 0 && (
        <Block title="Cutting down" note="Fewer is better — a filled day is a slip.">
          <HabitList habits={cutting} onOpen={setOpen} />
        </Block>
      )}

      {habitGoals.length > 0 && (
        <Block title="Habit goals">
          <Panel className="px-4 py-3 divide-y divide-[#18181B]">
            {habitGoals.map((g) => <GoalRow key={g.id} goal={g} onClick={() => onEditGoal(g)} />)}
          </Panel>
        </Block>
      )}

      <Explore onOpen={setOpen} />
    </div>
  );
}
