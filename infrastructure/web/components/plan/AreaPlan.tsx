"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { plansApi, type Goal, type Task } from "@/lib/plans-api";
import { localISODate } from "@/lib/dates";
import { TaskRow } from "./TaskRow";
import { TaskSheet } from "./TaskSheet";
import { GoalCard } from "./GoalCard";
import { GoalSheet } from "./GoalSheet";
import { area as areaOf, tint, type AreaKey } from "./areas";

/**
 * The plan for one page — open tasks, notes and this year's goals tagged with
 * this area. Renders nothing when there are none, so pages stay clean.
 */
export function AreaPlan({ area, className }: { area: AreaKey; className?: string }) {
  const a = areaOf(area);
  const today = localISODate();
  const [task, setTask] = useState<Task | "new" | null>(null);
  const [goal, setGoal] = useState<Goal | null>(null);
  const { data } = useQuery({
    queryKey: ["area-plan", area],
    queryFn: () => plansApi.areaPlan(area),
    staleTime: 60_000,
  });

  if (!data || (data.tasks.length === 0 && data.goals.length === 0)) return null;

  return (
    <section className={`rounded-2xl border p-4 space-y-3 ${className ?? ""}`}
             style={{ borderColor: tint(a.color, 0.35), background: tint(a.color, 0.05) }}>
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.15em]" style={{ color: a.color }}>
          <a.icon size={14} strokeWidth={2} /> {a.label} plan
        </p>
        <div className="flex items-center gap-3 text-xs">
          <button onClick={() => setTask("new")} className="text-[#71717A] hover:text-[#FAFAFA]">+ Task</button>
          <Link href="/plan" className="text-[#52525B] hover:text-[#A1A1AA]">All →</Link>
        </div>
      </div>

      {data.goals.length > 0 && (
        <div className="space-y-2">
          {data.goals.map((g) => <GoalCard key={g.id} goal={g} onClick={() => setGoal(g)} />)}
        </div>
      )}

      {data.tasks.length > 0 && (
        <div className="divide-y divide-[#18181B]">
          {data.tasks.map((t) => <TaskRow key={t.id} task={t} today={today} onEdit={setTask} hideArea />)}
        </div>
      )}

      {task && (
        <TaskSheet task={task === "new" ? undefined : task} defaultArea={area} onClose={() => setTask(null)} />
      )}
      {goal && <GoalSheet goal={goal} year={new Date().getFullYear()} onClose={() => setGoal(null)} />}
    </section>
  );
}
