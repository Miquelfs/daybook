"use client";

import { useState, Suspense } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO, isPast } from "date-fns";
import { Plus, CheckCircle, Clock, ChevronRight, X, AlertTriangle } from "lucide-react";

interface Decision {
  id: string;
  date: string;
  description: string;
  expected_outcome: string | null;
  confidence: number | null;
  horizon_date: string | null;
  actual_outcome: string | null;
  outcome_score: number | null;
  created_at: string;
  resolved_at: string | null;
}

const TODAY = new Date().toISOString().slice(0, 10);

function confidenceLabel(c: number | null) {
  if (c == null) return null;
  if (c <= 3) return { text: "Low", color: "text-red-400" };
  if (c <= 6) return { text: "Medium", color: "text-yellow-400" };
  return { text: "High", color: "text-green-400" };
}

function scoreColor(s: number | null) {
  if (s == null) return "text-[#71717A]";
  if (s <= 3) return "text-red-400";
  if (s <= 6) return "text-yellow-400";
  return "text-green-400";
}

// ── Add Decision Sheet ──────────────────────────────────────────────────────

function AddSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    description: "",
    expected_outcome: "",
    confidence: "" as string | number,
    horizon_date: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!form.description.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: TODAY,
          description: form.description.trim(),
          expected_outcome: form.expected_outcome.trim() || null,
          confidence: form.confidence ? Number(form.confidence) : null,
          horizon_date: form.horizon_date || null,
        }),
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
        className="w-full max-w-lg bg-[#0D0D0F] border border-[#27272A] rounded-t-2xl p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-[#FAFAFA]">Log a Decision</h2>
          <button onClick={onClose}><X size={18} className="text-[#52525B]" /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-[#71717A] mb-1 block">Decision *</label>
            <textarea
              className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder:text-[#3F3F46] outline-none focus:border-[#F59E0B] transition-colors resize-none"
              rows={2}
              placeholder="What are you deciding?"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              autoFocus
            />
          </div>

          <div>
            <label className="text-xs text-[#71717A] mb-1 block">Expected outcome</label>
            <textarea
              className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder:text-[#3F3F46] outline-none focus:border-[#F59E0B] transition-colors resize-none"
              rows={2}
              placeholder="What do you predict will happen?"
              value={form.expected_outcome}
              onChange={(e) => setForm({ ...form, expected_outcome: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[#71717A] mb-1 block">Confidence (1–10)</label>
              <input
                type="number"
                min={1}
                max={10}
                className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B] transition-colors"
                placeholder="7"
                value={form.confidence}
                onChange={(e) => setForm({ ...form, confidence: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs text-[#71717A] mb-1 block">Review by</label>
              <input
                type="date"
                className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B] transition-colors"
                value={form.horizon_date}
                onChange={(e) => setForm({ ...form, horizon_date: e.target.value })}
              />
            </div>
          </div>
        </div>

        {error && <p className="text-red-400 text-xs">{error}</p>}

        <button
          onClick={handleSave}
          disabled={saving || !form.description.trim()}
          className="w-full bg-[#F59E0B] text-black font-semibold rounded-xl py-3 text-sm disabled:opacity-40 transition-opacity"
        >
          {saving ? "Saving…" : "Log Decision"}
        </button>
      </div>
    </div>
  );
}

// ── Resolve Sheet ──────────────────────────────────────────────────────────

function ResolveSheet({ decision, onClose, onSaved }: { decision: Decision; onClose: () => void; onSaved: () => void }) {
  const [outcome, setOutcome] = useState("");
  const [score, setScore] = useState<string>("");
  const [saving, setSaving] = useState(false);

  async function handleResolve() {
    if (!outcome.trim()) return;
    setSaving(true);
    try {
      await fetch(`/api/decisions/${decision.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actual_outcome: outcome.trim(),
          outcome_score: score ? Number(score) : null,
        }),
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
          <h2 className="font-semibold text-[#FAFAFA]">Resolve Decision</h2>
          <button onClick={onClose}><X size={18} className="text-[#52525B]" /></button>
        </div>

        <div className="bg-[#18181B] rounded-xl p-4 space-y-1">
          <p className="text-sm text-[#FAFAFA]">{decision.description}</p>
          {decision.expected_outcome && (
            <p className="text-xs text-[#71717A] italic">Predicted: {decision.expected_outcome}</p>
          )}
          {decision.horizon_date && (
            <p className="text-xs text-[#52525B]">Due: {format(parseISO(decision.horizon_date), "d MMM yyyy")}</p>
          )}
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-[#71717A] mb-1 block">What actually happened? *</label>
            <textarea
              className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder:text-[#3F3F46] outline-none focus:border-[#F59E0B] transition-colors resize-none"
              rows={3}
              placeholder="Describe the actual outcome…"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs text-[#71717A] mb-1 block">Outcome score (1=wrong, 10=exactly right)</label>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                <button
                  key={n}
                  onClick={() => setScore(String(n))}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${
                    String(n) === score
                      ? "bg-[#F59E0B] text-black"
                      : "bg-[#18181B] text-[#71717A] hover:bg-[#27272A]"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>

        <button
          onClick={handleResolve}
          disabled={saving || !outcome.trim()}
          className="w-full bg-[#F59E0B] text-black font-semibold rounded-xl py-3 text-sm disabled:opacity-40"
        >
          {saving ? "Saving…" : "Mark Resolved"}
        </button>
      </div>
    </div>
  );
}

// ── Decision Card ──────────────────────────────────────────────────────────

function DecisionCard({ d, onResolve }: { d: Decision; onResolve: (d: Decision) => void }) {
  const isResolved = d.actual_outcome != null;
  const isPending = !isResolved && d.horizon_date != null && isPast(parseISO(d.horizon_date));
  const conf = confidenceLabel(d.confidence);

  return (
    <div className={`bg-[#0D0D0F] border rounded-xl p-4 space-y-2 ${isPending ? "border-yellow-800" : "border-[#27272A]"}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-[#FAFAFA] flex-1">{d.description}</p>
        {isPending && (
          <button
            onClick={() => onResolve(d)}
            className="shrink-0 flex items-center gap-1 bg-yellow-900/40 border border-yellow-700 rounded-lg px-2 py-1 text-xs text-yellow-300 hover:bg-yellow-900/70 transition-colors"
          >
            <CheckCircle size={11} /> Resolve
          </button>
        )}
        {isResolved && (
          <span className="shrink-0 flex items-center gap-1 text-xs text-green-400">
            <CheckCircle size={11} /> Done
          </span>
        )}
      </div>

      {d.expected_outcome && (
        <p className="text-xs text-[#71717A] italic">→ {d.expected_outcome}</p>
      )}

      {d.actual_outcome && (
        <div className="bg-[#18181B] rounded-lg px-3 py-2">
          <p className="text-xs text-[#A1A1AA]">{d.actual_outcome}</p>
          {d.outcome_score != null && (
            <p className={`text-xs font-semibold mt-1 ${scoreColor(d.outcome_score)}`}>
              Accuracy {d.outcome_score}/10
            </p>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs text-[#52525B]">{format(parseISO(d.date), "d MMM yyyy")}</span>
        {conf && <span className={`text-xs ${conf.color}`}>{conf.text} confidence</span>}
        {d.horizon_date && !isResolved && (
          <span className={`text-xs flex items-center gap-1 ${isPending ? "text-yellow-400" : "text-[#52525B]"}`}>
            <Clock size={10} />
            {isPending ? "Overdue" : `Review ${format(parseISO(d.horizon_date), "d MMM")}`}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

function DecisionsPageInner() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [resolving, setResolving] = useState<Decision | null>(null);
  const [tab, setTab] = useState<"pending" | "all">("pending");

  const { data: pending = [] } = useQuery<Decision[]>({
    queryKey: ["decisions-pending"],
    queryFn: async () => {
      const res = await fetch("/api/decisions/pending");
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 0,
  });

  const { data: all = [] } = useQuery<Decision[]>({
    queryKey: ["decisions-all"],
    queryFn: async () => {
      const res = await fetch("/api/decisions");
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 30_000,
    enabled: tab === "all",
  });

  const displayed = tab === "pending" ? pending : all;

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["decisions-pending"] });
    qc.invalidateQueries({ queryKey: ["decisions-all"] });
  }

  return (
    <div className="min-h-screen bg-[#09090B] text-[#FAFAFA]">
      <div className="max-w-lg mx-auto px-4 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Decision Log</h1>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 bg-[#18181B] border border-[#27272A] hover:border-[#3F3F46] rounded-xl px-3 py-2 text-sm transition-colors"
          >
            <Plus size={14} /> Log decision
          </button>
        </div>

        {/* Pending callout */}
        {pending.length > 0 && tab === "pending" && (
          <div className="flex items-center gap-2 bg-yellow-950/40 border border-yellow-800 rounded-xl px-4 py-3">
            <AlertTriangle size={14} className="text-yellow-400 shrink-0" />
            <p className="text-sm text-yellow-300">
              {pending.length} decision{pending.length > 1 ? "s" : ""} past review date — close the loop
            </p>
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-[#27272A]">
          <button
            onClick={() => setTab("pending")}
            className={`px-4 py-2 text-sm font-medium transition-colors ${tab === "pending" ? "text-[#FAFAFA] border-b-2 border-[#F59E0B]" : "text-[#71717A] hover:text-[#A1A1AA]"}`}
          >
            Pending resolution
            {pending.length > 0 && (
              <span className="ml-2 bg-yellow-900 text-yellow-300 text-xs px-1.5 py-0.5 rounded-full tabular-nums">
                {pending.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab("all")}
            className={`px-4 py-2 text-sm font-medium transition-colors ${tab === "all" ? "text-[#FAFAFA] border-b-2 border-[#F59E0B]" : "text-[#71717A] hover:text-[#A1A1AA]"}`}
          >
            All decisions
          </button>
        </div>

        {/* List */}
        <div className="space-y-3">
          {displayed.length === 0 && (
            <div className="text-center py-16 space-y-2">
              <p className="text-3xl">{tab === "pending" ? "✓" : "🧭"}</p>
              <p className="text-[#A1A1AA] text-sm">
                {tab === "pending" ? "No decisions waiting for resolution" : "No decisions logged yet"}
              </p>
              {tab === "all" && (
                <p className="text-[#52525B] text-xs">Log a decision now — review it later to calibrate your judgement</p>
              )}
            </div>
          )}
          {displayed.map((d) => (
            <DecisionCard key={d.id} d={d} onResolve={setResolving} />
          ))}
        </div>

      </div>

      {showAdd && (
        <AddSheet onClose={() => setShowAdd(false)} onSaved={invalidate} />
      )}
      {resolving && (
        <ResolveSheet decision={resolving} onClose={() => setResolving(null)} onSaved={invalidate} />
      )}
    </div>
  );
}

export default function DecisionsPage() {
  return <Suspense><DecisionsPageInner /></Suspense>;
}
