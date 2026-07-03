"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

type GoalProgress = {
  id: number;
  sport: string | null;
  metric: string;
  period: string;
  target: number;
  actual: number;
  pct: number;
  unit: string;
  period_start: string;
  period_end: string;
};

const SPORT_ICONS: Record<string, string> = {
  run: "🏃",
  ride: "🚴",
  swim: "🏊",
};

const METRIC_LABELS: Record<string, string> = {
  distance: "Distance",
  time: "Time",
  tss: "TSS",
  sessions: "Sessions",
};

const PERIOD_LABELS: Record<string, string> = {
  week: "This week",
  month: "This month",
  year: "This year",
};

type GoalForm = {
  sport: string;
  metric: string;
  period: string;
  target: string;
};

function RingProgress({ pct, size = 60 }: { pct: number; size?: number }) {
  const r = (size - 8) / 2;
  const circumference = 2 * Math.PI * r;
  const filled = Math.min(1, pct / 100);
  const ringColor = pct >= 100 ? "#22C55E" : pct >= 75 ? "#F59E0B" : pct >= 50 ? "#3B82F6" : "#52525B";

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Track */}
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#27272A" strokeWidth={5} />
      {/* Progress */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={ringColor}
        strokeWidth={5}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - filled)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      {/* Percentage label */}
      <text
        x={size / 2}
        y={size / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={size * 0.22}
        fontWeight="600"
        fill={ringColor}
      >
        {pct >= 100 ? "✓" : `${pct}%`}
      </text>
    </svg>
  );
}

function AddGoalSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<GoalForm>({ sport: "run", metric: "distance", period: "week", target: "" });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof GoalForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    if (!form.target || isNaN(Number(form.target))) return;
    setSaving(true);
    try {
      const res = await fetch("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sport: form.sport || null, metric: form.metric, period: form.period, target: Number(form.target) }),
      });
      if (res.ok) { onSaved(); onClose(); }
    } finally { setSaving(false); }
  }

  const unitHint: Record<string, string> = { distance: "km", time: "hours", tss: "TSS points", sessions: "sessions" };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full sm:max-w-sm bg-[#09090B] border border-[#27272A] rounded-t-2xl sm:rounded-xl p-5 pb-8 sm:pb-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold">Add goal</h2>
          <button onClick={onClose} className="text-[#52525B] hover:text-[#A1A1AA] text-lg leading-none">×</button>
        </div>
        <div className="flex flex-col gap-3">
          {/* Sport */}
          <div>
            <label className="text-xs text-[#71717A] mb-1 block">Sport</label>
            <div className="flex gap-1.5 flex-wrap">
              {[["run", "🏃 Run"], ["ride", "🚴 Ride"], ["swim", "🏊 Swim"], ["", "All sports"]].map(([v, label]) => (
                <button key={v} type="button" onClick={() => set("sport", v)}
                  className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${form.sport === v ? "bg-[#F59E0B]/20 border-[#F59E0B]/60 text-[#F59E0B]" : "border-[#27272A] text-[#52525B] hover:text-[#A1A1AA]"}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {/* Metric */}
          <div>
            <label className="text-xs text-[#71717A] mb-1 block">Metric</label>
            <div className="flex gap-1.5 flex-wrap">
              {(["distance", "time", "tss", "sessions"] as const).map((m) => (
                <button key={m} type="button" onClick={() => set("metric", m)}
                  className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors capitalize ${form.metric === m ? "bg-[#F59E0B]/20 border-[#F59E0B]/60 text-[#F59E0B]" : "border-[#27272A] text-[#52525B] hover:text-[#A1A1AA]"}`}>
                  {METRIC_LABELS[m]}
                </button>
              ))}
            </div>
          </div>
          {/* Period */}
          <div>
            <label className="text-xs text-[#71717A] mb-1 block">Period</label>
            <div className="flex gap-1.5">
              {(["week", "month", "year"] as const).map((p) => (
                <button key={p} type="button" onClick={() => set("period", p)}
                  className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors capitalize ${form.period === p ? "bg-[#F59E0B]/20 border-[#F59E0B]/60 text-[#F59E0B]" : "border-[#27272A] text-[#52525B] hover:text-[#A1A1AA]"}`}>
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>
          </div>
          {/* Target */}
          <div>
            <label className="text-xs text-[#71717A] mb-1 block">Target ({unitHint[form.metric]})</label>
            <input
              type="number"
              min={0}
              step="0.1"
              className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B]"
              placeholder={form.metric === "distance" ? "50" : form.metric === "time" ? "10" : form.metric === "tss" ? "300" : "5"}
              value={form.target}
              onChange={(e) => set("target", e.target.value)}
            />
          </div>
          <button
            disabled={saving || !form.target}
            onClick={save}
            className="w-full bg-[#F59E0B] hover:bg-[#D97706] disabled:bg-[#27272A] disabled:text-[#52525B] text-[#09090B] font-semibold rounded-lg py-2.5 text-sm transition-colors mt-1"
          >
            {saving ? "Saving…" : "Add goal"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function GoalRings() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);

  const { data: goals = [], isLoading } = useQuery<GoalProgress[]>({
    queryKey: ["goals-progress"],
    queryFn: () => fetch("/api/goals").then((r) => r.json()),
    staleTime: 60_000,
  });

  async function deleteGoal(id: number) {
    await fetch(`/api/goals/${id}`, { method: "DELETE" });
    qc.invalidateQueries({ queryKey: ["goals-progress"] });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs text-[#52525B] uppercase tracking-widest">Goals</h2>
        <button
          onClick={() => setShowAdd(true)}
          className="text-xs bg-[#F59E0B]/10 border border-[#F59E0B]/30 text-[#F59E0B] hover:bg-[#F59E0B]/20 rounded-lg px-3 py-1.5 transition-colors"
        >
          + Add goal
        </button>
      </div>

      {isLoading ? (
        <p className="text-xs text-[#52525B]">Loading goals…</p>
      ) : goals.length === 0 ? (
        <p className="text-xs text-[#52525B]">No goals set. Add one to track your weekly, monthly, or annual targets.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {goals.map((g) => (
            <div key={g.id} className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-3 flex gap-3 items-center">
              <RingProgress pct={g.pct} size={56} />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-[#A1A1AA] truncate">
                  {g.sport ? (SPORT_ICONS[g.sport] ?? "") + " " : ""}{METRIC_LABELS[g.metric] ?? g.metric}
                </p>
                <p className="text-sm font-semibold tabular-nums text-[#FAFAFA]">
                  {g.actual} / {g.target} {g.unit}
                </p>
                <p className="text-xs text-[#52525B]">{PERIOD_LABELS[g.period] ?? g.period}</p>
              </div>
              <button
                onClick={() => deleteGoal(g.id)}
                className="text-[#3F3F46] hover:text-rose-400 text-lg leading-none shrink-0 self-start"
                title="Remove goal"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <AddGoalSheet
          onClose={() => setShowAdd(false)}
          onSaved={() => qc.invalidateQueries({ queryKey: ["goals-progress"] })}
        />
      )}
    </div>
  );
}
