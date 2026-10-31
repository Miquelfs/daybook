"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, ChevronRight, Gauge, ListChecks, Moon, PlaneTakeoff, Sun, type LucideIcon } from "lucide-react";
import { Panel } from "@/components/ui/kit";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Kind = "duty" | "train" | "rpe" | "sleep" | "free" | "task";
type Now = {
  date: string; time: string;
  head: { kind: Kind; title: string; detail: string; note?: string | null; href: string };
  next: { kind: Kind; text: string; href: string }[];
};

const ICON: Record<Kind, LucideIcon> = {
  duty: PlaneTakeoff, train: Activity, rpe: Gauge, sleep: Moon, free: Sun, task: ListChecks,
};

const clock = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** Today's "what now?" — the one time-sensitive thing at this moment (a report, a duty, a session
 *  to do or rate, an early night). Tasks and tomorrow's duty live in the Plan chapter below. */
export function NowCard({ date }: { date: string }) {
  const [time, setTime] = useState<string | null>(null);
  useEffect(() => {                                  // the phone's clock, not the Pi's
    setTime(clock());
    const id = setInterval(() => setTime(clock()), 5 * 60_000);
    return () => clearInterval(id);
  }, []);
  const { data } = useQuery<Now>({
    queryKey: ["now", date, time],
    queryFn: () => fetch(`${BASE}/now?date=${date}&time=${time}`).then((r) => r.json()),
    enabled: !!time,
    staleTime: 60_000,
  });
  // Only when something is time-sensitive; a free day is already told by the Plan below it.
  if (!data?.head || data.head.kind === "free") return null;
  const { head } = data;
  const Icon = ICON[head.kind] ?? Sun;

  return (
    <Panel className="overflow-hidden">
      <Link href={head.href} className="flex items-start gap-3 p-4 group">
        <span className="shrink-0 w-9 h-9 rounded-xl bg-[#F59E0B]/10 flex items-center justify-center mt-0.5">
          <Icon size={17} className="text-[#F59E0B]" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[10px] uppercase tracking-[0.2em] text-[#71717A]">Now · {data.time}</span>
          <span className="block text-lg font-semibold tracking-tight leading-snug mt-0.5">{head.title}</span>
          <span className="block text-sm text-[#A1A1AA]">{head.detail}</span>
          {head.note && <span className="block text-xs text-[#71717A] mt-1">{head.note}</span>}
        </span>
        <ChevronRight size={16} className="text-[#52525B] group-hover:text-[#A1A1AA] mt-3" />
      </Link>
    </Panel>
  );
}
