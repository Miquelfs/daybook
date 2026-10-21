"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ArrowLeft, Cake, Check, ChevronRight, Search, Target } from "lucide-react";
import { api, type Contact } from "@/lib/api";
import { plansApi, type Goal, type Person } from "@/lib/plans-api";
import { Avatar } from "@/components/plan/Avatar";
import { GoalRow } from "@/components/plan/GoalRow";
import { birthdayInput } from "@/components/plan/format";
import { inputCls } from "@/components/plan/Sheet";
import { ActionButton, Block, Panel } from "@/components/plan/ui";
import { MonthBars, Stat, WeekdayBars, YearBars, YearHeatmap, YearSwitcher } from "@/components/plan/charts";

const pretty = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

function ago(days: number | null): string {
  if (days == null) return "never";
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

function refresh(qc: ReturnType<typeof useQueryClient>) {
  for (const k of ["contacts", "birthdays", "agenda", "people", "person"]) qc.invalidateQueries({ queryKey: [k] });
}

/** dd-mm-yyyy input that saves on blur. */
function BirthdayField({ contactId, stored, compact }: { contactId: number; stored: string | null | undefined; compact?: boolean }) {
  const qc = useQueryClient();
  const initial = birthdayInput(stored);
  const [value, setValue] = useState(initial);
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    if (value.trim() === initial) return;
    setError(false);
    try {
      await api.updateContact(contactId, { birthday: value.trim() || null });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      refresh(qc);
    } catch {
      setError(true);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <input value={value} onChange={(e) => setValue(e.target.value)} onBlur={save}
             onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
             placeholder="dd-mm-yyyy" inputMode="numeric" aria-label="Birthday"
             className={`${inputCls} ${compact ? "w-28" : "w-32"} py-1.5 text-xs text-center tabular-nums ${error ? "border-rose-500" : ""}`} />
      <span className="w-3">{saved && <Check size={12} className="text-emerald-400" />}</span>
    </span>
  );
}

// ── One person ───────────────────────────────────────────────────────────────

function PersonDetail({ id, goals, onBack, onMakeGoal, onEditGoal }: {
  id: number;
  goals: Goal[];
  onBack: () => void;
  onMakeGoal: (id: number, name: string) => void;
  onEditGoal: (g: Goal) => void;
}) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [editBday, setEditBday] = useState(false);
  const { data: p } = useQuery({ queryKey: ["person", id, year], queryFn: () => plansApi.person(id, year) });
  const linked = goals.filter((g) => g.metric === "person_days" && g.metric_param === String(id));

  if (!p) return <div className="h-64 rounded-2xl bg-[#18181B] animate-pulse" />;
  const diff = p.count - p.prev_same_period;
  const t = p.together;
  const hasTogether = t.tags.length || t.sports.length || t.tennis || t.restaurants.length || t.trips.length;

  return (
    <div className="space-y-8">
      <div>
        <button onClick={onBack} className="inline-flex items-center gap-1 text-xs text-[#71717A] hover:text-[#A1A1AA] uppercase tracking-widest mb-3">
          <ArrowLeft size={12} /> People
        </button>
        <div className="flex items-center gap-3">
          <Avatar name={p.name} emoji={p.emoji} size={52} />
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-semibold tracking-tight truncate">{p.name}</h2>
            <p className="text-xs text-[#71717A] capitalize">
              {p.group_ ?? "—"}{p.first ? ` · since ${format(parseISO(p.first), "MMM yyyy")}` : ""}
            </p>
          </div>
          {linked.length === 0 && <ActionButton icon={Target} onClick={() => onMakeGoal(p.id, p.name)}>Goal</ActionButton>}
        </div>
        <div className="mt-3 flex items-center gap-2 text-sm text-[#A1A1AA] min-h-8">
          <Cake size={14} className="text-[#52525B] shrink-0" />
          {editBday ? (
            <><BirthdayField contactId={p.id} stored={p.birthday?.stored} />
              <button onClick={() => setEditBday(false)} className="text-xs text-[#71717A]">Done</button></>
          ) : p.birthday ? (
            <button onClick={() => setEditBday(true)} className="text-left">
              {format(parseISO(p.birthday.next), "d MMMM")}
              {p.birthday.turning != null && ` · turns ${p.birthday.turning}`}
              <span className={p.birthday.days_until <= 7 ? "text-[#F59E0B]" : "text-[#52525B]"}>
                {" · "}{p.birthday.days_until === 0 ? "today" : `in ${p.birthday.days_until} days`}
              </span>
            </button>
          ) : (
            <button onClick={() => setEditBday(true)} className="text-xs text-[#52525B] hover:text-[#A1A1AA]">Add birthday</button>
          )}
        </div>
      </div>

      <Panel className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-[#71717A]">Days together · {year}</p>
            <p className="mt-1 flex items-baseline gap-2">
              <span className="text-4xl font-semibold tracking-tight tabular-nums">{p.count}</span>
              {p.prev_same_period > 0 || p.count > 0 ? (
                <span className={`text-sm ${diff > 0 ? "text-emerald-400" : diff < 0 ? "text-amber-400" : "text-[#71717A]"}`}>
                  {diff === 0 ? "same as" : `${diff > 0 ? "+" : ""}${diff} vs`} {year - 1} by now
                </span>
              ) : null}
            </p>
          </div>
          <YearSwitcher years={p.years} year={year} onChange={setYear} />
        </div>
        <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-[#27272A]">
          <Stat label="Per month" value={p.per_month ?? "—"} sub="days" />
          <Stat label="Of your days" value={`${p.share}%`} />
          <Stat label="Last" value={ago(p.days_since)} />
          <Stat label="Usually every" value={p.typical_gap != null ? `${p.typical_gap}d` : "—"} />
          <Stat label="Longest run" value={p.longest_run} sub="days in a row" />
          <Stat label="All time" value={p.total} sub="days" />
        </div>
      </Panel>

      {linked.length > 0 && (
        <Block title="Goals">
          <Panel className="px-4 py-3 divide-y divide-[#18181B]">
            {linked.map((g) => <GoalRow key={g.id} goal={g} onClick={() => onEditGoal(g)} />)}
          </Panel>
        </Block>
      )}

      <Block title="Calendar">
        <Panel className="p-4"><YearHeatmap dates={p.dates} year={year} /></Panel>
      </Block>

      {hasTogether ? (
        <Block title="Together" note="What the days with them hold.">
          <Panel className="p-4 space-y-4">
            {t.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {t.tags.map((x) => (
                  <span key={x.slug} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border border-[#27272A] text-[#A1A1AA]">
                    {x.icon && <span>{x.icon}</span>}{x.name}<span className="text-[#52525B] tabular-nums">{x.days}</span>
                  </span>
                ))}
              </div>
            )}
            {(t.sports.length > 0 || t.tennis) && (
              <div className="space-y-1">
                {t.sports.map((s) => (
                  <p key={s.type} className="flex justify-between text-sm"><span className="text-[#A1A1AA]">{pretty(s.type)}</span>
                    <span className="text-[#52525B] tabular-nums">{s.days} {s.days === 1 ? "day" : "days"}</span></p>
                ))}
                {t.tennis && (
                  <p className="text-xs text-[#71717A]">
                    Tennis: {t.tennis.sessions} sessions
                    {t.tennis.as_partner ? ` · ${t.tennis.as_partner} as partners` : ""}
                    {t.tennis.as_opponent ? ` · ${t.tennis.as_opponent} against` : ""}
                  </p>
                )}
              </div>
            )}
            {t.restaurants.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] text-[#52525B] uppercase tracking-widest">Restaurants</p>
                {t.restaurants.map((r) => (
                  <p key={r.id} className="flex justify-between gap-3 text-sm">
                    <span className="text-[#A1A1AA] truncate">{r.name}{r.city ? <span className="text-[#52525B]"> · {r.city}</span> : null}</span>
                    <span className="text-[#52525B] tabular-nums shrink-0">{format(parseISO(r.date_visited), "d MMM yy")}</span>
                  </p>
                ))}
              </div>
            )}
            {t.trips.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] text-[#52525B] uppercase tracking-widest">Trips</p>
                {t.trips.map((x) => (
                  <Link key={x.id} href={`/day/${x.start}`} className="flex justify-between gap-3 text-sm hover:opacity-80">
                    <span className="text-[#A1A1AA] truncate">{x.name ?? "Trip"}</span>
                    <span className="text-[#52525B] tabular-nums shrink-0">{format(parseISO(x.start), "d MMM yy")}</span>
                  </Link>
                ))}
              </div>
            )}
          </Panel>
        </Block>
      ) : null}

      <Block title="By month">
        <Panel className="p-4"><MonthBars counts={p.by_month} year={year} /></Panel>
      </Block>

      {p.by_year.length > 1 && (
        <Block title="Over the years">
          <Panel className="p-4"><YearBars data={p.by_year} /></Panel>
        </Block>
      )}

      <Block title="By weekday">
        <Panel className="p-4"><WeekdayBars counts={p.by_weekday} /></Panel>
      </Block>

      {p.recent.length > 0 && (
        <Block title="Recent days">
          <Panel className="px-4 py-1 divide-y divide-[#18181B]">
            {p.recent.map((d) => (
              <Link key={d} href={`/day/${d}`} className="flex items-center justify-between py-2.5 text-sm hover:opacity-80">
                <span className="text-[#A1A1AA]">{format(parseISO(d), "EEEE d MMM yyyy")}</span>
                <ChevronRight size={14} className="text-[#3F3F46]" />
              </Link>
            ))}
          </Panel>
        </Block>
      )}
    </div>
  );
}

