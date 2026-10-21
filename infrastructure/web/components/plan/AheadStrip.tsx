"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { SectionLabel } from "@/components/MorningBrief";
import { plansApi, PLAN_KEYS, type Task } from "@/lib/plans-api";
import { TaskRow } from "./TaskRow";
import { TaskSheet } from "./TaskSheet";
import { dueLabel } from "./format";

/**
 * Today's look forward: birthdays, what's due / overdue, notes resurfacing,
 * what's coming up and goals that are slipping. On a past day it becomes the
 * record of what got done that day.
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
  const now = [...a.overdue, ...a.today];
  const slipping = a.goals.behind;

  return (
    <section>
      <div className="flex items-center justify-between">
        <SectionLabel>Ahead</SectionLabel>
        <Link href="/plan" className="text-xs text-[#52525B] hover:text-[#A1A1AA] -mt-4">Plan →</Link>
      </div>

      <div className="flex flex-col gap-4">
        {a.birthdays.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {a.birthdays.map((b) => (
              <div key={b.contact_id} className="flex items-center gap-3 bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-2.5">
                <span className="text-lg">🎂</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[#FAFAFA]">
                    {b.emoji && <span className="mr-1">{b.emoji}</span>}
                    {b.name}
                    {b.turning != null && <span className="text-[#71717A]"> turns {b.turning}</span>}
                    <span className={b.days_until === 0 ? "text-[#F59E0B] font-medium" : "text-[#71717A]"}>
                      {" · "}{b.days_until === 0 ? "today" : dueLabel(b.date, date).toLowerCase()}
                    </span>
                  </p>
                  <p className="text-[11px] text-[#52525B]">
                    {b.days_since_seen == null ? "Not logged together yet"
                      : b.days_since_seen === 0 ? "Together today"
                      : `Last together ${b.days_since_seen}d ago`}
                    {b.days_together_this_year > 0 && ` · ${b.days_together_this_year} days this year`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {(now.length > 0 || a.notes.length > 0) && (
          <div className="divide-y divide-[#18181B]">
            {now.map((t) => <TaskRow key={t.id} task={t} today={date} onEdit={setEditing} />)}
            {a.notes.map((t) => <TaskRow key={t.id} task={t} today={date} onEdit={setEditing} />)}
          </div>
        )}

        <div className="flex items-center gap-2">
          <input
            value={quick}
            onChange={(e) => setQuick(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); quickAdd(); } }}
            placeholder="Add something for today…"
            className="flex-1 bg-transparent border-b border-[#27272A] focus:border-[#F59E0B] px-0 py-1.5 text-sm text-[#FAFAFA] placeholder:text-[#3F3F46] outline-none transition-colors"
          />
          <button onClick={quickAdd} disabled={saving || !quick.trim()} aria-label="Add"
                  className="p-1.5 text-[#52525B] hover:text-[#F59E0B] disabled:opacity-30">
            <Plus size={16} />
          </button>
        </div>

        {a.upcoming.length > 0 && (
          <div>
            <p className="text-[11px] uppercase tracking-wider text-[#52525B] mb-1">Coming up</p>
            <div className="flex flex-col gap-1">
              {a.upcoming.map((t) => (
                <button key={t.id} onClick={() => setEditing(t)} className="flex items-center justify-between gap-3 text-left py-1">
                  <span className="text-sm text-[#D4D4D8] truncate">{t.title}</span>
                  <span className={`text-xs shrink-0 tabular-nums ${t.remind_days ? "text-[#F59E0B]" : "text-[#52525B]"}`}>
                    {dueLabel(t.due_date!, date)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {(slipping.length > 0 || a.goals.due_soon.length > 0) && (
          <Link href="/plan" className="block bg-[#0D0D0F] border border-[#27272A] hover:border-[#3F3F46] rounded-xl px-4 py-2.5 transition-colors">
            <p className="text-xs text-[#71717A]">
              🎯 {a.goals.on_track} on track
              {slipping.length > 0 && (
                <> · <span className="text-amber-400">behind:</span>{" "}
                  {slipping.map((g) => `${g.emoji ?? ""}${g.emoji ? " " : ""}${g.title}`).join(", ")}</>
              )}
            </p>
            {a.goals.due_soon.map((g) => (
              <p key={g.id} className="text-xs text-[#52525B] mt-0.5">
                ⏳ {g.title} — deadline {dueLabel(g.deadline!, date).toLowerCase()}
              </p>
            ))}
          </Link>
        )}

        {a.inbox_count > 0 && (
          <Link href="/plan?tab=tasks" className="text-[11px] text-[#52525B] hover:text-[#A1A1AA]">
            {a.inbox_count} undated in the inbox →
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
      <div className="divide-y divide-[#18181B]">
        {done.map((t) => <TaskRow key={t.id} task={t} today={date} />)}
      </div>
    </section>
  );
}
