"use client";

import { useState, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { DaySubjective } from "@/lib/api";
import { Slider } from "./Slider";
import { SectionLabel } from "./MorningBrief";
import { Check, Loader } from "lucide-react";

interface Props {
  date: string;
  initial: DaySubjective;
}

type Draft = {
  energy: number | null;
  mood: number | null;
  stress: number | null;
  sleep_quality: number | null;
  notes: string;
  daily_answer: string;
  daily_question: string;
};

export function Questionnaire({ date, initial }: Props) {
  const qc = useQueryClient();

  const { data: q } = useQuery({
    queryKey: ["questionnaire", date],
    queryFn: () => api.questionnaire(date),
  });

  const [draft, setDraft] = useState<Draft>({
    energy: initial.energy ?? null,
    mood: initial.mood ?? null,
    stress: initial.stress ?? null,
    sleep_quality: initial.sleep_quality ?? null,
    notes: initial.notes ?? "",
    daily_answer: initial.daily_answer ?? "",
    daily_question: initial.daily_question ?? q?.rotating.text ?? "",
  });

  const [saved, setSaved] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { mutate: save, isPending } = useMutation({
    mutationFn: (patch: typeof draft) =>
      api.patch(date, {
        energy: patch.energy ?? undefined,
        mood: patch.mood ?? undefined,
        stress: patch.stress ?? undefined,
        sleep_quality: patch.sleep_quality ?? undefined,
        notes: patch.notes || undefined,
        daily_answer: patch.daily_answer || undefined,
        daily_question: patch.daily_question || q?.rotating.text || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["day", date] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const scheduleSave = useCallback(
    (next: Draft) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => save(next), 800);
    },
    [save]
  );

  function update<K extends keyof Draft>(key: K, val: Draft[K]) {
    const next = { ...draft, [key]: val };
    setDraft(next);
    scheduleSave(next);
  }

  const rotatingQuestion = q?.rotating.text ?? initial.daily_question ?? "Loading…";

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <SectionLabel>Reflection</SectionLabel>
        <span className="text-xs text-[#52525B] flex items-center gap-1.5 h-4">
          {isPending && <Loader size={11} className="animate-spin text-[#A1A1AA]" />}
          {saved && !isPending && (
            <>
              <Check size={11} className="text-[#F59E0B]" />
              <span className="text-[#A1A1AA]">Saved</span>
            </>
          )}
        </span>
      </div>

      <div className="flex flex-col gap-7">
        {/* Scale sliders */}
        <Slider
          label="Energy"
          value={draft.energy}
          onChange={(v) => update("energy", v)}
        />
        <Slider
          label="Mood"
          value={draft.mood}
          onChange={(v) => update("mood", v)}
        />
        <Slider
          label="Stress"
          value={draft.stress}
          onChange={(v) => update("stress", v)}
        />
        <Slider
          label="Sleep quality"
          value={draft.sleep_quality}
          onChange={(v) => update("sleep_quality", v)}
          hint="How did last night feel — before you look at the data?"
        />

        {/* Notes */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-[#FAFAFA]">Notes</label>
          <textarea
            rows={3}
            placeholder="Anything worth remembering about today…"
            value={draft.notes}
            onChange={(e) => update("notes", e.target.value)}
            onBlur={() => save(draft)}
            className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-4 py-3 text-sm text-[#FAFAFA] placeholder:text-[#52525B] resize-none focus:outline-none focus:border-[#F59E0B] transition-colors"
          />
        </div>

        {/* Rotating question */}
        <div className="flex flex-col gap-2 border-t border-[#27272A] pt-6">
          <p className="text-xs text-[#52525B] uppercase tracking-widest">Today's question</p>
          <p className="text-base text-[#FAFAFA] font-medium leading-snug">
            {rotatingQuestion}
          </p>
          <input
            type="text"
            placeholder="One sentence…"
            value={draft.daily_answer}
            onChange={(e) => update("daily_answer", e.target.value)}
            onBlur={() => save(draft)}
            className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-4 py-3 text-sm text-[#FAFAFA] placeholder:text-[#52525B] focus:outline-none focus:border-[#F59E0B] transition-colors"
          />
        </div>
      </div>
    </section>
  );
}
