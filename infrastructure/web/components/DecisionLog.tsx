"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Decision, DecisionCreate } from "@/lib/api";
import { SectionLabel } from "./MorningBrief";
import { ChevronDown, ChevronUp, X, Check } from "lucide-react";
import { format } from "date-fns";

interface Props {
  date: string;
}

const CONFIDENCE_LABELS: Record<number, string> = {
  1: "1%",  2: "10%", 3: "25%", 4: "40%", 5: "50%",
  6: "60%", 7: "75%", 8: "85%", 9: "90%", 10: "95%+",
};

function ConfidencePip({ value }: { value: number | null }) {
  if (!value) return null;
  return (
    <span className="text-xs text-[#52525B] tabular-nums">
      {CONFIDENCE_LABELS[value] ?? `${value}/10`} confident
    </span>
  );
}

function DecisionCard({ d, onResolve, onDelete }: {
  d: Decision;
  onResolve: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const isResolved = d.actual_outcome !== null;
  return (
    <div className={`bg-[#0D0D0F] border rounded-xl px-4 py-3 flex flex-col gap-2 ${isResolved ? "border-[#1C1C1F]" : "border-[#27272A]"}`}>
      <div className="flex items-start justify-between gap-2">
        <p className={`text-sm font-medium leading-snug ${isResolved ? "text-[#52525B] line-through" : "text-[#FAFAFA]"}`}>
          {d.description}
        </p>
        <button
          onClick={() => onDelete(d.id)}
          className="text-[#3F3F46] hover:text-[#71717A] transition-colors shrink-0 mt-0.5"
        >
          <X size={13} />
        </button>
      </div>

      {d.expected_outcome && (
        <p className="text-xs text-[#52525B] italic">→ {d.expected_outcome}</p>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <ConfidencePip value={d.confidence} />
        {d.horizon_date && (
          <span className="text-xs text-[#3F3F46]">
            resurface {format(new Date(d.horizon_date + "T12:00:00"), "d MMM")}
          </span>
        )}
        {!isResolved && (
          <button
            onClick={() => onResolve(d.id)}
            className="ml-auto text-xs text-[#F59E0B] hover:text-[#FBB000] transition-colors flex items-center gap-1"
          >
            <Check size={11} />
            Resolve
          </button>
        )}
        {isResolved && d.outcome_score != null && (
          <span className="ml-auto text-xs text-emerald-500">
            accuracy {d.outcome_score}/10
          </span>
        )}
      </div>

      {isResolved && d.actual_outcome && (
        <p className="text-xs text-[#52525B] border-t border-[#18181B] pt-2 mt-1">
          {d.actual_outcome}
        </p>
      )}
    </div>
  );
}

function ResolveSheet({ decision, onClose }: { decision: Decision; onClose: () => void }) {
  const qc = useQueryClient();
  const [outcome, setOutcome] = useState("");
  const [score, setScore] = useState<number | null>(null);

  const { mutate, isPending } = useMutation({
    mutationFn: () => api.resolveDecision(decision.id, {
      actual_outcome: outcome,
      outcome_score: score ?? undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["decisions", decision.date] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 bg-black/70 flex items-end z-50" onClick={onClose}>
      <div
        className="w-full max-w-2xl mx-auto bg-[#0D0D0F] border border-[#27272A] rounded-t-2xl p-6 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-xs text-[#F59E0B] uppercase tracking-widest">Resolve decision</p>
        <p className="text-sm text-[#FAFAFA] font-medium">{decision.description}</p>
        {decision.expected_outcome && (
          <p className="text-xs text-[#52525B] italic">Predicted: {decision.expected_outcome}</p>
        )}

        <div>
          <p className="text-xs text-[#52525B] uppercase tracking-wide mb-1.5">What actually happened?</p>
          <textarea
            rows={3}
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            placeholder="The actual outcome…"
            className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-4 py-3 text-sm text-[#FAFAFA] placeholder:text-[#52525B] resize-none focus:outline-none focus:border-[#F59E0B] transition-colors"
          />
        </div>

        <div>
          <p className="text-xs text-[#52525B] uppercase tracking-wide mb-2">How accurate was your prediction? (1-10)</p>
          <div className="flex gap-2">
            {[1,2,3,4,5,6,7,8,9,10].map((n) => (
              <button
                key={n}
                onClick={() => setScore(n === score ? null : n)}
                className={`w-8 h-8 rounded-lg text-xs font-medium transition-colors ${
                  score === n
                    ? "bg-[#F59E0B] text-black"
                    : "bg-[#18181B] border border-[#27272A] text-[#71717A] hover:border-[#3F3F46]"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-lg border border-[#27272A] text-sm text-[#71717A] hover:border-[#3F3F46] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => mutate()}
            disabled={!outcome.trim() || isPending}
            className="flex-1 py-2.5 rounded-lg bg-[#F59E0B] text-black text-sm font-medium disabled:opacity-40 hover:bg-[#FBB000] transition-colors"
          >
            {isPending ? "Saving…" : "Resolve"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DecisionLog({ date }: Props) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const [desc, setDesc] = useState("");
  const [expected, setExpected] = useState("");
  const [confidence, setConfidence] = useState<number | null>(null);
  const [horizon, setHorizon] = useState("");

  const { data: decisions = [] } = useQuery({
    queryKey: ["decisions", date],
    queryFn: () => api.decisions(date),
    staleTime: 30_000,
  });

  const { mutate: create, isPending } = useMutation({
    mutationFn: () => {
      const body: DecisionCreate = { date, description: desc.trim() };
      if (expected.trim()) body.expected_outcome = expected.trim();
      if (confidence) body.confidence = confidence;
      if (horizon) body.horizon_date = horizon;
      return api.createDecision(body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["decisions", date] });
      setDesc(""); setExpected(""); setConfidence(null); setHorizon("");
      setShowForm(false);
    },
  });

  const { mutate: del } = useMutation({
    mutationFn: (id: string) => api.deleteDecision(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["decisions", date] }),
  });

  const resolvingDecision = resolvingId ? decisions.find((d) => d.id === resolvingId) : null;

  const unresolved = decisions.filter((d) => !d.actual_outcome);
  const resolved   = decisions.filter((d) =>  d.actual_outcome);

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <SectionLabel>Decision log</SectionLabel>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="text-xs text-[#F59E0B] hover:text-[#FBB000] transition-colors"
        >
          + Log decision
        </button>
      </div>

      {showForm && (
        <div className="mb-6 bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4 flex flex-col gap-3">
          <div>
            <p className="text-xs text-[#52525B] mb-1.5 uppercase tracking-wide">Decision</p>
            <textarea
              rows={2}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="What did you decide?"
              className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder:text-[#52525B] resize-none focus:outline-none focus:border-[#F59E0B] transition-colors"
            />
          </div>
          <div>
            <p className="text-xs text-[#52525B] mb-1.5 uppercase tracking-wide">Expected outcome</p>
            <input
              type="text"
              value={expected}
              onChange={(e) => setExpected(e.target.value)}
              placeholder="What do you predict will happen?"
              className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder:text-[#52525B] focus:outline-none focus:border-[#F59E0B] transition-colors"
            />
          </div>
          <div>
            <p className="text-xs text-[#52525B] mb-2 uppercase tracking-wide">Confidence</p>
            <div className="flex flex-wrap gap-1.5">
              {[1,2,3,4,5,6,7,8,9,10].map((n) => (
                <button
                  key={n}
                  onClick={() => setConfidence(n === confidence ? null : n)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                    confidence === n
                      ? "bg-[#F59E0B] text-black"
                      : "bg-[#18181B] border border-[#27272A] text-[#71717A] hover:border-[#3F3F46]"
                  }`}
                >
                  {CONFIDENCE_LABELS[n]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs text-[#52525B] mb-1.5 uppercase tracking-wide">Resurface date (optional)</p>
            <input
              type="date"
              value={horizon}
              onChange={(e) => setHorizon(e.target.value)}
              className="bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#F59E0B] transition-colors"
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => { setShowForm(false); setDesc(""); setExpected(""); setConfidence(null); setHorizon(""); }}
              className="flex-1 py-2 rounded-lg border border-[#27272A] text-sm text-[#71717A] hover:border-[#3F3F46] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => create()}
              disabled={!desc.trim() || isPending}
              className="flex-1 py-2 rounded-lg bg-[#F59E0B] text-black text-sm font-medium disabled:opacity-40 hover:bg-[#FBB000] transition-colors"
            >
              {isPending ? "Saving…" : "Log it"}
            </button>
          </div>
        </div>
      )}

      {decisions.length === 0 && !showForm && (
        <p className="text-xs text-[#3F3F46]">No decisions logged for this day.</p>
      )}

      {unresolved.length > 0 && (
        <div className="flex flex-col gap-2 mb-3">
          {unresolved.map((d) => (
            <DecisionCard
              key={d.id}
              d={d}
              onResolve={(id) => setResolvingId(id)}
              onDelete={(id) => del(id)}
            />
          ))}
        </div>
      )}

      {resolved.length > 0 && (
        <div>
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-[#52525B] hover:text-[#A1A1AA] transition-colors mb-2"
          >
            {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            {resolved.length} resolved
          </button>
          {open && (
            <div className="flex flex-col gap-2">
              {resolved.map((d) => (
                <DecisionCard
                  key={d.id}
                  d={d}
                  onResolve={(id) => setResolvingId(id)}
                  onDelete={(id) => del(id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {resolvingDecision && (
        <ResolveSheet decision={resolvingDecision} onClose={() => setResolvingId(null)} />
      )}
    </section>
  );
}
