"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { format, parseISO } from "date-fns";
import { HealthTabs } from "@/components/health/HealthTabs";
import { Empty, PageHeader, Skeleton } from "@/components/ui/kit";
import { api, type SleepNightDetail } from "@/lib/api";
import { todayIn } from "@/lib/dates";
import { NightHero, NightHrvBlock, NightScore, NightTimeline } from "@/components/sleep/NightView";

/** One night (the date is the morning you woke up) — where the morning brief's Sleep and HRV lead. */
export default function SleepNightPage() {
  const { date } = useParams<{ date: string }>();
  const [d, setD] = useState<SleepNightDetail | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "none">("loading");

  useEffect(() => {
    setState("loading");
    api.sleepNight(date).then((x) => { setD(x); setState("ok"); }).catch(() => { setD(null); setState("none"); });
  }, [date]);

  useEffect(() => {
    if (state === "ok" && window.location.hash === "#hrv") document.getElementById("hrv")?.scrollIntoView();
  }, [state]);

  const today = todayIn();
  const title = date === today ? "Last night" : format(parseISO(date), "EEE d MMM");
  const nav = (to: string | null | undefined, Icon: typeof ChevronLeft, label: string) =>
    to ? (
      <Link href={`/health/sleep/${to}`} aria-label={label}
            className="p-1.5 rounded-lg border border-[#27272A] text-[#71717A] hover:text-[#FAFAFA] transition-colors"><Icon size={14} /></Link>
    ) : <span className="p-1.5 rounded-lg border border-[#18181B] text-[#27272A]"><Icon size={14} /></span>;

  return (
    <main className="max-w-2xl mx-auto px-4 pb-20">
      <div className="pt-8">
        <PageHeader back={{ href: "/health/sleep", label: "Sleep" }} title={title}
                    subtitle={date === today ? format(parseISO(date), "EEEE d MMMM") : "The night that ended this morning"}
                    right={<div className="flex gap-1.5">{nav(d?.prev, ChevronLeft, "Night before")}{nav(d?.next, ChevronRight, "Night after")}</div>}
                    tabs={<HealthTabs active="/health/sleep" />} />
      </div>
      {state === "loading" ? (
        <div className="space-y-8"><Skeleton h={150} /><Skeleton h={260} /><Skeleton h={200} /></div>
      ) : state === "none" || !d ? (
        <Empty>No sleep recorded for this night yet. Garmin usually syncs it within the morning.</Empty>
      ) : (
        <div className="space-y-8">
          <NightHero d={d} />
          <NightTimeline d={d} />
          <NightHrvBlock h={d.hrv} date={d.date} />
          <NightScore d={d} />
          <p className="text-xs text-[#52525B]">
            <Link href={`/day/${d.date}`} className="hover:text-[#A1A1AA]">Open {format(parseISO(d.date), "EEE d MMM")} →</Link>
          </p>
        </div>
      )}
    </main>
  );
}
