"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, StickyNote } from "lucide-react";
import { plansApi, PLAN_KEYS, type Task } from "@/lib/plans-api";
import { taskMeta } from "./format";
import { area, tint } from "./areas";

/** One task / note: tap the circle to complete (a note is dismissed), the text to edit. */
export function TaskRow({ task: t, today, onEdit, hideArea }: {
  task: Task;
  today: string;
  onEdit?: (t: Task) => void;
  hideArea?: boolean;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const done = t.done_at != null;
  const overdue = !done && t.kind === "task" && t.due_date != null && t.due_date < today;
  const a = t.area ? area(t.area) : null;

  async function toggle() {
    setBusy(true);
    try {
      if (done) await plansApi.updateTask(t.id, { done_at: null });
      else await plansApi.completeTask(t.id, today);
      PLAN_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [...k] }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-start gap-3 py-2">
      <button
        onClick={toggle}
        disabled={busy}
        aria-label={done ? "Re-open" : t.kind === "note" ? "Dismiss" : "Done"}
        className={`mt-0.5 w-5 h-5 shrink-0 rounded-full border flex items-center justify-center transition-colors ${
          done ? "bg-emerald-500/80 border-emerald-500" : "border-[#3F3F46] hover:border-[#F59E0B]"
        } ${busy ? "opacity-40" : ""}`}
      >
        {done && <Check size={12} className="text-black" />}
      </button>
      {a && !hideArea && (
        <span className="shrink-0 w-6 h-6 -my-0.5 rounded-md flex items-center justify-center text-[13px]"
              style={{ background: tint(a.color, 0.16) }} title={a.label}>
          {a.emoji}
        </span>
      )}
      <button onClick={() => onEdit?.(t)} className="flex-1 min-w-0 text-left">
        <p className={`text-sm leading-snug ${done ? "text-[#52525B] line-through" : "text-[#FAFAFA]"}`}>
          {t.kind === "note" && <StickyNote size={12} className="inline mr-1.5 -mt-0.5 text-[#F59E0B]" />}
          {t.title}
        </p>
        {t.notes && !done && <p className="text-xs text-[#71717A] mt-0.5 whitespace-pre-line line-clamp-3">{t.notes}</p>}
        {!done && taskMeta(t, today).length > 0 && (
          <p className={`text-[11px] mt-0.5 ${overdue ? "text-rose-400" : "text-[#52525B]"}`}>
            {taskMeta(t, today).join(" · ")}
          </p>
        )}
      </button>
    </div>
  );
}