// ── Everyone ─────────────────────────────────────────────────────────────────

function PersonRow({ p, onOpen }: { p: Person; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="w-full flex items-center gap-3 py-2.5 text-left">
      <Avatar name={p.name} emoji={p.emoji} size={36} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[#FAFAFA] truncate">{p.name}</p>
        <p className="text-[11px] text-[#52525B] truncate">
          {p.last ? `last together ${ago(p.days_since)}` : "not logged together yet"}
          {p.birthday && p.birthday.days_until <= 30 ? ` · birthday ${p.birthday.days_until === 0 ? "today" : `in ${p.birthday.days_until}d`}` : ""}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-semibold tabular-nums">{p.this_year}</p>
        <p className="text-[10px] text-[#52525B]">days</p>
      </div>
    </button>
  );
}

/** Plan → People: search everyone, open a person, upcoming birthdays, birthday editing. */
export function PeopleView({ onMakeGoal, onEditGoal }: {
  onMakeGoal: (id: number, name: string) => void;
  onEditGoal: (g: Goal) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const year = new Date().getFullYear();
  const { data: people = [], isLoading } = useQuery({ queryKey: ["people"], queryFn: () => plansApi.people() });
  const { data: contacts = [] } = useQuery({ queryKey: ["contacts"], queryFn: () => api.contacts(), enabled: editing });
  const { data: goals = [] } = useQuery({ queryKey: ["goals", year], queryFn: () => plansApi.goals(year) });

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? people.filter((p) => p.name.toLowerCase().includes(needle)) : people;
  }, [people, q]);
  const soon = people.filter((p) => p.birthday && p.birthday.days_until <= 30)
    .sort((a, b) => a.birthday!.days_until - b.birthday!.days_until);
  const missing = people.filter((p) => !p.birthday).length;

  if (open != null) {
    return <PersonDetail id={open} goals={goals} onBack={() => setOpen(null)} onMakeGoal={onMakeGoal} onEditGoal={onEditGoal} />;
  }

  const sorted = (cs: Contact[]) => [...cs.filter((c) => !c.birthday), ...cs.filter((c) => c.birthday)];

  return (
    <div className="space-y-8">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#52525B]" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people…"
               className={`${inputCls} pl-9`} />
      </div>

      {!q && soon.length > 0 && (
        <Block title="Birthdays coming up">
          <Panel className="px-4 py-1 divide-y divide-[#18181B]">
            {soon.map((p) => (
              <button key={p.id} onClick={() => setOpen(p.id)} className="w-full flex items-center gap-3 py-2.5 text-left">
                <Avatar name={p.name} emoji={p.emoji} size={32} ring={p.birthday!.days_until === 0} />
                <span className="flex-1 min-w-0 text-sm text-[#FAFAFA] truncate">
                  {p.name}{p.birthday!.turning != null && <span className="text-[#71717A]"> · turns {p.birthday!.turning}</span>}
                </span>
                <span className={`text-xs tabular-nums ${p.birthday!.days_until <= 7 ? "text-[#F59E0B]" : "text-[#52525B]"}`}>
                  {p.birthday!.days_until === 0 ? "Today" : format(parseISO(p.birthday!.next), "d MMM")}
                </span>
              </button>
            ))}
          </Panel>
        </Block>
      )}

      <Block title={q ? `${shown.length} found` : `Days together · ${year}`} action={
        <button onClick={() => setEditing((v) => !v)} className="text-xs text-[#52525B] hover:text-[#A1A1AA]">
          {editing ? "Done" : missing ? `Birthdays (${missing} missing)` : "Edit birthdays"}
        </button>
      }>
        {editing ? (
          <Panel className="px-4 py-2 divide-y divide-[#18181B]">
            <p className="text-[11px] text-[#52525B] py-1.5">dd-mm-yyyy, or dd-mm if you don&apos;t know the year.</p>
            {sorted(contacts).map((c) => (
              <div key={c.id} className="flex items-center gap-3 py-2">
                <Avatar name={c.name} emoji={c.emoji} size={28} />
                <span className="flex-1 min-w-0 text-sm text-[#FAFAFA] truncate">{c.name}</span>
                <BirthdayField contactId={c.id} stored={c.birthday} compact />
              </div>
            ))}
          </Panel>
        ) : isLoading ? (
          <div className="h-40 rounded-2xl bg-[#18181B] animate-pulse" />
        ) : shown.length === 0 ? (
          <p className="text-sm text-[#52525B] py-6 text-center">No one matches “{q}”.</p>
        ) : (
          <Panel className="px-4 py-1 divide-y divide-[#18181B]">
            {shown.map((p) => <PersonRow key={p.id} p={p} onOpen={() => setOpen(p.id)} />)}
          </Panel>
        )}
      </Block>
    </div>
  );
}
