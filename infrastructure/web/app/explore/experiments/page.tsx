"use client";

import { useState, Suspense } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO, differenceInDays } from "date-fns";
import { Plus, X, FlaskConical, CheckCircle, Archive, Trash2 } from "lucide-react";

interface Experiment {
  id: string;
  title: string;
  hypothesis: string;
  protocol: string | null;
  tag: string | null;
  metric: string | null;
  outcome_threshold: number | null;
  condition_metric: string | null;
  condition_op: string | null;
  condition_value: number | null;
  start_date: string;
  end_date: string | null;
  status: string;    // active | concluded | abandoned
  result: string | null;
  effect_size: number | null;
  p_value: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const TODAY = new Date().toISOString().slice(0, 10);

// Outcome metrics available for experiments (mirrors backend _METRIC_MAP).
const METRIC_OPTIONS = [
  { value: "", label: "— Tag occurrence rate (no metric) —" },
  { value: "energy", label: "Energy" },
  { value: "mood", label: "Mood" },
  { value: "stress", label: "Stress" },
  { value: "sleep_quality", label: "Sleep quality" },
  { value: "hrv_avg", label: "HRV" },
  { value: "sleep_duration", label: "Sleep duration" },
  { value: "resting_hr", label: "Resting HR" },
  { value: "stress_avg", label: "Garmin stress" },
  { value: "battery_high", label: "Body battery" },
  { value: "steps", label: "Steps" },
  { value: "screen_total", label: "Screen time" },
  { value: "screen_unlocks", label: "Phone unlocks" },
  { value: "weight", label: "Weight" },
];

const STATUS_STYLE = {
  active:     { label: "Active",     dot: "bg-green-400",  text: "text-green-400",  badge: "bg-green-950 text-green-300" },
  concluded:  { label: "Concluded",  dot: "bg-blue-400",   text: "text-blue-400",   badge: "bg-blue-950 text-blue-300" },
  abandoned:  { label: "Abandoned",  dot: "bg-[#52525B]",  text: "text-[#71717A]",  badge: "bg-[#1a1a1a] text-[#52525B]" },
};

// ── Add / Edit Sheet ──────────────────────────────────────────────────────────

function ExperimentSheet({
  experiment,
  onClose,
  onSaved,
}: {
  experiment: Experiment | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = experiment != null;
  const [form, setForm] = useState({
    title: experiment?.title ?? "",
    hypothesis: experiment?.hypothesis ?? "",
    protocol: experiment?.protocol ?? "",
    tag: experiment?.tag ?? "",
    metric: experiment?.metric ?? "",
    condition_metric: experiment?.condition_metric ?? "",
    condition_op: experiment?.condition_op ?? "<",
    condition_value: experiment?.condition_value != null ? String(experiment.condition_value) : "",
    start_date: experiment?.start_date ?? TODAY,
    end_date: experiment?.end_date ?? "",
    notes: experiment?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(k: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));
  }

  async function handleSave() {
    if (!form.title.trim() || !form.hypothesis.trim()) return;
    setSaving(true);
    setError(null);
    const payload = {
      title: form.title.trim(),
      hypothesis: form.hypothesis.trim(),
      protocol: form.protocol.trim() || null,
      tag: form.tag.trim() || null,
      metric: form.metric || null,
      condition_metric: form.condition_metric || null,
      condition_op: form.condition_metric ? form.condition_op : null,
      condition_value: form.condition_metric && form.condition_value ? parseFloat(form.condition_value) : null,
      start_date: form.start_date,
      end_date: form.end_date || null,
      notes: form.notes.trim() || null,
    };
    try {
      const url = isEdit ? `/api/experiments/${experiment!.id}` : "/api/experiments";
      const method = isEdit ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end justify-center" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-[#0D0D0F] border border-[#27272A] rounded-t-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{isEdit ? "Edit experiment" : "New experiment"}</h2>
          <button onClick={onClose}><X size={18} className="text-[#52525B]" /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-[#71717A] mb-1 block">Title *</label>
            <input
              className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder:text-[#3F3F46] outline-none focus:border-[#F59E0B] transition-colors"
              placeholder="e.g. Cold shower morning protocol"
              value={form.title}
              onChange={set("title")}
              autoFocus
            />
          </div>

          <div>
            <label className="text-xs text-[#71717A] mb-1 block">Hypothesis *</label>
            <textarea
              className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder:text-[#3F3F46] outline-none focus:border-[#F59E0B] transition-colors resize-none"
              rows={2}
              placeholder="If I do X, then Y will improve because Z"
              value={form.hypothesis}
              onChange={set("hypothesis")}
            />
          </div>

          <div>
            <label className="text-xs text-[#71717A] mb-1 block">Protocol</label>
            <textarea
              className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder:text-[#3F3F46] outline-none focus:border-[#F59E0B] transition-colors resize-none"
              rows={2}
              placeholder="What exactly will you do, how often, for how long?"
              value={form.protocol}
              onChange={set("protocol")}
            />
          </div>

          <div>
            <label className="text-xs text-[#71717A] mb-1 block">Tracking tag</label>
            <input
              className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder:text-[#3F3F46] outline-none focus:border-[#F59E0B] transition-colors"
              placeholder="e.g. cold-shower (tag this on days you comply)"
              value={form.tag}
              onChange={set("tag")}
            />
          </div>

          <div className="border-t border-[#27272A] pt-3">
            <label className="text-xs text-[#71717A] mb-1 block">…or a metric condition (treatment = days meeting it)</label>
            <div className="flex gap-2">
              <select
                className="flex-1 bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B] transition-colors"
                value={form.condition_metric}
                onChange={set("condition_metric")}
              >
                <option value="">— none —</option>
                {METRIC_OPTIONS.filter((o) => o.value).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <select
                className="bg-[#18181B] border border-[#27272A] rounded-lg px-2 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B] transition-colors disabled:opacity-40"
                value={form.condition_op}
                onChange={set("condition_op")}
                disabled={!form.condition_metric}
              >
                <option value="<">{"<"}</option>
                <option value="<=">{"≤"}</option>
                <option value=">">{">"}</option>
                <option value=">=">{"≥"}</option>
              </select>
              <input
                type="number"
                inputMode="decimal"
                step="any"
                placeholder="value"
                value={form.condition_value}
                onChange={set("condition_value")}
                disabled={!form.condition_metric}
                className="w-20 bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder:text-[#3F3F46] outline-none focus:border-[#F59E0B] transition-colors disabled:opacity-40"
              />
            </div>
            <p className="text-[10px] text-[#3F3F46] mt-1">e.g. Screen time {"<"} 120 → treatment = your low-screen days.</p>
          </div>

          <div>
            <label className="text-xs text-[#71717A] mb-1 block">Outcome metric</label>
            <select
              className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B] transition-colors"
              value={form.metric}
              onChange={set("metric")}
            >
              {METRIC_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <p className="text-[10px] text-[#3F3F46] mt-1">What to measure on treatment vs. control days (e.g. Screen time, Energy).</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[#71717A] mb-1 block">Start date</label>
              <input
                type="date"
                className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B] transition-colors"
                value={form.start_date}
                onChange={set("start_date")}
              />
            </div>
            <div>
              <label className="text-xs text-[#71717A] mb-1 block">End date</label>
              <input
                type="date"
                className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B] transition-colors"
                value={form.end_date}
                onChange={set("end_date")}
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-[#71717A] mb-1 block">Notes</label>
            <textarea
              className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder:text-[#3F3F46] outline-none focus:border-[#F59E0B] transition-colors resize-none"
              rows={2}
              placeholder="Anything else relevant…"
              value={form.notes}
              onChange={set("notes")}
            />
          </div>
        </div>

        {error && <p className="text-red-400 text-xs">{error}</p>}

        <button
          onClick={handleSave}
          disabled={saving || !form.title.trim() || !form.hypothesis.trim()}
          className="w-full bg-[#F59E0B] text-black font-semibold rounded-xl py-3 text-sm disabled:opacity-40"
        >
          {saving ? "Saving…" : isEdit ? "Save changes" : "Start experiment"}
        </button>
      </div>
    </div>
  );
}

// ── Conclude Sheet ────────────────────────────────────────────────────────────

function ConcludeSheet({
  experiment,
  onClose,
  onSaved,
}: {
  experiment: Experiment;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [result, setResult] = useState(experiment.result ?? "");
  const [effectSize, setEffectSize] = useState(experiment.effect_size != null ? String(experiment.effect_size) : "");
  const [saving, setSaving] = useState(false);

  async function handleConclude() {
    setSaving(true);
    try {
      await fetch(`/api/experiments/${experiment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "concluded",
          result: result.trim() || null,
          effect_size: effectSize ? Number(effectSize) : null,
          end_date: experiment.end_date ?? TODAY,
        }),
      });
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function handleAbandon() {
    setSaving(true);
    try {
      await fetch(`/api/experiments/${experiment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "abandoned" }),
      });
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end justify-center" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-[#0D0D0F] border border-[#27272A] rounded-t-2xl p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Conclude: {experiment.title}</h2>
          <button onClick={onClose}><X size={18} className="text-[#52525B]" /></button>
        </div>

        <p className="text-xs text-[#71717A] italic">{experiment.hypothesis}</p>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-[#71717A] mb-1 block">Result / conclusion</label>
            <textarea
              className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder:text-[#3F3F46] outline-none focus:border-[#F59E0B] transition-colors resize-none"
              rows={3}
              placeholder="What did you find? Did the hypothesis hold?"
              value={result}
              onChange={(e) => setResult(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs text-[#71717A] mb-1 block">Effect size (Cohen's d, optional)</label>
            <input
              type="number"
              step="0.01"
              className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B] transition-colors"
              placeholder="e.g. 0.42"
              value={effectSize}
              onChange={(e) => setEffectSize(e.target.value)}
            />
            <p className="text-xs text-[#52525B] mt-1">{"< 0.2 negligible · 0.2-0.5 small · 0.5-0.8 medium · > 0.8 large"}</p>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleAbandon}
            disabled={saving}
            className="flex-1 bg-[#18181B] border border-[#27272A] text-[#71717A] font-medium rounded-xl py-3 text-sm hover:text-[#A1A1AA] transition-colors"
          >
            Abandon
          </button>
          <button
            onClick={handleConclude}
            disabled={saving}
            className="flex-1 bg-[#F59E0B] text-black font-semibold rounded-xl py-3 text-sm disabled:opacity-40"
          >
            {saving ? "Saving…" : "Conclude"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Experiment Card ───────────────────────────────────────────────────────────

function ExperimentCard({
  exp,
  onEdit,
  onConclude,
  onDelete,
}: {
  exp: Experiment;
  onEdit: (e: Experiment) => void;
  onConclude: (e: Experiment) => void;
  onDelete: (id: string) => void;
}) {
  const s = STATUS_STYLE[exp.status as keyof typeof STATUS_STYLE] ?? STATUS_STYLE.active;
  const daysRunning = differenceInDays(
    exp.end_date ? parseISO(exp.end_date) : new Date(),
    parseISO(exp.start_date),
  );

  return (
    <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className={`w-2 h-2 rounded-full shrink-0 ${s.dot}`} />
            <span className={`text-xs ${s.text}`}>{s.label}</span>
            {exp.tag && (
              <span className="text-xs bg-[#27272A] text-[#A1A1AA] px-2 py-0.5 rounded-full">#{exp.tag}</span>
            )}
          </div>
          <p className="text-sm font-medium text-[#FAFAFA]">{exp.title}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {exp.status === "active" && (
            <button
              onClick={() => onConclude(exp)}
              className="p-1.5 rounded-lg text-[#52525B] hover:text-green-400 hover:bg-green-950/30 transition-colors"
              title="Conclude"
            >
              <CheckCircle size={14} />
            </button>
          )}
          <button
            onClick={() => onEdit(exp)}
            className="p-1.5 rounded-lg text-[#52525B] hover:text-[#A1A1AA] hover:bg-[#27272A] transition-colors"
            title="Edit"
          >
            <FlaskConical size={14} />
          </button>
          <button
            onClick={() => onDelete(exp.id)}
            className="p-1.5 rounded-lg text-[#52525B] hover:text-red-400 hover:bg-red-950/30 transition-colors"
            title="Delete"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <p className="text-xs text-[#71717A] italic">{exp.hypothesis}</p>

      {exp.protocol && (
        <p className="text-xs text-[#52525B]">Protocol: {exp.protocol}</p>
      )}

      {exp.result && (
        <div className="bg-[#18181B] rounded-lg px-3 py-2 space-y-1">
          <p className="text-xs text-[#A1A1AA]">{exp.result}</p>
          {exp.effect_size != null && (
            <p className="text-xs">
              <span className="text-[#52525B]">Cohen's d: </span>
              <span className={`font-semibold ${
                Math.abs(exp.effect_size) > 0.8 ? "text-green-400" :
                Math.abs(exp.effect_size) > 0.5 ? "text-yellow-400" :
                "text-[#A1A1AA]"
              }`}>{exp.effect_size}</span>
              <span className="text-[#52525B] ml-1">
                {Math.abs(exp.effect_size) > 0.8 ? "(large)" :
                 Math.abs(exp.effect_size) > 0.5 ? "(medium)" :
                 Math.abs(exp.effect_size) > 0.2 ? "(small)" : "(negligible)"}
              </span>
            </p>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap pt-1">
        <span className="text-xs text-[#52525B]">
          {format(parseISO(exp.start_date), "d MMM yyyy")}
          {exp.end_date ? ` → ${format(parseISO(exp.end_date), "d MMM yyyy")}` : ""}
        </span>
        <span className="text-xs text-[#52525B]">{daysRunning}d</span>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

function ExperimentsPageInner() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Experiment | null>(null);
  const [concluding, setConcluding] = useState<Experiment | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("active");

  const { data: experiments = [] } = useQuery<Experiment[]>({
    queryKey: ["experiments", statusFilter],
    queryFn: async () => {
      const qs = statusFilter === "all" ? "" : `?status=${statusFilter}`;
      const res = await fetch(`/api/experiments${qs}`);
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 10_000,
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["experiments"] });
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this experiment?")) return;
    await fetch(`/api/experiments/${id}`, { method: "DELETE" });
    invalidate();
  }

  const activeCount = experiments.filter((e) => e.status === "active").length;

  return (
    <div className="min-h-screen bg-[#09090B] text-[#FAFAFA]">
      <div className="max-w-lg mx-auto px-4 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-[#52525B] mb-1">← <a href="/explore" className="hover:text-[#A1A1AA]">Explore</a></p>
            <h1 className="text-xl font-semibold">Experiments</h1>
            <p className="text-xs text-[#71717A] mt-0.5">N-of-1 trials · Horizon 3</p>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 bg-[#18181B] border border-[#27272A] hover:border-[#3F3F46] rounded-xl px-3 py-2 text-sm transition-colors"
          >
            <Plus size={14} /> New
          </button>
        </div>

        {/* Stats */}
        {experiments.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {(["active", "concluded", "abandoned"] as const).map((st) => {
              const count = experiments.filter(e => e.status === st).length;
              const s = STATUS_STYLE[st];
              return (
                <div key={st} className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-3 text-center">
                  <p className={`text-xl font-bold tabular-nums ${s.text}`}>{count}</p>
                  <p className="text-xs text-[#52525B]">{s.label}</p>
                </div>
              );
            })}
          </div>
        )}

        {/* Filter tabs */}
        <div className="flex border-b border-[#27272A]">
          {[
            { key: "active", label: "Active" },
            { key: "concluded", label: "Concluded" },
            { key: "all", label: "All" },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setStatusFilter(key)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                statusFilter === key
                  ? "text-[#FAFAFA] border-b-2 border-[#F59E0B]"
                  : "text-[#71717A] hover:text-[#A1A1AA]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* List */}
        <div className="space-y-3">
          {experiments.length === 0 ? (
            <div className="text-center py-16 space-y-2">
              <p className="text-4xl">🧪</p>
              <p className="text-[#A1A1AA] text-sm">No {statusFilter === "all" ? "" : statusFilter} experiments</p>
              {statusFilter === "active" && (
                <p className="text-[#52525B] text-xs">Start one — hypothesis → protocol → tag compliance → result</p>
              )}
            </div>
          ) : (
            experiments.map((exp) => (
              <ExperimentCard
                key={exp.id}
                exp={exp}
                onEdit={setEditing}
                onConclude={setConcluding}
                onDelete={handleDelete}
              />
            ))
          )}
        </div>

        {/* Methodology note */}
        <div className="bg-[#0D0D0F] border border-[#18181B] rounded-xl p-4 space-y-1">
          <p className="text-xs text-[#52525B] uppercase tracking-widest">Methodology</p>
          <p className="text-xs text-[#71717A]">
            Tag compliance days in the daily log (e.g. <span className="text-[#A1A1AA]">#cold-shower</span>) to build the treatment group.
            After the experiment period, Cohen's d compares the treatment days vs. control days for your target metric (energy, mood, HRV).
          </p>
        </div>

      </div>

      {(showAdd || editing) && (
        <ExperimentSheet
          experiment={editing}
          onClose={() => { setShowAdd(false); setEditing(null); }}
          onSaved={invalidate}
        />
      )}
      {concluding && (
        <ConcludeSheet
          experiment={concluding}
          onClose={() => setConcluding(null)}
          onSaved={invalidate}
        />
      )}
    </div>
  );
}

export default function ExperimentsPage() {
  return <Suspense><ExperimentsPageInner /></Suspense>;
}
