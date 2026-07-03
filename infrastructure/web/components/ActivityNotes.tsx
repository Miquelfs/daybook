"use client";

import { useState } from "react";
import { Check, Pencil, X } from "lucide-react";

const RATING_LABELS: Record<number, string> = {
  1: "Terrible", 2: "Bad", 3: "Below average", 4: "Average", 5: "Good",
  6: "Solid", 7: "Strong", 8: "Great", 9: "Excellent", 10: "Perfect",
};

const RATING_COLOR: Record<number, string> = {
  1: "#EF4444", 2: "#EF4444", 3: "#F97316", 4: "#F59E0B",
  5: "#EAB308", 6: "#84CC16", 7: "#22C55E", 8: "#22C55E",
  9: "#10B981", 10: "#10B981",
};

interface Props {
  activityId: string;
  initialNotes: string | null;
  initialRating: number | null;
}

export function ActivityNotes({ activityId, initialNotes, initialRating }: Props) {
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [rating, setRating] = useState<number | null>(initialRating);
  const [saved, setSaved] = useState({ notes: initialNotes ?? "", rating: initialRating });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/activities/${encodeURIComponent(activityId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_notes: notes || null, user_rating: rating }),
      });
      if (res.ok) {
        setSaved({ notes, rating });
        setEditing(false);
      }
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setNotes(saved.notes);
    setRating(saved.rating);
    setEditing(false);
  }

  if (!editing) {
    const hasContent = saved.notes || saved.rating != null;
    return (
      <div
        className={`rounded-xl border px-4 py-3 cursor-pointer transition-colors group ${
          hasContent
            ? "bg-[#0D0D0F] border-[#27272A] hover:border-[#3F3F46]"
            : "border-dashed border-[#27272A] hover:border-[#3F3F46]"
        }`}
        onClick={() => setEditing(true)}
      >
        {hasContent ? (
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              {saved.rating != null && (
                <div className="flex items-center gap-2 mb-1.5">
                  <span
                    className="text-xs font-semibold tabular-nums"
                    style={{ color: RATING_COLOR[saved.rating] }}
                  >
                    {saved.rating}/10
                  </span>
                  <span className="text-xs text-[#52525B]">{RATING_LABELS[saved.rating]}</span>
                </div>
              )}
              {saved.notes && (
                <p className="text-sm text-[#A1A1AA] whitespace-pre-wrap">{saved.notes}</p>
              )}
            </div>
            <Pencil size={13} className="text-[#3F3F46] group-hover:text-[#71717A] shrink-0 mt-0.5 transition-colors" />
          </div>
        ) : (
          <div className="flex items-center gap-2 text-[#3F3F46] group-hover:text-[#52525B] transition-colors">
            <Pencil size={13} />
            <span className="text-sm">Add notes & rating…</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-4 space-y-4">
      {/* Rating row */}
      <div>
        <p className="text-xs text-[#52525B] uppercase tracking-widest mb-2">How did it feel?</p>
        <div className="flex gap-1.5 flex-wrap">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setRating(rating === n ? null : n)}
              className={`w-8 h-8 rounded-lg text-xs font-semibold transition-all ${
                rating === n
                  ? "text-[#09090B] scale-110"
                  : "bg-[#18181B] text-[#52525B] hover:text-[#A1A1AA]"
              }`}
              style={rating === n ? { backgroundColor: RATING_COLOR[n] } : {}}
            >
              {n}
            </button>
          ))}
        </div>
        {rating != null && (
          <p className="text-xs mt-1.5" style={{ color: RATING_COLOR[rating] }}>
            {RATING_LABELS[rating]}
          </p>
        )}
      </div>

      {/* Notes textarea */}
      <div>
        <p className="text-xs text-[#52525B] uppercase tracking-widest mb-2">Notes</p>
        <textarea
          rows={4}
          className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B] resize-none placeholder:text-[#3F3F46]"
          placeholder="How did it feel? What did you learn? Any form cues, pacing notes, goals for next time…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          autoFocus
        />
      </div>

      {/* Actions */}
      <div className="flex gap-2 justify-end">
        <button
          onClick={cancel}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[#52525B] hover:text-[#A1A1AA] transition-colors"
        >
          <X size={13} /> Cancel
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-1.5 px-4 py-1.5 text-xs bg-[#F59E0B] hover:bg-[#D97706] disabled:bg-[#27272A] disabled:text-[#52525B] text-[#09090B] font-semibold rounded-lg transition-colors"
        >
          <Check size={13} /> {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
