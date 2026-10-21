"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { plansApi, type Goal, type Task } from "@/lib/plans-api";
import { localISODate } from "@/lib/dates";
import { TaskRow } from "./TaskRow";
import { TaskSheet } from "./TaskSheet";
import { GoalRow } from "./GoalRow";
import { GoalSheet } from "./GoalSheet";
import { Block, Panel } from "./ui";
import { area as areaOf, type AreaKey } from "./areas";

/**
 * The plan for one page — this year's goals and the open tasks/notes tagged
 * with this area, as an Omyra-style block. Renders nothing when there are none.
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
    <div className={className}>
      <Block
        title={`Plan · ${a.label}`}
        action={
          <div className="flex items-center gap-3 text-xs">
            <button onClick={() => setTask("new")} className="text-[#52525B] hover:text-[#A1A1AA]">+ Task</button>
            <Link href="/plan" className="text-[#52525B] hover:text-[#A1A1AA]">All →</Link>
          </div>
        }
      >
        <Panel className="px-4 py-3 divide-y divide-[#18181B]">
          {data.goals.map((g) => <GoalRow key={g.id} goal={g} onClick={() => setGoal(g)} />)}
          {data.tasks.length > 0 && (
            <div className={data.goals.length ? "pt-2" : ""}>
              {data.tasks.map((t) => <TaskRow key={t.id} task={t} today={today} onEdit={setTask} hideArea />)}
            </div>
          )}
        </Panel>
      </Block>

      {task && (
        <TaskSheet task={task === "new" ? undefined : task} defaultArea={area} onClose={() => setTask(null)} />
      )}
      {goal && <GoalSheet goal={goal} year={new Date().getFullYear()} onClose={() => setGoal(null)} />}
    </div>
  );
}
