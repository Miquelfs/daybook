"use client";

import { format, parseISO } from "date-fns";
import type { Goal } from "@/lib/plans-api";
import { STATE_STYLE, goalSummary } from "./format";
import { area, tint } from "./areas";

export function GoalCard({ goal: g, onClick, compact }: { goal: Goal; onClick?: () => void; compact?: boolean }) {
  const st = STATE_STYLE[g.state];
  const a = area(g.area);
  const faded = g.state === "dropped" || g.state === "missed";
  // Pace marker: where the straight line says you should be by now.
  const pace = g.expected != null && g.target
    ? Math.min(100, Math.max(0, g.kind === "level" && g.compare != null
        ? ((g.expected - g.compare) / (g.target - g.compare)) * 100
        : (g.expected / g.target) * 100))
    : null;
  const bar = g.kind === "ceiling" ? (g.state === "behind" ? "#E11D48" : a.color) : a.color;
  // "Fewer than last year" has no target — fill against last year's count instead.
  const pct = g.pct ?? (g.kind === "ceiling" && g.compare && g.actual != null
    ? Math.min(100, Math.round((g.actual / g.compare) * 100)) : null);

  return (
    <button
      onClick={onClick}
      className={`w-full text-left bg-[#0D0D0F] border border-[#27272A] hover:border-[#3F3F46] rounded-2xl p-3.5 flex gap-3 transition-colors ${faded ? "opacity-55" : ""}`}
    >
      <span className="shrink-0 w-11 h-11 rounded-xl flex items-center justify-center text-xl"
            style={{ background: tint(a.color, 0.16) }}>
        {g.emoji || a.emoji}
      </span>

      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold text-[#FAFAFA] leading-snug">
            {g.title}
            {g.priority === 3 && <span className="ml-1 text-[11px]" title="Very important">⭐</span>}
          </p>
          <span className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
        </div>

        {pct != null && (
          <div className="relative h-2 rounded-full bg-[#18181B] overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(pct, 2)}%`, background: bar }} />
            {pace != null && (
              <div className="absolute -top-0.5 h-3 w-0.5 rounded bg-[#D4D4D8]" style={{ left: `calc(${pace}% - 1px)` }}
                   title="Where the pace says you should be" />
            )}
          </div>
        )}

        {!compact && (
          <div className="flex items-start justify-between gap-2 text-xs">
            <span className="text-[#A1A1AA] tabular-nums line-clamp-2">{goalSummary(g)}</span>
            {g.deadline && <span className="text-[#52525B] shrink-0">{format(parseISO(g.deadline), "d MMM")}</span>}
          </div>
        )}
      </div>
    </button>
  );
}
