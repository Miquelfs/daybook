"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, GraduationCap, Plus, X } from "lucide-react";
import { LaneHeader, LaneLink } from "@/components/day/Lane";
import {
  learningApi, LEARNING_KEYS, fmtMinutes, type LearningDay, type LearningItem,
} from "@/lib/learning-api";

const SHOW = 4;
const LOG_CHOICES = [15, 30, 45, 60, 90, 120];

/**
 * The Learning lane: this week's items from each active plan (slipped ones first),
 * tick them off, log study time against the weekly target. On a past day it only
 * shows what got done and the time put in.
 */
export function DayLearning({ date, isToday }: { date: string; isToday: boolean }) {
  const { data = [] } = useQuery({
    queryKey: ["learning-day", date],
    queryFn: () => learningApi.day(date),
    staleTime: 0,
    retry: 1,
  });
  const shown = data.filter((d) => isToday || d.done_today.length > 0 || d.minutes_today > 0);
  if (shown.length === 0) return null;
  return (
    <>
      {shown.map((d) => <PlanLane key={d.plan.id} d={d} date={date} isToday={isToday} />)}
    </>
  );
}

function PlanLane({ d, date, isToday }: { d: LearningDay; date: string; isToday: boolean }) {
  const qc = useQueryClient();
  const [logging, setLogging] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const refresh = () => LEARNING_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [...k] }));

  async function run(id: number, fn: () => Promise<unknown>) {
    setBusy(id);
    try { await fn(); refresh(); } finally { setBusy(null); }
  }
  async function log(minutes: number) {
    setLogging(false);
    await learningApi.log({ plan_id: d.plan.id, date, minutes });
    refresh();
  }

  const p = d.plan;
  const link = (
    <LaneLink href="/plan?tab=learn">
      {p.emoji ? `${p.emoji} ` : ""}{p.title}{d.week >= 1 ? ` · wk ${d.week}/${p.weeks}` : ""} →
    </LaneLink>
  );

  if (!isToday) {
    return (
      <section>
        <LaneHeader icon={GraduationCap} label="Learning" action={link} />
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-2xl px-4 py-1.5 divide-y divide-[#18181B]">
          {d.done_today.map((i) => <ItemLine key={i.id} item={i} done />)}
          {d.minutes_today > 0 && (
            <p className="text-xs text-[#71717A] py-2">{fmtMinutes(d.minutes_today)} studied</p>
          )}
        </div>
      </section>
    );
  }

  if (d.week < 1) {
    return (
      <section>
        <LaneHeader icon={GraduationCap} label="Learning" action={link} />
        <p className="text-sm text-[#71717A] px-0.5">Starts {d.week_start}</p>
      </section>
    );
  }

  const rows: { item: LearningItem; done: boolean }[] = [
    ...d.done_today.map((item) => ({ item, done: true })),
    ...d.due.map((item) => ({ item, done: false })),
  ];
  const more = rows.length - SHOW;
  const target = (p.weekly_hours ?? 0) * 60;
  const pct = target > 0 ? Math.min(100, Math.round((d.minutes_week / target) * 100)) : 0;

  return (
    <section>
      <LaneHeader icon={GraduationCap} label="Learning" action={link} />
      <div className="bg-[#0D0D0F] border border-[#27272A] rounded-2xl overflow-hidden">
        {d.phase && (
          <div className="px-4 pt-3 pb-1 flex items-baseline justify-between gap-3">
            <p className="text-xs text-[#A1A1AA] truncate">{d.phase.title}</p>
            {d.week_total > 0 && (
              <p className="text-[11px] text-[#71717A] tabular-nums shrink-0">{d.week_done}/{d.week_total} this week</p>
            )}
          </div>
        )}

        <div className="px-4 divide-y divide-[#18181B]">
          {rows.length === 0 && (
            <p className="text-sm text-[#71717A] py-2.5">Week {d.week} is done — free exploration.</p>
          )}
          {rows.slice(0, SHOW).map(({ item, done }) => (
            <ItemLine
              key={item.id}
              item={item}
              done={done}
              busy={busy === item.id}
              onToggle={() => run(item.id, () => learningApi.setStatus(item.id, done ? "todo" : "done", date))}
              onMove={() => run(item.id, () => learningApi.updateItem(item.id, { week: d.week }))}
              onSkip={() => run(item.id, () => learningApi.setStatus(item.id, "skipped"))}
            />
          ))}
          {more > 0 && (
            <Link href="/plan?tab=learn" className="block py-2 text-[11px] text-[#71717A] hover:text-[#A1A1AA]">
              +{more} more this week →
            </Link>
          )}
        </div>

        <div className="px-4 py-3 border-t border-[#18181B]">
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-[#71717A] tabular-nums">
                This week <span className="text-[#FAFAFA]">{fmtMinutes(d.minutes_week)}</span>
                {target > 0 && <> / {p.weekly_hours}h</>}
                {d.minutes_today > 0 && <> · today {fmtMinutes(d.minutes_today)}</>}
              </p>
              {target > 0 && (
                <div className="h-1 bg-[#18181B] rounded-full mt-1.5">
                  <div className="h-full rounded-full bg-[#F59E0B]/70" style={{ width: `${pct}%` }} />
                </div>
              )}
            </div>
            <button onClick={() => setLogging((v) => !v)}
                    className="shrink-0 inline-flex items-center gap-1 text-xs text-[#F59E0B] hover:opacity-80">
              {logging ? <X size={13} /> : <Plus size={13} />} {logging ? "Cancel" : "Log time"}
            </button>
          </div>
          {logging && (
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {LOG_CHOICES.map((m) => (
                <button key={m} onClick={() => log(m)}
                        className="px-2.5 py-1 rounded-lg text-xs bg-[#18181B] text-[#A1A1AA] hover:bg-[#27272A] tabular-nums">
                  {fmtMinutes(m)}
                </button>
              ))}
            </div>
          )}
          {d.logs.length > 0 && !logging && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {d.logs.map((l) => (
                <button key={l.id} title="Remove this log"
                        onClick={() => run(-l.id, () => learningApi.deleteLog(l.id))}
                        className="group inline-flex items-center gap-1 text-[10px] text-[#71717A] border border-[#27272A] rounded-full px-2 py-0.5 hover:text-[#A1A1AA]">
                  {fmtMinutes(l.minutes)}{l.item_title ? ` · ${l.item_title}` : ""}
                  <X size={9} className="opacity-0 group-hover:opacity-100" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function ItemLine({ item: i, done, busy, onToggle, onMove, onSkip }: {
  item: LearningItem;
  done: boolean;
  busy?: boolean;
  onToggle?: () => void;
  onMove?: () => void;
  onSkip?: () => void;
}) {
  const slipped = !done && (i.state === "late" || i.state === "stale");
  const meta = [
    i.resource,
    i.tier === "pick" && "optional",
    !done && i.est_hours && `~${i.est_hours}h`,
  ].filter(Boolean).join(" · ");

  return (
    <div className="flex items-start gap-3 py-2">
      <button
        onClick={onToggle}
        disabled={busy || !onToggle}
        aria-label={done ? "Re-open" : "Done"}
        className={`mt-0.5 w-5 h-5 shrink-0 rounded-full border flex items-center justify-center transition-colors ${
          done ? "bg-emerald-500/80 border-emerald-500" : "border-[#3F3F46] hover:border-[#F59E0B]"
        } ${busy ? "opacity-40" : ""}`}
      >
        {done && <Check size={12} className="text-black" />}
      </button>
      <div className="flex-1 min-w-0">
        <p className={`text-sm leading-snug ${done ? "text-[#71717A] line-through" : "text-[#FAFAFA]"}`}>{i.title}</p>
        {!done && meta && <p className="text-[11px] text-[#71717A] mt-0.5 truncate">{meta}</p>}
        {slipped && (
          <p className="text-[11px] mt-0.5 flex flex-wrap items-center gap-x-2">
            <span className={i.state === "stale" ? "text-[#F59E0B]" : "text-[#71717A]"}>
              {i.state === "stale" ? `From wk ${i.week} — two-week rule:` : `From wk ${i.week}`}
            </span>
            {onMove && <button onClick={onMove} className="text-[#A1A1AA] hover:text-[#F59E0B]">move to this week</button>}
            {i.state === "stale" && onSkip && (
              <button onClick={onSkip} className="text-[#A1A1AA] hover:text-[#F59E0B]">drop</button>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
