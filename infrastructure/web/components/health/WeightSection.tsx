"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ResponsiveContainer, ComposedChart, Line, Scatter, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceDot,
} from "recharts";
import { X } from "lucide-react";
import { localISODate } from "@/lib/dates";

type WeightEntry = { date: string; weight_kg: number; note: string | null; trend_kg?: number };
type WeightGoal = {
  goal_id: number; goal_name: string; target_kg: number | null; target_date: string; target_ftp_w: number | null;
  start_date: string; start_kg: number; should_be_kg: number; vs_plan_kg: number;
  status: "ahead" | "on_track" | "behind"; weeks_left: number; to_go_kg: number;
  needed_kg_week: number | null; projected_kg: number | null;
};
type WeightData = {
  entries: WeightEntry[];
  stats: { latest: number; latest_date: string; change: number | null; min: number; max: number; count: number } | null;
  analysis?: {
    trend_now?: number; rate_kg_week: number | null; days_since: number | null; goal: WeightGoal | null;
    wkg: { ftp_w: number; now: number; at_target_weight: number | null; target: number | null } | null;
  };
};

const TODAY = localISODate();
const AMBER = "#F59E0B";
const MUTED = "#71717A";
const DAY = 86400000;
const RANGES = [["3M", 92], ["6M", 183], ["1Y", 365], ["All", 0]] as const;

const ts = (d: string) => new Date(d + "T12:00:00").getTime();
const fmtDate = (t: number, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) =>
  new Date(t).toLocaleDateString("en-GB", opts);
const signed = (v: number, digits = 1) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(digits)}`;

type Pt = { t: number; weight?: number; trend?: number; plan?: number };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function WeightTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d: Pt = payload[0].payload;
  return (
    <div className="bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-xs shadow-lg tabular-nums">
      <p className="text-[#71717A] mb-1">{fmtDate(d.t, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</p>
      {d.weight != null && <p className="text-[#FAFAFA] font-semibold">{d.weight} kg weighed</p>}
      {d.trend != null && <p className="text-[#A1A1AA]">{d.trend.toFixed(1)} kg trend</p>}
      {d.plan != null && <p className="text-[#71717A]">{d.plan.toFixed(1)} kg on the goal line</p>}
    </div>
  );
}

function Tile({ label, value, unit, sub }: { label: string; value: string; unit?: string; sub?: React.ReactNode }) {
  return (
    <div className="bg-[#0D0D0F] border border-[#27272A] rounded-2xl px-4 py-3 min-w-0">
      <p className="text-[10px] text-[#52525B] uppercase tracking-widest mb-1">{label}</p>
      <p className="text-2xl font-semibold tabular-nums text-[#FAFAFA]">
        {value}{unit && <span className="text-sm text-[#71717A] ml-1">{unit}</span>}
      </p>
      {sub && <p className="text-[11px] text-[#71717A] mt-0.5">{sub}</p>}
    </div>
  );
}

function GoalEditor({ goal, onDone }: { goal: WeightGoal | null; onDone: () => void }) {
  const qc = useQueryClient();
  const [kg, setKg] = useState(goal?.target_kg ? String(goal.target_kg) : "");
  const [date, setDate] = useState(goal?.target_date ?? "");
  const [err, setErr] = useState<string | null>(null);
  if (!goal) return null;
  async function save() {
    const w = parseFloat(kg.replace(",", "."));
    if (!w || !date) return;
    setErr(null);
    const r = await fetch(`/api/race-plans/goals/${goal!.goal_id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_weight_kg: w, targets_date: date }),
    });
    if (!r.ok) { setErr("Couldn't save — try again."); return; }
    qc.invalidateQueries({ queryKey: ["weight"] });
    qc.invalidateQueries({ queryKey: ["race-overview"] });
    onDone();
  }
  return (
    <div className="flex flex-wrap items-center gap-2 mt-2">
      <input type="text" inputMode="decimal" value={kg} onChange={(e) => setKg(e.target.value.replace(/[^0-9.,]/g, ""))}
             className="w-20 bg-[#18181B] border border-[#27272A] rounded-lg px-2 py-1.5 text-sm outline-none focus:border-[#F59E0B]" />
      <span className="text-xs text-[#71717A]">kg by</span>
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
             className="bg-[#18181B] border border-[#27272A] rounded-lg px-2 py-1.5 text-sm outline-none focus:border-[#F59E0B]" />
      <button onClick={save} className="text-xs px-3 py-1.5 rounded-lg bg-[#F59E0B] text-[#18181B] font-medium">Save</button>
      <button onClick={onDone} className="text-xs text-[#71717A] hover:text-white">Cancel</button>
      {err && <span className="text-xs text-red-400">{err}</span>}
    </div>
  );
}

