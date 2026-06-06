"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ChevronRight, Check } from "lucide-react";
import { api, LIFE_PALETTE } from "@/lib/api";

// Suggested starter periods — common life chapters to prompt the user
const STARTER_PERIODS: {
  label: string;
  category: string;
  layer: string;
  color: string;
  placeholder: string;
}[] = [
  { label: "", category: "education",    layer: "main",          color: "amber-400",   placeholder: "e.g. Primary school" },
  { label: "", category: "education",    layer: "main",          color: "amber-400",   placeholder: "e.g. University — Aeronautical Engineering" },
  { label: "", category: "work",         layer: "main",          color: "blue-400",    placeholder: "e.g. First airline job" },
  { label: "", category: "aviation",     layer: "main",          color: "sky-400",     placeholder: "e.g. PPL training" },
  { label: "", category: "location",     layer: "top_stripe",    color: "emerald-400", placeholder: "e.g. Living in Barcelona" },
  { label: "", category: "relationship", layer: "bottom_stripe", color: "rose-400",    placeholder: "e.g. Relationship with X" },
];

type Step = "birthdate" | "periods" | "done";

interface PeriodDraft {
  id: string;
  label: string;
  category: string;
  layer: string;
  color: string;
  start_date: string;
  end_date: string;
  placeholder: string;
}

function makeDrafts(): PeriodDraft[] {
  return STARTER_PERIODS.map((s, i) => ({
    id: String(i),
    label: s.label,
    category: s.category,
    layer: s.layer,
    color: s.color,
    start_date: "",
    end_date: "",
    placeholder: s.placeholder,
  }));
}

const CATEGORY_LABELS: Record<string, string> = {
  education: "Education", work: "Work", aviation: "Aviation",
  relationship: "Relationship", location: "Location", health: "Health", other: "Other",
};

const LAYER_LABELS: Record<string, string> = {
  main: "Main fill", top_stripe: "Top stripe", bottom_stripe: "Bottom stripe",
};

