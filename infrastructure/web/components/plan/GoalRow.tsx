"use client";

import { format, parseISO } from "date-fns";
import { Check, Star } from "lucide-react";
import type { Goal, GoalState } from "@/lib/plans-api";
import { goalSummary } from "./format";
import { goalIcon } from "./areas";

// Status is the only colour on a goal — same palette as Omyra's form/readiness.
const STATE: Record<GoalState, { label: string; cls: string }> = {
  on_track:    { label: "On track",    cls: "text-emerald-400" },
  behind:      { label: "Behind",      cls: "text-amber-400" },
  achieved:    { label: "Achieved",    cls: "text-emerald-400" },
  missed:      { label: "Missed",      cls: "text-rose-400" },
  in_progress: { label: "In progress", cls: "text-[#71717A]" },
  overdue:     { label: "Overdue",     cls: "text-rose-400" },
  not_started: { label: "Not started", cls: "text-[#52525B]" },
  done:        { label: "Done",        cls: "text-emerald-400" },
  dropped:     { label: "Dropped",     cls: "text-[#52525B]" },
};

/** The goal's own emoji, else its tag's (🏋️ Gym), else the metric's line icon. */
export function GoalGlyph({ goal: g, size = 36 }: { goal: Goal; size?: number }) {
  const emoji = g.emoji || g.param_icon;
  const Icon = goalIcon(g.metric, g.area);
  return (
    <span className="shrink-0 rounded-xl bg-[#18181B] flex items-center justify-center text-[#A1A1AA]"
          style={{ width: size, height: size, fontSize: size * 0.5 }}>
      {emoji || <Icon size={size * 0.5} strokeWidth={1.75} />}
    </span>
  );
}

/**
 * One goal inside a Panel: glyph, title, status, an amber bar with the pace tick,
 * one line of meaning. Manual goals get a tick circle — that's how they're done.
 */
export function GoalRow({ goal: g, onClick, onTick }: { goal: Goal; onClick?: () => void; onTick?: (g: Goal) => void }) {
  const st = STATE[g.state];
  const faded = g.state === "dropped" || g.state === "missed";
  const pct = g.pct ?? (g.kind === "ceiling" && g.compare && g.actual != null
    ? Math.min(100, Math.round((g.actual / g.compare) * 100)) : null);
  const pace = g.expected != null && g.target
    ? Math.min(100, Math.max(0, g.kind === "level" && g.compare != null
        ? ((g.expected - g.compare) / (g.target - g.compare)) * 100
        : (g.expected / g.target) * 100))
    : null;
  const done = g.state === "achieved" || g.state === "done";

  const tickable = onTick && g.kind === "manual" && g.status !== "dropped";
  const ticked = g.status === "done";

  return (
    <div className={`flex items-center gap-3 py-3 first:pt-0 last:pb-0 ${faded ? "opacity-50" : ""}`}>
    <button onClick={onClick} className="flex-1 min-w-0 w-full text-left flex gap-3">
      <GoalGlyph goal={g} />
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm font-medium text-[#FAFAFA] truncate">
            {g.title}
            {g.priority === 3 && <Star size={10} className="inline ml-1.5 -mt-0.5 text-[#F59E0B] fill-current" aria-label="Very important" />}
          </p>
          <span className={`shrink-0 text-xs ${st.cls}`}>{st.label}</span>
        </div>
        {pct != null && (
          <div className="relative h-1.5 bg-[#18181B] rounded-full">
            <div className={`h-full rounded-full ${done ? "bg-emerald-500" : "bg-[#F59E0B]"}`} style={{ width: `${Math.max(pct, 2)}%` }} />
            {pace != null && !done && (
              <div className="absolute -top-0.5 h-2.5 w-px bg-[#A1A1AA]" style={{ left: `${pace}%` }} title="Where the pace says you should be" />
            )}
          </div>
        )}
        <div className="flex items-start justify-between gap-2 text-xs">
          <span className="text-[#71717A] tabular-nums line-clamp-2">{goalSummary(g)}</span>
          {g.deadline && <span className="text-[#52525B] shrink-0 tabular-nums">{format(parseISO(g.deadline), "d MMM")}</span>}
        </div>
      </div>
    </button>
    {tickable && (
      <button onClick={() => onTick!(g)} aria-label={ticked ? "Mark not done" : "Mark done"}
              className={`shrink-0 w-7 h-7 rounded-full border flex items-center justify-center transition-colors ${
                ticked ? "bg-emerald-500 border-emerald-500 text-black" : "border-[#3F3F46] text-transparent hover:border-emerald-500 hover:text-emerald-500"}`}>
        <Check size={14} strokeWidth={3} />
      </button>
    )}
    </div>
  );
}

