"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, RefreshCw, Check, X, FlaskConical, ArrowDown, ArrowUp } from "lucide-react";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Metric = { key: string; label: string; unit: string; this_week: number; normal: number; delta: number; z: number; verdict: "better" | "worse" | null };
type Lever = {
  driver: string; driver_label: string; outcome: string; outcome_label: string; when: string;
  delta: number; unit: string; with: number; without: number; n_with: number; n_without: number;
  t: number; strength: "strong" | "likely"; good: boolean; adjusted_for: string[] | null;
};
type Action = {
  title: string; why: string; type: "commit" | "experiment";
  experiment?: { title: string; hypothesis: string; tag: string | null; metric: string; days: number };
};
type Review = {
  id: number; week_start: string; created_at: string; headline: string; summary: string;
  patterns: { title: string; evidence: string; strength: "strong" | "likely" }[];
  actions: Action[]; last_week: string | null; action_status: Record<string, string>;
  week_vs_normal: Metric[]; levers: Lever[];
};
type Resp = { week_start: string; review: Review | null; previous: Review | null };

const fmtNum = (v: number, unit: string) =>
  unit === "" ? Math.round(v).toLocaleString() : `${v}${unit.startsWith("/") || unit === "h" ? "" : " "}${unit}`;
// Deltas on 1–10 scores read as points ("−2.0"), not "−2/10".
const fmtDelta = (v: number, unit: string) =>
  `${v > 0 ? "+" : ""}${unit.startsWith("/") ? v.toFixed(1) : fmtNum(v, unit)}`;
const fmtWeek = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`min-w-0 rounded-2xl border border-[#27272A] bg-[#0D0D0F] p-5 ${className}`}>{children}</section>;
}
function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] uppercase tracking-widest text-[#71717A] mb-3">{children}</p>;
}