export function LifeOnboarding() {
  const qc = useQueryClient();
  const router = useRouter();

  const [step, setStep]         = useState<Step>("birthdate");
  const [birthdate, setBirthdate] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [drafts, setDrafts]     = useState<PeriodDraft[]>(makeDrafts);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState("");

  // ── Step 1: save profile ──────────────────────────────────────────────────
  const { mutate: saveProfile, isPending: profilePending } = useMutation({
    mutationFn: () =>
      api.upsertProfile({ birthdate, display_name: displayName || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["life-grid"] });
      setStep("periods");
    },
    onError: (e) => setError(String(e)),
  });

  function handleBirthdateNext() {
    if (!birthdate) return;
    setError("");
    saveProfile();
  }

  // ── Step 2: save all filled periods ──────────────────────────────────────
  async function handlePeriodsSave() {
    const filled = drafts.filter((d) => d.label.trim() && d.start_date);
    if (filled.length === 0) { setStep("done"); return; }

    setSaving(true);
    setError("");
    try {
      for (const d of filled) {
        await api.createPeriod({
          label: d.label.trim(),
          category: d.category,
          layer: d.layer,
          color: d.color,
          start_date: d.start_date,
          end_date: d.end_date || undefined,
        });
      }
      qc.invalidateQueries({ queryKey: ["life-grid"] });
      qc.invalidateQueries({ queryKey: ["life-periods"] });
      setStep("done");
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  function updateDraft(id: string, field: keyof PeriodDraft, value: string) {
    setDrafts((prev) =>
      prev.map((d) => (d.id === id ? { ...d, [field]: value } : d))
    );
  }

  function addBlankDraft() {
    setDrafts((prev) => [
      ...prev,
      {
        id: String(Date.now()),
        label: "",
        category: "other",
        layer: "main",
        color: "zinc-400",
        start_date: "",
        end_date: "",
        placeholder: "Label",
      },
    ]);
  }

  // ── Step: done ────────────────────────────────────────────────────────────
  if (step === "done") {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
        <div className="w-12 h-12 rounded-full bg-[#F59E0B]/10 flex items-center justify-center">
          <Check size={24} className="text-[#F59E0B]" />
        </div>
        <h2 className="text-lg font-semibold text-[#FAFAFA]">Your life is on the grid.</h2>
        <p className="text-sm text-[#52525B] max-w-xs">
          Scroll through it. Click any week to open that day. Add more periods or events with the + button.
        </p>
        <button
          onClick={() => router.refresh()}
          className="mt-2 px-6 py-2.5 rounded-full bg-[#F59E0B] text-[#09090B] text-sm font-semibold hover:bg-[#D97706] transition-colors"
        >
          See my grid →
        </button>
      </div>
    );
  }

  // ── Step: periods ─────────────────────────────────────────────────────────
  if (step === "periods") {
    return (
      <div className="max-w-xl mx-auto">
        <div className="mb-6">
          <p className="text-xs text-[#F59E0B] uppercase tracking-widest mb-1">Step 2 of 2</p>
          <h2 className="text-xl font-semibold text-[#FAFAFA]">Add your life chapters</h2>
          <p className="text-sm text-[#52525B] mt-1">
            Fill in as many or as few as you like. You can always add more later.
            Leave a row blank to skip it.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          {drafts.map((d) => (
            <div
              key={d.id}
              className="border border-[#18181B] rounded-xl p-4 bg-[#0D0D0F] flex flex-col gap-3"
            >
              {/* Category + layer badge */}
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm flex-shrink-0"
                  style={{ background: LIFE_PALETTE[d.color] ?? "#6b7280" }}
                />
                <span className="text-xs text-[#52525B]">
                  {CATEGORY_LABELS[d.category]} · {LAYER_LABELS[d.layer]}
                </span>
              </div>

              {/* Label */}
              <input
                type="text"
                value={d.label}
                onChange={(e) => updateDraft(d.id, "label", e.target.value)}
                placeholder={d.placeholder}
                className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder:text-[#3F3F46] focus:outline-none focus:border-[#52525B]"
              />

              {/* Dates */}
              <div className="flex gap-2">
                <input
                  type="date"
                  value={d.start_date}
                  onChange={(e) => updateDraft(d.id, "start_date", e.target.value)}
                  placeholder="Start"
                  className="flex-1 bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#52525B]"
                />
                <input
                  type="date"
                  value={d.end_date}
                  onChange={(e) => updateDraft(d.id, "end_date", e.target.value)}
                  placeholder="End (blank = ongoing)"
                  className="flex-1 bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#52525B]"
                />
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={addBlankDraft}
            className="text-sm text-[#52525B] hover:text-[#A1A1AA] transition-colors border border-dashed border-[#27272A] rounded-xl py-3 text-center"
          >
            + Add another period
          </button>
        </div>

        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

        <div className="flex gap-3 mt-6">
          <button
            onClick={() => setStep("done")}
            className="flex-1 py-3 rounded-xl text-sm text-[#52525B] border border-[#27272A] hover:text-[#A1A1AA] transition-colors"
          >
            Skip for now
          </button>
          <button
            onClick={handlePeriodsSave}
            disabled={saving}
            className="flex-1 py-3 rounded-xl text-sm font-semibold bg-[#F59E0B] text-[#09090B] hover:bg-[#D97706] transition-colors disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save & see grid"}
          </button>
        </div>
      </div>
    );
  }

  // ── Step: birthdate ───────────────────────────────────────────────────────
  return (
    <div className="max-w-sm mx-auto py-8">
      <div className="mb-8">
        <p className="text-xs text-[#F59E0B] uppercase tracking-widest mb-1">Step 1 of 2</p>
        <h2 className="text-xl font-semibold text-[#FAFAFA]">When were you born?</h2>
        <p className="text-sm text-[#52525B] mt-1">
          This anchors the 90×52 grid. Each row is one year of your life, starting on your birthday.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <div>
          <label className="text-xs text-[#71717A] uppercase tracking-widest mb-1.5 block">
            Birthdate
          </label>
          <input
            type="date"
            value={birthdate}
            onChange={(e) => setBirthdate(e.target.value)}
            className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-3 text-base text-[#FAFAFA] focus:outline-none focus:border-[#52525B]"
            autoFocus
          />
        </div>

        <div>
          <label className="text-xs text-[#71717A] uppercase tracking-widest mb-1.5 block">
            Your name <span className="normal-case text-[#3F3F46]">(optional)</span>
          </label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Miquel"
            className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-3 text-base text-[#FAFAFA] placeholder:text-[#3F3F46] focus:outline-none focus:border-[#52525B]"
          />
        </div>
      </div>

      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

      <button
        onClick={handleBirthdateNext}
        disabled={!birthdate || profilePending}
        className="mt-6 w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-semibold bg-[#F59E0B] text-[#09090B] hover:bg-[#D97706] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {profilePending ? "Saving…" : "Next — add life chapters"}
        <ChevronRight size={16} />
      </button>
    </div>
  );
}
