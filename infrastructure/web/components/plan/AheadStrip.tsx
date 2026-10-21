"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, format, parseISO } from "date-fns";
import { Cake, Inbox, Plane, Plus, Target } from "lucide-react";
import { SectionLabel } from "@/components/MorningBrief";
import { plansApi, PLAN_KEYS, type Task } from "@/lib/plans-api";
import { TaskRow } from "./TaskRow";
import { TaskSheet } from "./TaskSheet";
import { dueLabel } from "./format";
import { area } from "./areas";

/**
 * Today's plan, kept calm: a birthday line when it's someone's day, one card
 * with what's due (overdue, today, notes resurfacing) + quick add, then a quiet
 * "next" list. Goals stay on the Plan page — Today only mentions them on
 * Mondays (a one-line weekly check) or when a deadline is within a week.
 * On a past day it becomes the record of what got done.
 */
export function AheadStrip({ date, isToday }: { date: string; isToday: boolean }) {
  return isToday ? <Ahead date={date} /> : <DoneOn date={date} />;
}

function Ahead({ date }: { date: string }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Task | null>(null);
  const [quick, setQuick] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: a } = useQuery({
    queryKey: ["agenda", date],
    queryFn: () => plansApi.agenda(date),
    staleTime: 0,
    retry: 2,
  });

  async function quickAdd() {
    if (!quick.trim()) return;
    setSaving(true);
    try {
      await plansApi.createTask({ title: quick.trim(), due_date: date });
      setQuick("");
      PLAN_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [...k] }));
    } finally {
      setSaving(false);
    }
  }

  if (!a) return null;
  const due = [...a.overdue, ...a.today, ...a.notes];
  const bdayToday = a.birthdays.filter((b) => b.days_until === 0);
  const next: { key: string; on: string; icon: React.ReactNode; label: string; when: string; warn?: boolean; onClick?: () => void; href?: string }[] = [
    ...a.birthdays.filter((b) => b.days_until > 0 && b.days_until <= 7).map((b) => ({
      key: `b${b.contact_id}`, on: b.date, icon: <Cake size={14} />, label: `${b.name.split(" ")[0]}'s birthday`,
      when: dueLabel(b.date, date), href: "/plan?tab=people",
    })),
    ...a.trips.filter((t) => t.days_until <= 30).map((t) => ({
      key: `p${t.id}`, on: t.start_date, icon: <Plane size={14} />, label: t.name,
      when: t.ongoing ? "now" : `in ${t.days_until}d`, warn: t.days_until <= 7, href: "/plan",
    })),
    ...a.upcoming.map((t) => {
      const Icon = area(t.area).icon;
      return {
        key: `t${t.id}`, on: t.due_date!, icon: <Icon size={14} strokeWidth={1.75} />, label: t.title,
        when: dueLabel(t.due_date!, date), warn: !!t.remind_days, onClick: () => setEditing(t),
      };
    }),
  ].sort((x, y) => x.on.localeCompare(y.on));

  const isMonday = parseISO(date).getDay() === 1;
  const weekLater = format(addDays(parseISO(date), 7), "yyyy-MM-dd");
  const deadlines = a.goals.due_soon.filter((g) => g.deadline! <= weekLater);

  return (
    <section>
      <div className="flex items-baseline justify-between">
        <SectionLabel>Today&apos;s plan</SectionLabel>
        <Link href="/plan" className="text-xs text-[#52525B] hover:text-[#A1A1AA]">Plan →</Link>
      </div>

      <div className="flex flex-col gap-3">
        {bdayToday.map((b) => (
          <div key={b.contact_id} className="flex items-center gap-3 px-1">
            <Cake size={16} className="text-[#F59E0B] shrink-0" />
            <p className="text-sm text-[#FAFAFA]">
              {b.name}{b.turning != null ? ` turns ${b.turning}` : "'s birthday"} today
              <span className="text-[#52525B]">
                {" · "}
                {b.days_since_seen == null ? "not logged together yet"
                  : b.days_since_seen === 0 ? "together today"
                  : `last together ${b.days_since_seen}d ago`}
              </span>
            </p>
          </div>
        ))}

        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-2xl px-4 py-1.5">
          {due.length > 0 && (
            <div className="divide-y divide-[#18181B] border-b border-[#18181B]">
              {due.map((t) => <TaskRow key={t.id} task={t} today={date} onEdit={setEditing} />)}
            </div>
          )}
          <div className="flex items-center gap-3 py-2">
            <Plus size={16} className="text-[#52525B] shrink-0 ml-0.5" />
            <input
              value={quick}
              onChange={(e) => setQuick(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); quickAdd(); } }}
              placeholder={due.length ? "Add something for today…" : "Nothing due today — add something…"}
              className="flex-1 bg-transparent py-1 text-sm text-[#FAFAFA] placeholder:text-[#3F3F46] outline-none"
            />
            {quick.trim() && (
              <button onClick={quickAdd} disabled={saving} className="text-xs font-medium text-[#F59E0B]">Add</button>
            )}
          </div>
        </div>

        {next.length > 0 && (
          <div className="px-1">
            <p className="text-[11px] uppercase tracking-wider text-[#52525B] mb-1">Next</p>
            <div className="flex flex-col">
              {next.map((n) => {
                const body = (
                  <>
                    <span className="text-[#52525B] shrink-0">{n.icon}</span>
                    <span className="flex-1 min-w-0 truncate text-sm text-[#A1A1AA]">{n.label}</span>
                    <span className={`text-xs tabular-nums shrink-0 ${n.warn ? "text-[#F59E0B]" : "text-[#52525B]"}`}>{n.when}</span>
                  </>
                );
                const cls = "flex items-center gap-3 py-1.5 text-left hover:opacity-80";
                return n.href
                  ? <Link key={n.key} href={n.href} className={cls}>{body}</Link>
                  : <button key={n.key} onClick={n.onClick} className={cls}>{body}</button>;
              })}
            </div>
          </div>
        )}

        {(deadlines.length > 0 || (isMonday && a.goals.total > 0)) && (
          <Link href="/plan" className="flex items-start gap-3 px-1 py-1 text-xs text-[#71717A] hover:text-[#A1A1AA]">
            <Target size={14} className="text-[#52525B] shrink-0 mt-0.5" />
            <span>
              {isMonday && <>Weekly check: {a.goals.on_track} of {a.goals.total} goals on track. </>}
              {deadlines.map((g) => `${g.title} due ${dueLabel(g.deadline!, date).toLowerCase()}`).join(" · ")}
            </span>
          </Link>
        )}

        {a.inbox_count > 0 && (
          <Link href="/plan?tab=tasks" className="flex items-center gap-3 px-1 text-[11px] text-[#52525B] hover:text-[#A1A1AA]">
            <Inbox size={14} /> {a.inbox_count} undated in the inbox →
          </Link>
        )}
      </div>

      {editing && <TaskSheet task={editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

function DoneOn({ date }: { date: string }) {
  const { data: done = [] } = useQuery({
    queryKey: ["tasks", "done_on", date],
    queryFn: () => plansApi.tasks({ done_on: date }),
    staleTime: 60_000,
  });
  if (done.length === 0) return null;
  return (
    <section>
      <SectionLabel>Got done</SectionLabel>
      <div className="bg-[#0D0D0F] border border-[#27272A] rounded-2xl px-4 py-1.5 divide-y divide-[#18181B]">
        {done.map((t) => <TaskRow key={t.id} task={t} today={date} />)}
      </div>
    </section>
  );
}
