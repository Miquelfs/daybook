"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ArrowLeft, Check, Flame, Target, X } from "lucide-react";
import { plansApi, type Goal, type Habit } from "@/lib/plans-api";
import { tagsApi } from "@/lib/tags-api";
import { localISODate } from "@/lib/dates";
import { GoalRow } from "@/components/plan/GoalRow";
import { ActionButton, Block, Panel, Pill } from "@/components/plan/ui";
import { MonthBars, Stat, WeekdayBars, YearHeatmap, YearSwitcher } from "@/components/plan/charts";

const DOW = ["S", "M", "T", "W", "T", "F", "S"];

function refreshAll(qc: ReturnType<typeof useQueryClient>, date?: string) {
  for (const k of ["habits", "habit", "goals", "agenda", "area-plan"]) qc.invalidateQueries({ queryKey: [k] });
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
                <p className="text-sm font-medium text-[#FAFAFA] truncate">{h.name}</p>
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
  const { data: h } = useQuery({ queryKey: ["habit", slug, year], queryFn: () => plansApi.habit(slug, year) });
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
          {linked.length === 0 && <ActionButton icon={Target} onClick={() => onMakeGoal(slug)}>Goal</ActionButton>}
        </div>
        <div className="flex gap-1.5 mt-3">
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
    </div>
  );
}

/**
 * The habit tracker: every tag you've used lately, with the last seven days
 * tappable, its streak and how often you've done it. Open one for its year.
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
      {habitGoals.length > 0 && (
        <Block title="Habit goals">
          <Panel className="px-4 py-3 divide-y divide-[#18181B]">
            {habitGoals.map((g) => <GoalRow key={g.id} goal={g} onClick={() => onEditGoal(g)} />)}
          </Panel>
        </Block>
      )}

      {isLoading && <div className="h-64 rounded-2xl bg-[#18181B] animate-pulse" />}

      {!isLoading && habits.length === 0 && (
        <div className="border border-dashed border-[#27272A] rounded-2xl px-6 py-10 text-center text-sm text-[#71717A]">
          Tag your days on Today — every tag becomes a habit here.
        </div>
      )}

      {doing.length > 0 && (
        <Block title="Doing" note="Tap a day to log it. Open a habit for its year, streaks and goal.">
          <HabitList habits={doing} onOpen={setOpen} />
        </Block>
      )}
      {cutting.length > 0 && (
        <Block title="Cutting down" note="Fewer is better — a filled day is a slip.">
          <HabitList habits={cutting} onOpen={setOpen} />
        </Block>
      )}
    </div>
  );
}