// ── This week vs normal (computed, no AI) ────────────────────────────────────
function WeekVsNormal({ metrics }: { metrics: Metric[] }) {
  if (!metrics.length) return null;
  return (
    <Card>
      <Label>Last 7 days vs your normal</Label>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {metrics.slice(0, 9).map((m) => (
          <div key={m.key} className="rounded-xl bg-[#18181B] px-3 py-2.5">
            <p className="text-[10px] text-[#71717A]">{m.label}</p>
            <p className="text-base font-semibold tabular-nums text-[#FAFAFA]">{fmtNum(m.this_week, m.unit)}</p>
            <p className={`text-[11px] tabular-nums flex items-center gap-0.5 ${
              m.verdict === "better" ? "text-[#4ADE80]" : m.verdict === "worse" ? "text-[#F87171]" : "text-[#71717A]"}`}>
              {m.delta > 0 ? <ArrowUp size={10} /> : m.delta < 0 ? <ArrowDown size={10} /> : null}
              {fmtDelta(m.delta, m.unit)} <span className="text-[#52525B]">vs {fmtNum(m.normal, m.unit)}</span>
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Levers: what moves you (computed, no AI) ─────────────────────────────────
export function Levers({ levers }: { levers: Lever[] }) {
  if (!levers.length) {
    return (
      <Card>
        <Label>What moves your energy, mood, sleep and HRV</Label>
        <p className="text-sm text-[#71717A]">Not enough tagged days yet. Keep tagging days (alcohol, social, outdoors…) and patterns show up here.</p>
      </Card>
    );
  }
  const max = Math.max(...levers.map((l) => Math.abs(l.t)), 1);
  return (
    <Card>
      <Label>What moves your energy, mood, sleep and HRV</Label>
      <ul className="space-y-2.5">
        {levers.map((l, i) => (
          <li key={i} className="min-w-0">
            <div className="flex items-baseline gap-2">
              <p className="text-sm text-[#E4E4E7] flex-1 min-w-0">
                <span className="font-medium">{l.driver_label}</span>
                <span className="text-[#71717A]"> → {l.outcome_label} {l.when}</span>
              </p>
              <span className={`text-sm font-semibold tabular-nums ${l.good ? "text-[#4ADE80]" : "text-[#F87171]"}`}>
                {fmtDelta(l.delta, l.unit)}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <div className="h-1 flex-1 rounded-full bg-[#27272A] overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${(Math.abs(l.t) / max) * 100}%`, background: l.good ? "#4ADE80" : "#F87171" }} />
              </div>
              <span className="text-[10px] text-[#52525B] tabular-nums shrink-0">
                {fmtNum(l.with, l.unit)} vs {fmtNum(l.without, l.unit)} · {l.n_with}/{l.n_without} days · {l.strength}
              </span>
            </div>
            {l.adjusted_for && (
              <p className="text-[10px] text-[#52525B] mt-0.5">measured on days without: {l.adjusted_for.join(", ")}</p>
            )}
          </li>
        ))}
      </ul>
      <p className="text-[10px] text-[#52525B] mt-3">
        Last 6 months. Each line compares the day after (or the night of) the driver with all other days.
        Patterns that only co-occur with a stronger one are filtered out.
      </p>
    </Card>
  );
}

// ── The review ───────────────────────────────────────────────────────────────
export function WeeklyReview() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { data, refetch, isLoading } = useQuery<Resp>({
    queryKey: ["life-review"],
    queryFn: () => fetch(`${BASE}/insights/review`, { cache: "no-store" }).then((r) => r.json()),
  });
  const { data: computed } = useQuery<{ levers: Lever[]; week_vs_normal: Metric[] }>({
    queryKey: ["levers"],
    queryFn: () => fetch(`${BASE}/insights/levers`, { cache: "no-store" }).then((r) => r.json()),
    enabled: !!data && !data.review,          // show the computed part even before a review exists
  });

  async function generate() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`${BASE}/insights/review`, { method: "POST" });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.detail ?? "Review unavailable");
      await refetch();
    } catch (e) { setErr(e instanceof Error ? e.message : "Review unavailable"); }
    finally { setBusy(false); }
  }
  async function act(reviewId: number, i: number, status: string) {
    const r = await fetch(`${BASE}/insights/review/${reviewId}/actions/${i}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
    });
    if (!r.ok) setErr((await r.json().catch(() => null))?.detail ?? "Could not save");
    await refetch();
    if (status === "experiment") qc.invalidateQueries({ queryKey: ["experiments"] });
  }

  if (isLoading || !data) return <div className="h-40 rounded-2xl bg-[#18181B] animate-pulse" />;
  const rv = data.review;
  const prev = data.previous;
  const metrics = rv?.week_vs_normal ?? computed?.week_vs_normal ?? [];
  const levers = rv?.levers ?? computed?.levers ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-[#F59E0B]" />
            <p className="text-[10px] uppercase tracking-widest text-[#71717A]">Weekly review · week of {fmtWeek(data.week_start)}</p>
          </div>
          <button onClick={generate} disabled={busy} className="flex items-center gap-1.5 text-xs text-[#A1A1AA] hover:text-[#FAFAFA] disabled:opacity-50">
            <RefreshCw size={12} className={busy ? "animate-spin" : ""} />
            {busy ? "Reading your week…" : rv ? "Regenerate" : "Review my week"}
          </button>
        </div>
        {!rv ? (
          <p className="text-sm text-[#71717A]">
            Every Sunday the review reads your last 7 days against your normal and your personal levers below,
            then suggests at most three things for the coming week. Or run it now.
          </p>
        ) : (
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-[#FAFAFA]">{rv.headline}</h2>
              <p className="text-sm text-[#A1A1AA] leading-relaxed mt-1.5">{rv.summary}</p>
            </div>

            {rv.patterns.length > 0 && (
              <div className="space-y-2">
                {rv.patterns.map((p, i) => (
                  <div key={i} className="rounded-xl bg-[#18181B] px-3.5 py-2.5">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-[#E4E4E7] flex-1">{p.title}</p>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${p.strength === "strong" ? "bg-[#F59E0B]/15 text-[#F59E0B]" : "text-[#71717A]"}`}>{p.strength}</span>
                    </div>
                    <p className="text-[11px] text-[#71717A] mt-0.5">{p.evidence}</p>
                  </div>
                ))}
              </div>
            )}

            {rv.actions.length > 0 && (
              <div>
                <Label>This week</Label>
                <div className="space-y-2">
                  {rv.actions.map((a, i) => {
                    const st = rv.action_status[String(i)];
                    return (
                      <div key={i} className="rounded-xl border border-[#27272A] px-3.5 py-3">
                        <div className="flex items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium ${st === "done" ? "text-[#4ADE80]" : st === "skipped" ? "text-[#52525B] line-through" : "text-[#FAFAFA]"}`}>
                              {a.title}
                            </p>
                            <p className="text-[11px] text-[#71717A] mt-0.5">{a.why}</p>
                            {a.type === "experiment" && a.experiment && (
                              <p className="text-[11px] text-[#A1A1AA] mt-1.5 flex items-center gap-1">
                                <FlaskConical size={11} /> {a.experiment.days}-day experiment · measures {a.experiment.metric}
                                {a.experiment.tag ? ` · tag “${a.experiment.tag}” on treatment days` : ""}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5 mt-2.5">
                          {!st && a.type === "experiment" && (
                            <button onClick={() => act(rv.id, i, "experiment")}
                              className="text-[11px] px-2.5 py-1 rounded-lg bg-[#F59E0B] text-[#09090B] font-semibold">Start experiment</button>
                          )}
                          {!st && (
                            <button onClick={() => act(rv.id, i, "committed")}
                              className="text-[11px] px-2.5 py-1 rounded-lg bg-[#F59E0B]/10 border border-[#F59E0B]/30 text-[#F59E0B]">I'll do it</button>
                          )}
                          {st && st.startsWith("experiment") && (
                            <span className="text-[11px] text-[#4ADE80] flex items-center gap-1"><FlaskConical size={11} /> Running in Experiments</span>
                          )}
                          {st === "committed" && (
                            <>
                              <span className="text-[11px] text-[#A1A1AA] py-1">Committed:</span>
                              <button onClick={() => act(rv.id, i, "done")} className="text-[11px] px-2.5 py-1 rounded-lg bg-[#18181B] text-[#4ADE80] flex items-center gap-1"><Check size={11} /> Did it</button>
                              <button onClick={() => act(rv.id, i, "skipped")} className="text-[11px] px-2.5 py-1 rounded-lg bg-[#18181B] text-[#71717A] flex items-center gap-1"><X size={11} /> Didn't</button>
                            </>
                          )}
                          {(st === "done" || st === "skipped") && (
                            <span className={`text-[11px] ${st === "done" ? "text-[#4ADE80]" : "text-[#71717A]"}`}>{st === "done" ? "✓ Done" : "Skipped"}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {rv.last_week && <p className="text-xs text-[#71717A] border-t border-[#18181B] pt-3">Last week: {rv.last_week}</p>}
          </div>
        )}
        {err && <p className="text-xs text-[#F87171] mt-2">{err}</p>}
      </Card>

      {/* Last week's commitments still open → close the loop */}
      {prev && prev.actions.some((_, i) => prev.action_status[String(i)] === "committed") && (
        <Card>
          <Label>Last week — did you?</Label>
          <div className="space-y-2">
            {prev.actions.map((a, i) => prev.action_status[String(i)] === "committed" && (
              <div key={i} className="flex items-center gap-2">
                <p className="text-sm text-[#E4E4E7] flex-1 min-w-0">{a.title}</p>
                <button onClick={() => act(prev.id, i, "done")} className="text-[11px] px-2.5 py-1 rounded-lg bg-[#18181B] text-[#4ADE80]">Yes</button>
                <button onClick={() => act(prev.id, i, "skipped")} className="text-[11px] px-2.5 py-1 rounded-lg bg-[#18181B] text-[#71717A]">No</button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <WeekVsNormal metrics={metrics} />
      <Levers levers={levers} />
    </div>
  );
}
