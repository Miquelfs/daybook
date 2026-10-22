"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { sessionIcon } from "@/lib/sport";

type DaySession = {
  id: number; session_type: string; discipline: string; status: string; effective_duration_min: number | null;
  duration_min: number; intensity_zone: string; completed_activity_id: string | null; goal_name?: string;
};

const shift = (d: string, n: number) => {
  const x = new Date(d + "T12:00:00");
  x.setDate(x.getDate() + n);
  return x.toISOString().slice(0, 10);
};
const short = (t: string) => t.replace(/^Cycling - /, "").replace(/^Strength - /, "");

async function day(date: string): Promise<DaySession[]> {
  const r = await fetch(`/api/race-plans/day/${date}`, { cache: "no-store" });
  if (!r.ok) return [];
  const j = await r.json();
  return Array.isArray(j?.sessions) ? j.sessions.filter((s: DaySession) => s.status !== "displaced") : [];
}

/** Activity not linked to the plan yet → offer that day's sessions (or the day either side). */
export function PlanLinkCard({ activityId, date }: { activityId: string; date: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ["plan-link-candidates", date],
    queryFn: async () => {
      const same = await day(date);
      if (same.length) return { date, sessions: same };
      for (const n of [-1, 1]) {
        const other = await day(shift(date, n));
        if (other.length) return { date: shift(date, n), sessions: other };
      }
      return { date, sessions: [] as DaySession[] };
    },
  });
  if (!data || data.sessions.length === 0) return null;

  async function link(s: DaySession) {
    setBusy(s.id); setErr(null);
    try {
      const r = await fetch(`/api/race-plans/sessions/${s.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed_activity_id: activityId, status: "completed" }),
      });
      if (!r.ok) throw new Error();
      router.refresh();
    } catch { setErr("Couldn't link — try again."); }
    finally { setBusy(null); }
  }

  return (
    <section className="mb-8">
      <p className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Link to your plan</p>
      <div className="bg-[#0D0D0F] border border-[#F59E0B]/40 rounded-2xl overflow-hidden">
        <p className="px-4 pt-3 pb-2 text-sm text-[#A1A1AA]">
          Was this {data.date === date ? "today's" : new Date(data.date + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long" }) + "'s"} planned session? Link it so the plan counts it.
        </p>
        <div className="divide-y divide-[#18181B]">
          {data.sessions.map((s) => {
            const taken = s.completed_activity_id && s.completed_activity_id !== activityId;
            return (
              <div key={s.id} className="flex items-center gap-3 px-4 py-3">
                <span className="text-xl">{sessionIcon(s.discipline, s.session_type)}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{short(s.session_type)}</p>
                  <p className="text-xs text-[#71717A] tabular-nums">
                    {s.effective_duration_min ?? s.duration_min} min · {s.intensity_zone}
                    {taken ? " · already linked to another activity" : s.status === "skipped" ? " · marked skipped" : ""}
                  </p>
                </div>
                <button onClick={() => link(s)} disabled={busy != null}
                        className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#F59E0B] text-[#09090B] disabled:opacity-50">
                  {busy === s.id ? "Linking…" : taken ? "Link instead" : "Link"}
                </button>
              </div>
            );
          })}
        </div>
        {err && <p className="px-4 pb-3 text-xs text-rose-400">{err}</p>}
      </div>
    </section>
  );
}

/** Linked → which session it counts as, with an undo. */
export function LinkedPlanBar({ sessionId, sessionType, discipline }: { sessionId: number; sessionType: string; discipline: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function unlink() {
    setBusy(true);
    try {
      await fetch(`/api/race-plans/sessions/${sessionId}/unlink`, { method: "POST" });
      router.refresh();
    } finally { setBusy(false); }
  }
  return (
    <div className="flex items-center gap-2 mb-4 text-xs text-[#71717A]">
      <span>{sessionIcon(discipline, sessionType)}</span>
      <span>Counts as <span className="text-[#A1A1AA]">{short(sessionType)}</span> in your plan</span>
      <button onClick={unlink} disabled={busy} className="ml-auto hover:text-[#F59E0B] disabled:opacity-50">
        {busy ? "Unlinking…" : "Unlink"}
      </button>
    </div>
  );
}

type MatchSession = { id: number; session_type: string; session_date: string; intensity_zone: string; duration_min: number; score: number };
type PlanMatch = {
  activity: { intensity_zone: number | null; minutes: number };
  current: MatchSession | null;
  suggestion: MatchSession | null;
};

const weekday = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long" });

/** Linked, but the ride fits another session of the week better → offer to count it as that one. */
export function PlanMatchSuggestion({ activityId }: { activityId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const { data } = useQuery<PlanMatch | null>({
    queryKey: ["plan-match", activityId],
    queryFn: async () => {
      const r = await fetch(`/api/activities/${encodeURIComponent(activityId)}/plan-match`, { cache: "no-store" });
      return r.ok ? (await r.json()).match : null;
    },
  });
  const s = data?.suggestion, cur = data?.current;
  if (!s || dismissed) return null;

  async function swap() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/activities/${encodeURIComponent(activityId)}/plan-match`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session_id: s!.id }),
      });
      if (!r.ok) throw new Error();
      router.refresh();
    } catch { setErr("Couldn't relink — try again."); setBusy(false); }
  }

  const z = data!.activity.intensity_zone;
  return (
    <div className="bg-[#0D0D0F] border border-[#F59E0B]/40 rounded-2xl p-4 mb-6">
      <p className="text-[10px] text-[#52525B] uppercase tracking-widest mb-1">Fits another session better</p>
      <p className="text-sm text-[#A1A1AA]">
        You rode {data!.activity.minutes} min{z != null ? <> at about <b className="text-[#FAFAFA]">Z{z.toFixed(1)}</b></> : null} —
        closer to {weekday(s.session_date)}&apos;s <b className="text-[#FAFAFA]">{short(s.session_type)}</b>{" "}
        ({s.intensity_zone} · {s.duration_min} min, {Math.round(s.score * 100)}% fit)
        {cur ? <> than {short(cur.session_type)} ({cur.intensity_zone} · {cur.duration_min} min, {Math.round(cur.score * 100)}% fit)</> : null}.
      </p>
      {cur && (
        <p className="text-xs text-[#71717A] mt-1">
          {short(cur.session_type)} goes back to your plan{s.session_date > cur.session_date ? ` on ${weekday(s.session_date)}` : ""}, still to do.
        </p>
      )}
      <div className="flex items-center gap-3 mt-3">
        <button onClick={swap} disabled={busy}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#F59E0B] text-[#09090B] disabled:opacity-50">
          {busy ? "Relinking…" : `Count it as ${short(s.session_type)}`}
        </button>
        <button onClick={() => setDismissed(true)} className="text-xs text-[#71717A] hover:text-[#A1A1AA]">Keep as is</button>
      </div>
      {err && <p className="text-xs text-rose-400 mt-2">{err}</p>}
    </div>
  );
}
