"use client";

import { format, parseISO } from "date-fns";
import type { Goal } from "@/lib/plans-api";
import { METRIC_LABEL } from "@/lib/plans-api";
import { STATE_STYLE, goalSummary } from "./format";

export function GoalCard({ goal: g, onClick }: { goal: Goal; onClick?: () => void }) {
  const st = STATE_STYLE[g.state];
  const faded = g.state === "dropped" || g.state === "missed";
  // Fewer-is-better goals fill against their allowance (or last year), and the
  // marker is how much of it the elapsed time "allows".
  const ref = g.lower_is_better ? (g.target ?? g.compare) : g.target;
  const pct = g.pct ?? (ref && g.actual != null ? Math.min(100, Math.round((g.actual / ref) * 100)) : null);
  const pace = g.expected != null && ref ? Math.min(100, (g.expected / ref) * 100) : null;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left bg-[#0D0D0F] border border-[#27272A] hover:border-[#3F3F46] rounded-xl px-4 py-3 space-y-2 transition-colors ${faded ? "opacity-60" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-[#FAFAFA] leading-snug">
          {g.emoji && <span className="mr-1.5">{g.emoji}</span>}
          {g.title}
          {g.priority === 3 && <span className="ml-1.5 text-[#F59E0B]" title="Very important">•</span>}
        </p>
        <span className={`shrink-0 text-[11px] px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
      </div>

      {pct != null && (
        <div className="relative h-1.5 rounded-full bg-[#18181B] overflow-hidden">
          <div className={`h-full rounded-full ${st.bar}`} style={{ width: `${pct}%` }} />
          {pace != null && (
            <div className="absolute top-0 h-full w-0.5 bg-[#FAFAFA]/60" style={{ left: `${pace}%` }} title="Where the pace says you should be" />
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-[#A1A1AA] tabular-nums truncate">{goalSummary(g)}</span>
        <span className="text-[#52525B] shrink-0">
          {g.metric !== "manual" ? METRIC_LABEL[g.metric].split(" ")[0] + " · " : ""}
          {g.deadline ? format(parseISO(g.deadline), "d MMM") : ""}
        </span>
      </div>
    </button>
  );
}
