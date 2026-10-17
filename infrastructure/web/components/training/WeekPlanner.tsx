"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X, ChevronLeft, ChevronRight, Wand2, Check, Ban } from "lucide-react";
import { localISODate } from "@/lib/dates";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const ZONE_COLOUR: Record<string, string> = {
  Z1: "#A1A1AA", Z2: "#4ADE80", Z3: "#FB923C", Z4: "#F87171", Z5: "#FCA5A5",
};

interface PlannerSession {
  id: number;
  session_type: string;
  session_date: string;
  effective_duration_min: number;
  intensity_zone: string;
  is_optional: boolean;
  is_displaced: boolean;
  status: string;
  schedule_note?: string | null;
  on_garmin?: boolean;
}

interface PlannerDay {
  date: string;
  day_name: string;
  sessions: PlannerSession[];
  context: {
    label: string;
    window_min: number;
    intense_ok: boolean;
    blocked: boolean;
    woke_away: boolean;
  };
  block_note: string | null;
}

interface PlannerWeek {
  week_start: string;
  week_end: string;
  days: PlannerDay[];
  confirmed_at: string | null;
}

function addDays(iso: string, n: number) {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return localISODate(d);
}

function fmtWindow(min: number) {
  if (min >= 600) return "all day";
  if (min <= 0) return "no ride";
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")} free`;
}

/**
 * Sunday ritual: lay out next week around the roster. Move a session with its
 * day picker (it then stays put — the nightly re-plan respects hand moves),
 * block a day you can't train, let "Auto-arrange" redo the week from scratch,
 * and confirm when it looks right.
 */
