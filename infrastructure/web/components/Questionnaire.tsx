"use client";

import { useState, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { DaySubjective, DayTagSummary, Contact } from "@/lib/api";
import { Slider } from "./Slider";
import { SectionLabel } from "./MorningBrief";
import { EmojiLabel, MOOD_STEPS, ENERGY_STEPS, STRESS_STEPS } from "./EmojiLabel";
import { TagPicker } from "./TagPicker";
import { Check, Loader, ChevronDown, ChevronUp, X } from "lucide-react";
import { format } from "date-fns";

interface Props {
  date: string;
  initial: DaySubjective;
  initialTags?: DayTagSummary[];
  initialCompanions?: string[];
}

type Draft = {
  energy: number | null;
  mood: number | null;
  mood_note: string;
  stress: number | null;
  sleep_quality: number | null;
  notes: string;
  daily_answer: string;
  daily_question: string;
  alcohol: number | null;
  social: boolean | null;
  outdoors: boolean | null;
  work: boolean;
  intimate: boolean;
  intimate_rating: number | null;
  people: Contact[];
};

function parseTags(raw: string | null): {
  work: boolean; intimate: boolean; intimate_rating: number | null;
} {
  const parts = (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const work = parts.includes("work");
  const intimate = parts.some((p) => p === "si" || p.startsWith("si:"));
  const ratingTag = parts.find((p) => p.startsWith("si:"));
  const intimate_rating = ratingTag ? parseInt(ratingTag.split(":")[1]) || null : null;
  return { work, intimate, intimate_rating };
}

function serializeTags(
  work: boolean, intimate: boolean, intimate_rating: number | null
): string {
  const parts: string[] = [];
  if (work) parts.push("work");
  if (intimate) parts.push(intimate_rating ? `si:${intimate_rating}` : "si");
  return parts.join(",");
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean | null;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!(value ?? false))}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
        value
          ? "border-[#F59E0B] bg-[#F59E0B]/10 text-[#F59E0B]"
          : "border-[#27272A] bg-[#18181B] text-[#52525B] hover:text-[#A1A1AA]"
      }`}
    >
      {label}
    </button>
  );
}


export function Questionnaire({ date, initial, initialTags = [], initialCompanions = [] }: Props) {
  const qc = useQueryClient();

  const { data: q } = useQuery({
    queryKey: ["questionnaire", date],
    queryFn: () => api.questionnaire(date),
  });

  // Load all contacts for autocomplete
  const { data: allContacts = [] } = useQuery({
    queryKey: ["contacts"],
    queryFn: () => api.contacts(),
    staleTime: 5 * 60_000,
  });

  const parsedTags = parseTags(initial.tags ?? null);

  // Initialize people from initialCompanions (names) matched against contacts
  // Falls back to empty until contacts load — they'll populate from the query
  const [draft, setDraft] = useState<Draft>({
    energy: initial.energy ?? null,
    mood: initial.mood ?? null,
    mood_note: initial.mood_note ?? "",
    stress: initial.stress ?? null,
    sleep_quality: initial.sleep_quality ?? null,
    notes: initial.notes ?? "",
    daily_answer: initial.daily_answer ?? "",
    daily_question: initial.daily_question ?? q?.rotating.text ?? "",
    alcohol: (initial as DaySubjective & { alcohol?: number | null }).alcohol ?? null,
    social: (initial as DaySubjective & { social?: boolean | null }).social ?? null,
    outdoors: (initial as DaySubjective & { outdoors?: boolean | null }).outdoors ?? null,
    work: parsedTags.work,
    intimate: parsedTags.intimate,
    intimate_rating: parsedTags.intimate_rating,
    people: [],
  });

  // Once contacts load, hydrate draft.people from initialCompanions names
  const companionsHydrated = useRef(false);
  if (!companionsHydrated.current && allContacts.length > 0 && initialCompanions.length > 0) {
    companionsHydrated.current = true;
    const matched = initialCompanions
      .map((name) => allContacts.find((c) => c.name === name))
      .filter((c): c is Contact => c !== undefined);
    if (matched.length > 0) {
      setDraft((d) => ({ ...d, people: matched }));
    }
  }

  const [saved, setSaved] = useState(false);
  const [showPast, setShowPast] = useState(false);
  const [peopleInput, setPeopleInput] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pastEnd = format(new Date(date + "T12:00:00"), "yyyy-MM-dd");
  const pastStart = format(new Date(new Date(date + "T12:00:00").getTime() - 7 * 86400000), "yyyy-MM-dd");

  const { data: pastDays = [] } = useQuery({
    queryKey: ["days-range", pastStart, pastEnd],
    queryFn: () => api.range(pastStart, pastEnd),
    enabled: showPast,
    staleTime: 60_000,
  });

  const pastAnswered = pastDays.filter((d) => d.daily_answer).reverse();

  const { mutate: save, isPending } = useMutation({
    mutationFn: (patch: typeof draft) =>
      api.patch(date, {
        energy: patch.energy ?? undefined,
        mood: patch.mood ?? undefined,
        mood_note: patch.mood_note !== undefined ? patch.mood_note : undefined,
        stress: patch.stress ?? undefined,
        sleep_quality: patch.sleep_quality ?? undefined,
        notes: patch.notes,
        daily_answer: patch.daily_answer,
        daily_question: patch.daily_question || q?.rotating.text || undefined,
        alcohol: patch.alcohol ?? undefined,
        social: patch.social ?? undefined,
        outdoors: patch.outdoors ?? undefined,
        tags: serializeTags(patch.work, patch.intimate, patch.intimate_rating) || undefined,
      }),
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const { mutate: saveCompanions } = useMutation({
    mutationFn: (contacts: Contact[]) =>
      api.setCompanions(date, contacts.map((c) => c.id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["day", date] });
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
        {/* Sliders */}
        <Slider
          label="Energy"
          value={draft.energy}
          onChange={(v) => update("energy", v)}
          rightLabel={<EmojiLabel value={draft.energy} steps={ENERGY_STEPS} />}
        />

        <div className="flex flex-col gap-2">
          <Slider
            label="Mood"
            value={draft.mood}
            onChange={(v) => update("mood", v)}
            rightLabel={<EmojiLabel value={draft.mood} steps={MOOD_STEPS} />}
          />
          {draft.mood !== null && (
            <div className="mt-1">
              <p className="text-xs text-[#52525B] mb-1.5 uppercase tracking-wide">Evening reflection</p>
              <textarea
                rows={2}
                placeholder="What made today good or bad?"
                value={draft.mood_note}
                onChange={(e) => update("mood_note", e.target.value)}
                className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-4 py-3 text-sm
                           text-[#FAFAFA] placeholder:text-[#52525B] resize-none
                           focus:outline-none focus:border-[#F59E0B] transition-colors"
              />
            </div>
          )}
        </div>

        <Slider
          label="Stress"
          value={draft.stress}
          onChange={(v) => update("stress", v)}
          rightLabel={<EmojiLabel value={draft.stress} steps={STRESS_STEPS} />}
        />

        <Slider
          label="Sleep quality"
          value={draft.sleep_quality}
          onChange={(v) => update("sleep_quality", v)}
          hint="How did last night feel — before you look at the data?"
        />

        {/* With — contacts autocomplete */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-[#FAFAFA]">With</label>
          <div className="relative">
            <div className="flex flex-wrap gap-1.5 items-center min-h-[36px] bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 focus-within:border-[#F59E0B] transition-colors">
              {draft.people.map((contact) => (
                <span key={contact.id} className="flex items-center gap-1 bg-[#27272A] text-[#D4D4D8] text-xs px-2 py-1 rounded-full">
                  {contact.emoji && <span>{contact.emoji}</span>}
                  {contact.name}
                  <button
                    type="button"
                    onClick={() => {
                      const next = { ...draft, people: draft.people.filter((p) => p.id !== contact.id) };
                      setDraft(next);
                      saveCompanions(next.people);
                    }}
                    className="text-[#52525B] hover:text-[#FAFAFA] ml-0.5"
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
              <input
                type="text"
                value={peopleInput}
                onChange={(e) => setPeopleInput(e.target.value)}
                onKeyDown={async (e) => {
                  if ((e.key === "Enter" || e.key === ",") && peopleInput.trim()) {
                    e.preventDefault();
                    const name = peopleInput.trim().replace(/,$/, "");
                    if (!name) return;
                    // Find existing contact or create new one
                    let contact = allContacts.find((c) => c.name.toLowerCase() === name.toLowerCase());
                    if (!contact) {
                      try {
                        contact = await api.createContact({ name });
                        qc.invalidateQueries({ queryKey: ["contacts"] });
                      } catch { return; }
                    }
                    if (!draft.people.find((p) => p.id === contact!.id)) {
                      const next = { ...draft, people: [...draft.people, contact] };
                      setDraft(next);
                      saveCompanions(next.people);
                    }
                    setPeopleInput("");
                  } else if (e.key === "Escape") {
                    setPeopleInput("");
                  } else if (e.key === "Backspace" && !peopleInput && draft.people.length > 0) {
                    const next = { ...draft, people: draft.people.slice(0, -1) };
                    setDraft(next);
                    saveCompanions(next.people);
                  }
                }}
                placeholder={draft.people.length === 0 ? "Who were you with?" : ""}
                className="flex-1 min-w-[100px] bg-transparent text-sm text-[#FAFAFA] placeholder:text-[#3F3F46] outline-none"
              />
            </div>
            {/* Autocomplete dropdown */}
            {peopleInput.trim().length > 0 && (() => {
              const q = peopleInput.trim().toLowerCase();
              const activeIds = new Set(draft.people.map((p) => p.id));
              const suggestions = allContacts.filter(
                (c) => c.name.toLowerCase().includes(q) && !activeIds.has(c.id)
              );
              const showAdd = !allContacts.find((c) => c.name.toLowerCase() === q);
              if (suggestions.length === 0 && !showAdd) return null;
              return (
                <div className="absolute z-20 left-0 right-0 mt-1 bg-[#18181B] border border-[#27272A] rounded-lg overflow-hidden shadow-lg">
                  {suggestions.slice(0, 5).map((contact) => (
                    <button
                      key={contact.id}
                      type="button"
                      onMouseDown={async (e) => {
                        e.preventDefault();
                        if (!draft.people.find((p) => p.id === contact.id)) {
                          const next = { ...draft, people: [...draft.people, contact] };
                          setDraft(next);
                          saveCompanions(next.people);
                        }
                        setPeopleInput("");
                      }}
                      className="w-full text-left px-4 py-2 text-sm text-[#D4D4D8] hover:bg-[#27272A] transition-colors"
                    >
                      {contact.emoji && <span className="mr-1">{contact.emoji}</span>}
                      {contact.name}
                    </button>
                  ))}
                  {showAdd && (
                    <button
                      type="button"
                      onMouseDown={async (e) => {
                        e.preventDefault();
                        const name = peopleInput.trim();
                        try {
                          const contact = await api.createContact({ name });
                          qc.invalidateQueries({ queryKey: ["contacts"] });
                          const next = { ...draft, people: [...draft.people, contact] };
                          setDraft(next);
                          saveCompanions(next.people);
                        } catch { /* ignore */ }
                        setPeopleInput("");
                      }}
                      className="w-full text-left px-4 py-2 text-sm text-[#52525B] hover:bg-[#27272A] hover:text-[#A1A1AA] transition-colors border-t border-[#27272A]"
                    >
                      + Add &ldquo;{peopleInput.trim()}&rdquo;
                    </button>
                  )}
                </div>
              );
            })()}
          </div>
        </div>

        {/* Tags */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-[#FAFAFA]">Tags</label>
          <TagPicker date={date} initialTags={initialTags} />
        </div>

        {/* Notes */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-[#FAFAFA]">Notes</label>
          <textarea
            rows={3}
            placeholder="Anything worth remembering about today…"
            value={draft.notes}
            onChange={(e) => update("notes", e.target.value)}
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
            className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-4 py-3 text-sm text-[#FAFAFA] placeholder:text-[#52525B] focus:outline-none focus:border-[#F59E0B] transition-colors"
          />

          {/* Past questions collapsible */}
          <button
            type="button"
            onClick={() => setShowPast((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-[#52525B] hover:text-[#A1A1AA] transition-colors mt-1 self-start"
          >
            {showPast ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            Past 7 days
          </button>

          {showPast && (
            <div className="flex flex-col gap-3 mt-1">
              {pastAnswered.length === 0 && (
                <p className="text-xs text-[#3F3F46]">No answers recorded in the last 7 days.</p>
              )}
              {pastAnswered.map((d) => (
                <div key={d.date} className="flex flex-col gap-1 border-l-2 border-[#27272A] pl-3">
                  <p className="text-xs text-[#52525B]">
                    {format(new Date(d.date + "T12:00:00"), "EEE d MMM")}
                    {d.daily_question && (
                      <span className="ml-1.5 italic">— {d.daily_question}</span>
                    )}
                  </p>
                  <p className="text-sm text-[#D4D4D8]">{d.daily_answer}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
