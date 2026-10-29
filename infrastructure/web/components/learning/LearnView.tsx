"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { addWeeks, format, parseISO } from "date-fns";
import { Check, ChevronDown, ChevronUp, Flag, GraduationCap, Minus, Plus, Settings2 } from "lucide-react";
import { Block, Label, Panel } from "@/components/plan/ui";
import {
  learningApi, LEARNING_KEYS, KIND_LABEL, fmtMinutes, weekSpan,
  type LearningItem, type LearningPhase, type LearningPlanDetail,
} from "@/lib/learning-api";
import { ItemSheet, PlanSheet } from "./LearnSheets";

type Editing = { planId: number; item?: LearningItem; phase?: LearningPhase } | null;

/** Plan → Learn: each learning plan as its roadmap — where you are, phases with their gates, every item. */
export function LearnView({ today }: { today: string }) {
  const { data: plans = [], isLoading } = useQuery({
    queryKey: ["learning-plans", today],
    queryFn: () => learningApi.plans(today),
    staleTime: 30_000,
  });
  const [editing, setEditing] = useState<Editing>(null);
  const [settings, setSettings] = useState<LearningPlanDetail | null>(null);

  if (!isLoading && plans.length === 0) {
    return (
      <div className="border border-dashed border-[#27272A] rounded-2xl px-6 py-10 text-center space-y-2">
        <GraduationCap size={22} strokeWidth={1.5} className="mx-auto text-[#3F3F46]" />
        <p className="text-sm text-[#71717A]">No learning plan yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-12">
      {plans.map((p) => (
        <PlanRoadmap key={p.plan.id} d={p} today={today}
                     onEdit={(item, phase) => setEditing({ planId: p.plan.id, item, phase })}
                     onSettings={() => setSettings(p)} />
      ))}
      {editing && (
        <ItemSheet planId={editing.planId} item={editing.item} phase={editing.phase} onClose={() => setEditing(null)} />
      )}
      {settings && <PlanSheet d={settings} onClose={() => setSettings(null)} />}
    </div>
  );
}

function PlanRoadmap({ d, today, onEdit, onSettings }: {
  d: LearningPlanDetail;
  today: string;
  onEdit: (item?: LearningItem, phase?: LearningPhase) => void;
  onSettings: () => void;
}) {
  const p = d.plan;
  const current = d.phases.find((ph) => ph.current);
  const [open, setOpen] = useState<Set<number>>(() => new Set(current ? [current.id] : []));
  const toggle = (id: number) => setOpen((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const wk = Math.max(0, Math.min(d.week, p.weeks));
  const thisWeek = d.hours_by_week[d.hours_by_week.length - 1]?.minutes ?? 0;

  return (
    <div className="space-y-8">
      <Panel className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.2em] text-[#71717A]">
              {p.emoji} {p.title}{p.status !== "active" ? ` · ${p.status}` : ""}
            </p>
            <p className="mt-1 flex items-baseline gap-2">
              <span className="text-4xl font-semibold tracking-tight tabular-nums">
                {d.week < 1 ? "—" : `Week ${d.week}`}
              </span>
              <span className="text-sm text-[#A1A1AA]">{d.week < 1 ? `starts ${p.start_date}` : `of ${p.weeks}`}</span>
            </p>
            {current && <p className="text-xs text-[#A1A1AA] mt-1">{current.title}</p>}
            <div className="h-1 w-40 bg-[#18181B] rounded-full mt-2">
              <div className="h-full rounded-full bg-[#52525B]" style={{ width: `${(wk / p.weeks) * 100}%` }} />
            </div>
          </div>
          <button onClick={onSettings} aria-label="Plan settings" className="text-[#52525B] hover:text-[#A1A1AA] shrink-0">
            <Settings2 size={16} />
          </button>
        </div>
        {p.goal && <p className="text-xs text-[#71717A] mt-4 leading-relaxed">{p.goal}</p>}
        <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-[#27272A]">
          <div>
            <Label>This week</Label>
            <p className="text-2xl font-semibold tabular-nums">
              {(thisWeek / 60).toFixed(thisWeek % 60 ? 1 : 0)}
              <span className="text-sm font-normal text-[#71717A]">{p.weekly_hours ? ` / ${p.weekly_hours}h` : "h"}</span>
            </p>
          </div>
          <div>
            <Label>Core done</Label>
            <p className="text-2xl font-semibold tabular-nums">
              {d.core_done}<span className="text-sm font-normal text-[#71717A]"> / {d.core_total}</span>
            </p>
          </div>
          <div>
            <Label>Gates</Label>
            <p className="text-2xl font-semibold tabular-nums">
              {d.gates_passed}<span className="text-sm font-normal text-[#71717A]"> / {d.phases.filter((ph) => ph.gate).length}</span>
            </p>
          </div>
        </div>
        {d.behind > 0 && (
          <p className="text-xs text-amber-400 mt-4">
            {d.behind} item{d.behind > 1 ? "s" : ""} past {d.behind > 1 ? "their" : "its"} week — move, park or drop (two-week rule).
          </p>
        )}
      </Panel>

      <HoursChart d={d} />

      {d.phases.map((ph) => {
        const isOpen = open.has(ph.id);
        const items = ph.items ?? [];
        const done = items.filter((i) => i.status !== "todo").length;
        return (
          <Block
            key={ph.id}
            title={
              <button onClick={() => toggle(ph.id)} className="inline-flex items-center gap-1.5 uppercase tracking-widest hover:text-[#A1A1AA] text-left">
                {isOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                <span>{ph.title}</span>
                {ph.current && <span className="text-[#F59E0B] normal-case tracking-normal">· now</span>}
                {ph.gate_passed_at && <Check size={12} className="text-emerald-400" />}
              </button>
            }
            action={<span className="text-[11px] text-[#52525B] tabular-nums shrink-0 ml-3">{done}/{items.length}</span>}
          >
            {isOpen && (
              <>
                {ph.summary && <p className="text-xs text-[#71717A] mb-3">{ph.summary}</p>}
                <Panel className="px-4 py-2">
                  <PhaseItems items={items} plan={d} today={today} onEdit={(i) => onEdit(i)} />
                  <button onClick={() => onEdit(undefined, ph)}
                          className="flex items-center gap-2 py-2.5 text-xs text-[#52525B] hover:text-[#F59E0B] border-t border-[#18181B] w-full">
                    <Plus size={13} /> Add to this phase
                  </button>
                  {ph.gate && <Gate phase={ph} today={today} />}
                </Panel>
              </>
            )}
          </Block>
        );
      })}

      <p className="text-[11px] text-[#52525B] leading-relaxed px-1">
        One primary source per topic · Core is needed for any robot, Pick only if it makes you curious, Later not now ·
        Two-week rule: if a resource hasn&apos;t produced something you built or can explain, drop or park it.
      </p>
    </div>
  );
}

function HoursChart({ d }: { d: LearningPlanDetail }) {
  const target = (d.plan.weekly_hours ?? 0) * 60;
  const max = Math.max(target, ...d.hours_by_week.map((w) => w.minutes), 60);
  return (
    <Block title="Hours per week" action={<span className="text-[11px] text-[#52525B]">{fmtMinutes(d.minutes_total)} total</span>}>
      <Panel className="px-4 pt-4 pb-3">
        <div className="relative h-24 flex items-end gap-2">
          {target > 0 && (
            <div className="absolute inset-x-0 border-t border-dashed border-[#3F3F46]" style={{ bottom: `${(target / max) * 100}%` }} />
          )}
          {d.hours_by_week.map((w) => (
            <div key={w.week} className="flex-1 h-full flex items-end" title={`Week ${w.week}: ${fmtMinutes(w.minutes)}`}>
              <div className={`w-full rounded-t ${w.week === d.week ? "bg-[#F59E0B]/70" : "bg-[#52525B]"}`}
                   style={{ height: `${Math.max(w.minutes ? 3 : 0, (w.minutes / max) * 100)}%` }} />
            </div>
          ))}
        </div>
        <div className="flex gap-2 mt-1.5">
          {d.hours_by_week.map((w) => (
            <p key={w.week} className="flex-1 text-center text-[10px] text-[#52525B] tabular-nums">{w.week}</p>
          ))}
        </div>
      </Panel>
    </Block>
  );
}

function PhaseItems({ items, plan, today, onEdit }: {
  items: LearningItem[];
  plan: LearningPlanDetail;
  today: string;
  onEdit: (i: LearningItem) => void;
}) {
  // Grouped by the week they start; "any time" last.
  const groups = new Map<number | null, LearningItem[]>();
  for (const i of items) {
    if (!groups.has(i.week)) groups.set(i.week, []);
    groups.get(i.week)!.push(i);
  }
  const start = parseISO(plan.plan.start_date);
  return (
    <div>
      {[...groups.entries()].map(([week, list]) => (
        <div key={week ?? "any"} className="pt-2">
          <p className={`text-[10px] uppercase tracking-widest ${week === plan.week ? "text-[#F59E0B]" : "text-[#52525B]"}`}>
            {week == null ? "Any time" : `Week ${week} · ${format(addWeeks(start, week - 1), "d MMM")}`}
          </p>
          <div className="divide-y divide-[#18181B]">
            {list.map((i) => <RoadmapItem key={i.id} item={i} today={today} onEdit={() => onEdit(i)} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

function RoadmapItem({ item: i, today, onEdit }: { item: LearningItem; today: string; onEdit: () => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const closed = i.status !== "todo";
  async function toggle() {
    setBusy(true);
    try {
      await learningApi.setStatus(i.id, closed ? "todo" : "done", today);
      LEARNING_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [...k] }));
    } finally { setBusy(false); }
  }
  const span = i.weeks > 1 ? weekSpan(i) : null;
  const meta = [
    KIND_LABEL[i.kind],
    i.tier !== "core" && (i.tier === "pick" ? "Pick" : "Later"),
    i.resource,
    i.est_hours && `~${i.est_hours}h`,
    span,
    i.status === "done" && i.done_at && `done ${format(parseISO(i.done_at), "d MMM")}`,
    i.status === "skipped" && "dropped",
  ].filter(Boolean).join(" · ");

  return (
    <div className="flex items-start gap-3 py-2">
      <button onClick={toggle} disabled={busy} aria-label={closed ? "Re-open" : "Done"}
              className={`mt-0.5 w-5 h-5 shrink-0 rounded-full border flex items-center justify-center transition-colors ${
                i.status === "done" ? "bg-emerald-500/80 border-emerald-500"
                  : i.status === "skipped" ? "border-[#3F3F46] bg-[#18181B]"
                  : "border-[#3F3F46] hover:border-[#F59E0B]"} ${busy ? "opacity-40" : ""}`}>
        {i.status === "done" && <Check size={12} className="text-black" />}
        {i.status === "skipped" && <Minus size={12} className="text-[#52525B]" />}
      </button>
      <button onClick={onEdit} className="flex-1 min-w-0 text-left">
        <p className={`text-sm leading-snug ${closed ? "text-[#52525B] line-through" : i.tier === "later" ? "text-[#A1A1AA]" : "text-[#FAFAFA]"}`}>
          {i.title}
        </p>
        <p className="text-[11px] text-[#52525B] mt-0.5">
          {meta}
          {(i.state === "late" || i.state === "stale") && (
            <span className={i.state === "stale" ? "text-amber-400" : "text-[#A1A1AA]"}> · {i.state === "stale" ? "2+ weeks late" : "late"}</span>
          )}
        </p>
      </button>
    </div>
  );
}

function Gate({ phase, today }: { phase: LearningPhase; today: string }) {
  const qc = useQueryClient();
  const passed = !!phase.gate_passed_at;
  async function toggle() {
    await learningApi.passGate(phase.id, passed ? null : today);
    LEARNING_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [...k] }));
  }
  return (
    <div className="flex items-start gap-3 py-3 border-t border-[#18181B]">
      <Flag size={15} strokeWidth={1.75} className={`mt-0.5 shrink-0 ${passed ? "text-emerald-400" : "text-[#52525B]"}`} />
      <div className="flex-1 min-w-0">
        <p className="text-[10px] uppercase tracking-widest text-[#52525B]">Gate</p>
        <p className={`text-sm leading-snug mt-0.5 ${passed ? "text-[#A1A1AA]" : "text-[#FAFAFA]"}`}>{phase.gate}</p>
      </div>
      <button onClick={toggle}
              className={`shrink-0 text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                passed ? "border-emerald-500/40 text-emerald-400"
                  : "border-[#F59E0B]/30 text-[#F59E0B] bg-[#F59E0B]/10 hover:bg-[#F59E0B]/20"}`}>
        {passed ? `Passed ${format(parseISO(phase.gate_passed_at!), "d MMM")}` : "Mark passed"}
      </button>
    </div>
  );
}
