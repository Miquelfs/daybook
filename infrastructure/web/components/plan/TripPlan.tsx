"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ArrowRight } from "lucide-react";
import { SectionLabel } from "@/components/MorningBrief";
import { plansApi } from "@/lib/plans-api";

/** On a detected trip: the plan it came from — budget, checklist, your day-by-day lines. */
export function TripPlan({ start, end }: { start: string; end: string }) {
  const { data: plan } = useQuery({
    queryKey: ["planned-trip", "for", start, end],
    queryFn: () => plansApi.planForTrip(start, end),
  });
  if (!plan) return null;
  const outlined = plan.days.filter((d) => d.note);

  return (
    <section>
      <div className="flex items-baseline justify-between">
        <SectionLabel>From your plan</SectionLabel>
        <Link href={`/plan/trip/${plan.id}`} className="text-xs text-[#52525B] hover:text-[#A1A1AA] inline-flex items-center gap-1">
          Plan <ArrowRight size={12} />
        </Link>
      </div>
      <div className="bg-[#0D0D0F] border border-[#27272A] rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {plan.budget != null && (
            <span className="text-[#A1A1AA]">Budget <span className="text-[#FAFAFA] font-semibold tabular-nums">€{Math.round(plan.budget).toLocaleString("en-GB")}</span>
              <span className="text-[#52525B]"> · spending below</span></span>
          )}
          {plan.checklist_total > 0 && (
            <span className="text-[#A1A1AA]">Checklist <span className="text-[#FAFAFA] font-semibold tabular-nums">{plan.checklist_done}/{plan.checklist_total}</span></span>
          )}
        </div>
        {outlined.length > 0 && (
          <div className="divide-y divide-[#18181B] border-t border-[#18181B]">
            {outlined.map((d) => (
              <Link key={d.date} href={`/day/${d.date}`} className="flex gap-3 py-2 text-sm hover:opacity-80">
                <span className="shrink-0 w-20 text-xs text-[#71717A] tabular-nums pt-0.5">{format(parseISO(d.date), "EEE d MMM")}</span>
                <span className="text-[#D4D4D8]">{d.note}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