export function WeightSection() {
  const qc = useQueryClient();
  const [dateVal, setDateVal] = useState(TODAY);
  const [weightVal, setWeightVal] = useState("");
  const [range, setRange] = useState<number>(183);
  const [editGoal, setEditGoal] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const { data } = useQuery<WeightData>({
    queryKey: ["weight"],
    queryFn: () => fetch("/api/health/weight?days=3650").then((r) => r.json()),
  });

  const add = useMutation({
    mutationFn: (body: { date: string; weight_kg: number }) =>
      fetch("/api/health/weight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["weight"] });
      qc.invalidateQueries({ queryKey: ["race-overview"] });
      setWeightVal("");
    },
  });
  const del = useMutation({
    mutationFn: (date: string) => fetch(`/api/health/weight/${date}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["weight"] }),
  });

  const entries = useMemo(() => data?.entries ?? [], [data]);
  const stats = data?.stats;
  const a = data?.analysis;
  const goal = a?.goal ?? null;

  // One time axis: weigh-ins (dots), the trend (line) and the goal glide path (dashed) to the target date
  const { points, domain } = useMemo(() => {
    const now = ts(TODAY);
    const lo = range ? now - range * DAY : (entries[0] ? ts(entries[0].date) : now);
    const hi = goal ? Math.max(now, ts(goal.target_date)) : now;
    const pts: Pt[] = entries.filter((e) => ts(e.date) >= lo)
      .map((e) => ({ t: ts(e.date), weight: e.weight_kg, trend: e.trend_kg }));
    if (goal?.target_kg) {
      const t0 = ts(goal.start_date), t1 = ts(goal.target_date);
      const at = (t: number) => goal.start_kg + (goal.target_kg! - goal.start_kg) * Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
      for (const p of pts) if (p.t >= t0) p.plan = Math.round(at(p.t) * 100) / 100;
      for (const t of [Math.max(t0, lo), now, t1]) {
        if (!pts.some((p) => p.t === t)) pts.push({ t, plan: Math.round(at(t) * 100) / 100 });
      }
    }
    pts.sort((x, y) => x.t - y.t);
    return { points: pts, domain: [lo, hi] as [number, number] };
  }, [entries, goal, range]);

  function submit() {
    // Accept a comma decimal separator (es-ES phone keypads type "75,5").
    const w = parseFloat(weightVal.replace(",", "."));
    if (!w || w <= 0) return;
    add.mutate({ date: dateVal, weight_kg: Math.round(w * 10) / 10 });
  }

  const verdict = goal && {
    ahead: { text: `Ahead of plan — ${Math.abs(goal.vs_plan_kg).toFixed(1)} kg under the goal line`, color: "#4ADE80" },
    on_track: { text: "On track — right on the goal line", color: "#4ADE80" },
    behind: { text: `Behind by ${goal.vs_plan_kg.toFixed(1)} kg`, color: AMBER },
  }[goal.status];
  const recent = [...entries].reverse();

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs text-[#52525B] uppercase tracking-widest">Weight</h2>
        {goal && !editGoal && (
          <button onClick={() => setEditGoal(true)} className="text-[11px] text-[#71717A] hover:text-white">
            Goal {goal.target_kg} kg · {fmtDate(ts(goal.target_date))} ✎
          </button>
        )}
      </div>
      {editGoal && <GoalEditor goal={goal} onDone={() => setEditGoal(false)} />}

      <div className="flex gap-2 mb-4 mt-2">
        <input
          type="date"
          value={dateVal}
          onChange={(e) => setDateVal(e.target.value)}
          className="bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B] transition-colors"
        />
        <input
          type="text"
          inputMode="decimal"
          pattern="[0-9]*[.,]?[0-9]*"
          placeholder="kg"
          value={weightVal}
          onChange={(e) => setWeightVal(e.target.value.replace(/[^0-9.,]/g, ""))}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          className="w-24 bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder:text-[#3F3F46] outline-none focus:border-[#F59E0B] transition-colors"
        />
        <button
          onClick={submit}
          disabled={add.isPending || !weightVal}
          className="px-4 py-2 rounded-lg bg-[#F59E0B] text-[#18181B] text-sm font-medium hover:bg-[#FBBF24] transition-colors disabled:opacity-40"
        >
          {add.isPending ? "…" : "Log"}
        </button>
      </div>

      {stats ? (
        <>
          {a?.days_since != null && a.days_since >= 5 && (
            <p className="text-xs text-[#A1A1AA] mb-3">
              Last weigh-in {a.days_since} days ago. Weigh in 2–3× a week — mornings, after the toilet, before eating — and
              the trend line gets reliable within a couple of weeks.
            </p>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
            <Tile label="Trend" value={(a?.trend_now ?? stats.latest).toFixed(1)} unit="kg"
                  sub={`last weighed ${stats.latest} kg · ${fmtDate(ts(stats.latest_date))}`} />
            <Tile label="Rate" value={a?.rate_kg_week != null ? signed(a.rate_kg_week, 2) : "—"} unit={a?.rate_kg_week != null ? "kg/wk" : undefined}
                  sub={a?.rate_kg_week != null ? "last 6 weeks" : "needs 3 weigh-ins in 6 wk"} />
            {goal?.target_kg ? (
              <Tile label="To goal" value={goal.to_go_kg > 0 ? goal.to_go_kg.toFixed(1) : "0"} unit="kg"
                    sub={goal.needed_kg_week != null ? `${signed(goal.needed_kg_week, 2)} kg/wk for ${Math.round(goal.weeks_left)} wk` : "goal date reached"} />
            ) : (
              <Tile label="Change" value={stats.change != null ? signed(stats.change) : "—"} unit="kg" sub={`${stats.min}–${stats.max} kg range`} />
            )}
            <Tile label="W/kg" value={a?.wkg ? a.wkg.now.toFixed(2) : "—"}
                  sub={a?.wkg ? (a.wkg.at_target_weight
                    ? <>FTP {Math.round(a.wkg.ftp_w)} W · {a.wkg.at_target_weight.toFixed(2)} at goal weight{a.wkg.target ? ` · target ${a.wkg.target.toFixed(2)}` : ""}</>
                    : `FTP ${Math.round(a.wkg.ftp_w)} W`) : "set an FTP"} />
          </div>

          {goal && verdict && (
            <p className="text-xs mb-3 tabular-nums">
              <span style={{ color: verdict.color }}>● {verdict.text}</span>
              <span className="text-[#71717A]">
                {" "}· goal line {goal.should_be_kg.toFixed(1)} kg at your last weigh-in
                {goal.projected_kg != null && ` · at your current rate: ${goal.projected_kg.toFixed(1)} kg on ${fmtDate(ts(goal.target_date))}`}
              </span>
            </p>
          )}

          <div className="flex items-center justify-between mb-1">
            <div className="flex gap-3 text-[10px] text-[#71717A]">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: AMBER, opacity: 0.5 }} />weigh-in</span>
              <span className="flex items-center gap-1"><span className="w-3 h-0.5" style={{ background: AMBER }} />trend</span>
              {goal && <span className="flex items-center gap-1"><span className="w-3 border-t border-dashed" style={{ borderColor: MUTED }} />goal line</span>}
            </div>
            <div className="flex gap-1">
              {RANGES.map(([label, days]) => (
                <button key={label} onClick={() => setRange(days)}
                        className={`text-[10px] px-2 py-0.5 rounded-full ${range === days ? "bg-[#27272A] text-white" : "text-[#71717A] hover:text-white"}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {points.length > 1 && (
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid vertical={false} stroke="#27272A" strokeDasharray="3 3" />
                <XAxis dataKey="t" type="number" scale="time" domain={domain}
                       tickFormatter={(t) => fmtDate(t, { month: "short" })}
                       tick={{ fill: "#52525B", fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={30} />
                <YAxis domain={["dataMin - 1", "dataMax + 1"]} tick={{ fill: "#52525B", fontSize: 10 }} tickLine={false}
                       axisLine={false} width={36} tickFormatter={(v) => String(Math.round(v))} />
                <Tooltip content={<WeightTooltip />} cursor={{ stroke: "#3F3F46" }} />
                {goal && <Line dataKey="plan" stroke={MUTED} strokeWidth={1.5} strokeDasharray="4 4" dot={false}
                               connectNulls isAnimationActive={false} />}
                <Line dataKey="trend" stroke={AMBER} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                <Scatter dataKey="weight" fill={AMBER} fillOpacity={0.5} shape="circle" isAnimationActive={false} />
                {goal?.target_kg && (
                  <ReferenceDot x={ts(goal.target_date)} y={goal.target_kg} r={4} fill="#0D0D0F" stroke={MUTED} strokeWidth={2}
                                label={{ value: `${goal.target_kg} kg`, position: "left", fill: "#A1A1AA", fontSize: 10 }} />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          )}

          <div className="mt-3">
            <button onClick={() => setShowAll((v) => !v)} className="text-[11px] text-[#71717A] hover:text-white">
              {showAll ? "Hide weigh-ins" : `All weigh-ins (${entries.length})`}
            </button>
            {showAll && (
              <ul className="mt-2 divide-y divide-[#18181B] border border-[#27272A] rounded-xl overflow-hidden">
                {recent.map((e, i) => {
                  const prev = recent[i + 1];
                  return (
                    <li key={e.date} className="flex items-center gap-3 px-3 py-2 text-sm tabular-nums">
                      <span className="text-[#71717A] w-28">{fmtDate(ts(e.date), { weekday: "short", day: "numeric", month: "short" })}</span>
                      <span className="text-[#FAFAFA] font-medium">{e.weight_kg} kg</span>
                      <span className="text-xs text-[#71717A]">{prev ? signed(e.weight_kg - prev.weight_kg) : ""}</span>
                      <span className="text-xs text-[#52525B] flex-1">{e.trend_kg != null ? `trend ${e.trend_kg.toFixed(1)}` : ""}</span>
                      <button onClick={() => confirm(`Delete the ${e.date} weigh-in?`) && del.mutate(e.date)}
                              aria-label={`Delete ${e.date}`} className="text-[#52525B] hover:text-red-400">
                        <X size={14} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      ) : (
        <p className="text-sm text-[#52525B]">No weigh-ins yet — log your first above.</p>
      )}
    </section>
  );
}
