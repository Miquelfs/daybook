"use client";

import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { api, type LifeEventType, type LifeEvent } from "@/lib/api";

const EVENT_TYPES: { value: LifeEventType; label: string; emoji: string }[] = [
  { value: "career",       label: "Career",       emoji: "💼" },
  { value: "relationship", label: "Relationship", emoji: "❤️" },
  { value: "travel",       label: "Travel",       emoji: "✈️" },
  { value: "loss",         label: "Loss",         emoji: "🕯️" },
  { value: "achievement",  label: "Achievement",  emoji: "🏆" },
  { value: "other",        label: "Other",        emoji: "·" },
];

interface Props {
  isOpen: boolean;
  onClose: () => void;
  editing?: LifeEvent | null;
  /** Pre-fill the date when clicking a specific week cell */
  prefillDate?: string;
}

export function AddEventSheet({ isOpen, onClose, editing, prefillDate }: Props) {
  const qc = useQueryClient();

  const [label, setLabel]       = useState("");
  const [type, setType]         = useState<LifeEventType>("achievement");
  const [eventDate, setEventDate] = useState("");
  const [notes, setNotes]       = useState("");

  useEffect(() => {
    if (!isOpen) return;
    if (editing) {
      setLabel(editing.label);
      setType(editing.type as LifeEventType);
      setEventDate(editing.event_date);
      setNotes(editing.notes ?? "");
    } else {
      setLabel("");
      setType("achievement");
      setEventDate(prefillDate ?? "");
      setNotes("");
    }
  }, [isOpen, editing, prefillDate]);

  const { mutate: save, isPending, error } = useMutation({
    mutationFn: () => {
      const body = {
        label: label.trim(),
        type,
        event_date: eventDate,
        notes: notes.trim() || undefined,
      };
      return editing
        ? api.patchEvent(editing.id, body)
        : api.createEvent(body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["life-grid"] });
      onClose();
    },
  });

  const canSave =
    !isPending && label.trim().length > 0 && eventDate.length === 10;

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40" onClick={onClose} />

      <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#09090B] border-t border-[#27272A] rounded-t-2xl max-h-[85vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-[#18181B]">
          <h2 className="text-base font-semibold text-[#FAFAFA]">
            {editing ? "Edit event" : "Add event"}
          </h2>
          <button type="button" onClick={onClose} className="text-[#52525B] hover:text-[#A1A1AA]">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-5">
          {/* Label */}
          <div>
            <label className="text-xs text-[#71717A] uppercase tracking-widest mb-1.5 block">
              Event
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. First solo flight"
              className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2.5 text-sm text-[#FAFAFA] placeholder:text-[#3F3F46] focus:outline-none focus:border-[#52525B]"
              autoFocus
            />
          </div>

          {/* Type */}
          <div>
            <label className="text-xs text-[#71717A] uppercase tracking-widest mb-1.5 block">
              Type
            </label>
            <div className="flex flex-wrap gap-2">
              {EVENT_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setType(t.value)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border transition-colors ${
                    type === t.value
                      ? "border-[#F59E0B] text-[#F59E0B] bg-[#F59E0B]/10"
                      : "border-[#27272A] text-[#71717A] hover:text-[#A1A1AA]"
                  }`}
                >
                  <span>{t.emoji}</span>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Date */}
          <div>
            <label className="text-xs text-[#71717A] uppercase tracking-widest mb-1.5 block">
              Date
            </label>
            <input
              type="date"
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
              className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2.5 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#52525B]"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs text-[#71717A] uppercase tracking-widest mb-1.5 block">
              Notes <span className="normal-case text-[#3F3F46]">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="A sentence about why this matters…"
              rows={2}
              className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2.5 text-sm text-[#FAFAFA] placeholder:text-[#3F3F46] focus:outline-none focus:border-[#52525B] resize-none"
            />
          </div>

          {error && (
            <p className="text-xs text-red-400">{String(error)}</p>
          )}

          <button
            type="button"
            onClick={() => save()}
            disabled={!canSave}
            className="w-full py-3 rounded-xl text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-[#F59E0B] text-[#09090B] hover:bg-[#D97706]"
          >
            {isPending ? "Saving…" : editing ? "Save changes" : "Add event"}
          </button>
        </div>
      </div>
    </>
  );
}