export function WeekPlanner({ goalId, initialDate, onClose }: {
  goalId: number;
  initialDate: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [ref, setRef] = useState(initialDate);
  const [busy, setBusy] = useState(false);

  const { data, refetch } = useQuery<PlannerWeek>({
    queryKey: ["omyra-planner", goalId, ref],
    queryFn: () =>
      fetch(`${BASE}/race-plans/goals/${goalId}/week?date=${ref}`, { cache: "no-store" }).then((r) => r.json()),
  });

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await refetch();
      qc.invalidateQueries({ queryKey: ["omyra-week", goalId] });
      qc.invalidateQueries({ queryKey: ["omyra-upcoming", goalId] });
      qc.invalidateQueries({ queryKey: ["omyra-all-sessions", goalId] });
      qc.invalidateQueries({ queryKey: ["planning-status"] });
    } finally {
      setBusy(false);
    }
  }

  const move = (s: PlannerSession, toDate: string) =>
    act(() =>
      fetch(`${BASE}/race-plans/sessions/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toDate === "skip" ? { status: "skipped" } : { session_date: toDate }),
      }),
    );

  const toggleBlock = (d: PlannerDay) =>
    act(() => {
      if (d.context.blocked) {
        return fetch(`${BASE}/race-plans/day-blocks/${d.date}`, { method: "DELETE" });
      }
      const note = window.prompt(`Block ${d.day_name} ${d.date.slice(5)} — why? (optional)`) ?? "";
      return fetch(`${BASE}/race-plans/day-blocks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: d.date, note }),
      });
    });

  const autoArrange = () =>
    act(() =>
      fetch(`${BASE}/race-plans/goals/${goalId}/reflow?reset_week=${data?.week_start}`, { method: "POST" }),
    );

  const confirm = () =>
    act(() =>
      fetch(`${BASE}/race-plans/goals/${goalId}/week/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ week_start: data?.week_start }),
      }),
    );

  const days = data?.days ?? [];
  const today = localISODate();
  const totalMin = days.flatMap((d) => d.sessions)
    .filter((s) => s.status === "pending" || s.status === "completed")
    .reduce((n, s) => n + (s.effective_duration_min || 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#09090B]">
      <div className="flex items-center gap-3 px-4 py-4 border-b border-[#18181B]">
        <button onClick={onClose} className="text-[#52525B] hover:text-[#A1A1AA] p-1" aria-label="Close"><X size={18} /></button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#FAFAFA]">Plan the week</p>
          <p className="text-xs text-[#52525B]">
            {data ? `${data.week_start.slice(5)} → ${data.week_end.slice(5)} · ${Math.round(totalMin / 6) / 10}h planned` : "…"}
          </p>
        </div>
        <button onClick={() => setRef(addDays(ref, -7))} className="p-1.5 text-[#71717A] hover:text-[#FAFAFA]" aria-label="Previous week"><ChevronLeft size={16} /></button>
        <button onClick={() => setRef(addDays(ref, 7))} className="p-1.5 text-[#71717A] hover:text-[#FAFAFA]" aria-label="Next week"><ChevronRight size={16} /></button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2 pb-28">
        {days.map((d) => {
          const past = d.date < today;
          const live = d.sessions.filter((s) => s.status !== "skipped");
          return (
            <div
              key={d.date}
              className={`rounded-xl border px-3 py-2.5 ${
                d.context.blocked || d.context.woke_away
                  ? "border-[#3F3F46] bg-[#0D0D0F] opacity-70"
                  : "border-[#27272A] bg-[#0D0D0F]"
              } ${past ? "opacity-50" : ""}`}
            >
              <div className="flex items-center gap-2">
                <div className="w-12 shrink-0">
                  <p className="text-xs font-semibold text-[#FAFAFA]">{d.day_name.slice(0, 3)}</p>
                  <p className="text-[10px] text-[#52525B] tabular-nums">{d.date.slice(8)}/{d.date.slice(5, 7)}</p>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-[#A1A1AA] truncate">{d.context.label || "—"}</p>
                  <p className="text-[10px] text-[#52525B]">
                    {fmtWindow(d.context.window_min)}{d.context.window_min > 0 && !d.context.intense_ok ? " · easy only" : ""}
                  </p>
                </div>
                {!past && (
                  <button
                    onClick={() => toggleBlock(d)}
                    disabled={busy}
                    className={`shrink-0 flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border ${
                      d.context.blocked
                        ? "border-[#B45309] text-[#FCD34D]"
                        : "border-[#27272A] text-[#71717A] hover:text-[#A1A1AA]"
                    }`}
                  >
                    <Ban size={10} /> {d.context.blocked ? "Unblock" : "Block"}
                  </button>
                )}
              </div>

              {live.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  {live.map((s) => (
                    <div key={s.id} className="flex items-center gap-2 bg-[#18181B] rounded-lg px-2.5 py-1.5">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: ZONE_COLOUR[s.intensity_zone] ?? "#52525B" }} />
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs truncate ${s.status === "completed" ? "text-[#4ADE80]" : "text-[#E4E4E7]"}`}>
                          {s.status === "completed" ? "✓ " : ""}{s.session_type.replace(/^Cycling - /, "")}
                          {s.is_optional ? <span className="text-[#52525B]"> · optional</span> : null}
                        </p>
                        <p className="text-[10px] text-[#52525B]">
                          {s.effective_duration_min} min · {s.intensity_zone}{s.is_displaced ? " · moved by you" : ""}{s.on_garmin ? " · ⌚ on Garmin" : ""}
                        </p>
                      </div>
                      {s.status === "pending" && !past && (
                        <select
                          value={s.session_date}
                          disabled={busy}
                          onChange={(e) => move(s, e.target.value)}
                          className="shrink-0 bg-[#09090B] border border-[#27272A] rounded-md text-[11px] text-[#A1A1AA] px-1.5 py-1"
                          aria-label="Move to day"
                        >
                          {days.filter((o) => o.date >= today).map((o) => (
                            <option key={o.date} value={o.date}>{o.day_name.slice(0, 3)} {o.date.slice(8)}</option>
                          ))}
                          <option value="skip">Skip</option>
                        </select>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="fixed bottom-0 left-0 right-0 border-t border-[#18181B] bg-[#09090B] px-4 py-3 flex gap-2">
        <button
          onClick={autoArrange}
          disabled={busy || !data}
          className="flex-1 flex items-center justify-center gap-1.5 text-xs py-2.5 bg-[#18181B] border border-[#27272A] rounded-xl text-[#A1A1AA] hover:bg-[#27272A] disabled:opacity-50"
        >
          <Wand2 size={13} /> Auto-arrange
        </button>
        <button
          onClick={confirm}
          disabled={busy || !data}
          className={`flex-1 flex items-center justify-center gap-1.5 text-xs py-2.5 rounded-xl font-semibold disabled:opacity-50 ${
            data?.confirmed_at ? "bg-[#052E16] border border-[#14532D] text-[#4ADE80]" : "bg-[#F59E0B] text-[#09090B]"
          }`}
        >
          <Check size={13} /> {data?.confirmed_at ? "Week confirmed" : "Confirm week"}
        </button>
      </div>
    </div>
  );
}
