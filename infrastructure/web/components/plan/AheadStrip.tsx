"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { SectionLabel } from "@/components/MorningBrief";
import { plansApi, PLAN_KEYS, type Task } from "@/lib/plans-api";
import { TaskRow } from "./TaskRow";
import { TaskSheet } from "./TaskSheet";
import { Avatar } from "./Avatar";
import { dueLabel } from "./format";
import { area, tint } from "./areas";

/**
 * Today's plan: a birthday banner when it's someone's day, one card with what's
 * due (overdue, today, notes resurfacing) + quick add, then a single "coming up"
 * row and a goals line. On a past day it becomes the record of what got done.
 */
export function AheadStrip({ date, isToday }: { date: string; isToday: boolean }) {
  return isToday ? <Ahead date={date} /> : <DoneOn date={date} />;
}

function Chip({ color, children, onClick, href }: {
  color: string;
  children: React.ReactNode;
  onClick?: () => void;
  href?: string;
}) {
  const cls = "shrink-0 flex items-center gap-1.5 rounded-full pl-1 pr-3 py-1 text-xs whitespace-nowrap transition-opacity hover:opacity-80";
  const style = { background: tint(color, 0.12), color: "inherit" };
  return href
    ? <Link href={href} className={cls} style={style}>{children}</Link>
    : <button onClick={onClick} className={cls} style={style}>{children}</button>;
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
  const bdaySoon = a.birthdays.filter((b) => b.days_until > 0);
  const hasComing = a.upcoming.length > 0 || bdaySoon.length > 0;
  const g = a.goals;

  return (
    <section>
      <div className="flex items-baseline justify-between">
        <SectionLabel>Today&apos;s plan</SectionLabel>
        <Link href="/plan" className="text-xs text-[#52525B] hover:text-[#A1A1AA]">Plan →</Link>
      </div>

      <div className="flex flex-col gap-3">
        {bdayToday.map((b) => (
          <div key={b.contact_id} className="flex items-center gap-3 rounded-2xl px-4 py-3"
               style={{ background: tint(area("people").color, 0.14) }}>
            <Avatar name={b.name} emoji={b.emoji} size={40} ring />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[#FAFAFA]">
                🎂 {b.name}{b.turning != null ? ` turns ${b.turning}` : "'s birthday"} today
              </p>
              <p className="text-xs text-[#71717A]">
                {b.days_since_seen == null ? "Not logged together yet"
                  : b.days_since_seen === 0 ? "Together today"
                  : `Last together ${b.days_since_seen} days ago`}
                {b.days_together_this_year > 0 && ` · ${b.days_together_this_year} day${b.days_together_this_year === 1 ? "" : "s"} this year`}
              </p>
            </div>
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

        {hasComing && (
          <div className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden -mx-4 px-4">
            <span className="shrink-0 text-[11px] uppercase tracking-wider text-[#52525B] mr-1">Next</span>
            {bdaySoon.map((b) => (
              <Chip key={`b${b.contact_id}`} color={area("people").color} href="/plan?tab=people">
                <Avatar name={b.name} emoji={b.emoji} size={20} />
                <span className="text-[#D4D4D8]">🎂 {b.name.split(" ")[0]}</span>
                <span className="text-[#71717A]">{dueLabel(b.date, date)}</span>
              </Chip>
            ))}
            {a.upcoming.map((t) => {
              const ar = area(t.area);
              return (
                <Chip key={t.id} color={ar.color} onClick={() => setEditing(t)}>
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-[11px]"
                        style={{ background: tint(ar.color, 0.2) }}>{ar.emoji}</span>
                  <span className="text-[#D4D4D8] max-w-[11rem] truncate">{t.title}</span>
                  <span className={t.remind_days ? "text-[#F59E0B]" : "text-[#71717A]"}>{dueLabel(t.due_date!, date)}</span>
                </Chip>
              );
            })}
          </div>
        )}

        {g.total > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden -mx-4 px-4">
            <Link href="/plan" className="shrink-0 text-xs text-[#71717A] hover:text-[#A1A1AA] mr-1">
              🎯 <span className="tabular-nums">{g.on_track}/{g.total}</span> on track
            </Link>
            {[...g.behind, ...g.due_soon].map((goal) => {
              const ar = area(goal.area);
              const behind = goal.state === "behind" || goal.state === "overdue";
              return (
                <Chip key={goal.id} color={ar.color} href="/plan">
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-[11px]"
                        style={{ background: tint(ar.color, 0.2) }}>{goal.emoji || ar.emoji}</span>
                  <span className="text-[#D4D4D8] max-w-[10rem] truncate">{goal.title}</span>
                  <span className={behind ? "text-amber-400" : "text-[#71717A]"}>
                    {behind ? (goal.state === "overdue" ? "overdue" : "behind") : `due ${dueLabel(goal.deadline!, date)}`}
                  </span>
                </Chip>
              );
            })}
          </div>
        )}

        {a.inbox_count > 0 && (
          <Link href="/plan?tab=tasks" className="text-[11px] text-[#52525B] hover:text-[#A1A1AA]">
            📥 {a.inbox_count} undated in the inbox →
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
