"use client";

import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { api, LIFE_PALETTE, type LifePeriod } from "@/lib/api";

const PALETTE_KEYS = Object.keys(LIFE_PALETTE);

interface Props {
  isOpen: boolean;
  onClose: () => void;
  editing?: LifePeriod | null;
  /** Categories already used in existing periods — shown as quick-select pills */
  existingCategories?: string[];
}

export function AddPeriodSheet({ isOpen, onClose, editing, existingCategories = [] }: Props) {
  const qc = useQueryClient();

  const [label, setLabel]         = useState("");
  const [category, setCategory]   = useState("work");
  const [customCat, setCustomCat] = useState("");   // free-form input value
  const [color, setColor]         = useState("blue-400");
  const [hexInput, setHexInput]   = useState("");   // raw hex field
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate]     = useState("");
  const [notes, setNotes]         = useState("");

  // Suggestions: union of existing + defaults, deduped
  const DEFAULT_SUGGESTIONS = ["education", "work", "aviation", "relationship", "location", "health", "other"];
  const suggestions = Array.from(new Set([...existingCategories, ...DEFAULT_SUGGESTIONS]));

  useEffect(() => {
    if (!isOpen) return;
    if (editing) {
      setLabel(editing.label);
      setCategory(editing.category);
      setCustomCat(editing.category);
      setColor(editing.color.startsWith("#") ? "custom" : editing.color);
      setHexInput(editing.color.startsWith("#") ? editing.color : "");
      setStartDate(editing.start_date);
      setEndDate(editing.end_date ?? "");
      setNotes(editing.notes ?? "");
    } else {
      setLabel("");
      setCategory("work");
      setCustomCat("work");
      setColor("blue-400");
      setHexInput("");
      setStartDate("");
      setEndDate("");
      setNotes("");
    }
  }, [isOpen, editing]);

  function handleSuggestionClick(cat: string) {
    setCategory(cat);
    setCustomCat(cat);
  }

  function handleCustomCatChange(v: string) {
    setCustomCat(v);
    setCategory(v.trim().toLowerCase());
  }

  function handlePaletteClick(key: string) {
    setColor(key);
    setHexInput("");
  }

  function handleHexChange(v: string) {
    setHexInput(v);
    if (/^#[0-9a-fA-F]{6}$/.test(v)) {
      setColor(v);
    }
  }

  const effectiveColor = color === "custom" ? (hexInput || "#6b7280") : (color.startsWith("#") ? color : color);

  const { mutate: save, isPending, error } = useMutation({
    mutationFn: () => {
      const body = {
        label: label.trim(),
        category: category || "other",
        layer: "main",
        color: effectiveColor,
        start_date: startDate,
        end_date: endDate || undefined,
        notes: notes.trim() || undefined,
      };
      return editing
        ? api.patchPeriod(editing.id, body)
        : api.createPeriod(body);
    },
    onSuccess: (resp) => {
      qc.invalidateQueries({ queryKey: ["life-grid"] });
      qc.invalidateQueries({ queryKey: ["life-periods"] });
      if ("auto_capped" in resp && resp.auto_capped.length > 0) {
        const names = resp.auto_capped.map((c) => `"${c.label}" → ${c.new_end_date}`).join(", ");
        alert(`Auto-capped overlapping period(s): ${names}`);
      }
      onClose();
    },
  });

  const canSave =
    !isPending &&
    label.trim().length > 0 &&
    category.trim().length > 0 &&
    startDate.length === 10 &&
    (!endDate || endDate >= startDate);

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40" onClick={onClose} />

      <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#09090B] border-t border-[#27272A] rounded-t-2xl max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-[#18181B]">
          <h2 className="text-base font-semibold text-[#FAFAFA]">
            {editing ? "Edit period" : "Add period"}
          </h2>
          <button type="button" onClick={onClose} className="text-[#52525B] hover:text-[#A1A1AA]">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-5">
          {/* Label */}
          <div>
            <label className="text-xs text-[#71717A] uppercase tracking-widest mb-1.5 block">
              Label
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Working at Vueling"
              className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2.5 text-sm text-[#FAFAFA] placeholder:text-[#3F3F46] focus:outline-none focus:border-[#52525B]"
            />
          </div>

          {/* Category */}
          <div>
            <label className="text-xs text-[#71717A] uppercase tracking-widest mb-1.5 block">
              Category
            </label>
            {/* Suggestion pills */}
            <div className="flex flex-wrap gap-1.5 mb-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => handleSuggestionClick(s)}
                  className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                    category === s
                      ? "border-[#F59E0B] text-[#F59E0B] bg-[#F59E0B]/10"
                      : "border-[#27272A] text-[#71717A] hover:text-[#A1A1AA]"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            {/* Free-form input */}
            <input
              type="text"
              value={customCat}
              onChange={(e) => handleCustomCatChange(e.target.value)}
              placeholder="Or type a new category…"
              className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder:text-[#3F3F46] focus:outline-none focus:border-[#52525B]"
            />
          </div>

          {/* Colour */}
          <div>
            <label className="text-xs text-[#71717A] uppercase tracking-widest mb-1.5 block">
              Colour
            </label>
            {/* Native colour picker + live preview */}
            <div className="flex items-center gap-3 mb-3">
              <label className="relative cursor-pointer flex-shrink-0">
                <div
                  className="w-10 h-10 rounded-xl border-2 border-white/20 shadow-lg"
                  style={{ background: effectiveColor.startsWith("#") ? effectiveColor : (LIFE_PALETTE[effectiveColor] ?? "#6b7280") }}
                />
                <input
                  type="color"
                  value={effectiveColor.startsWith("#") ? effectiveColor : (LIFE_PALETTE[effectiveColor] ?? "#6b7280")}
                  onChange={(e) => { setColor(e.target.value); setHexInput(e.target.value); }}
                  className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                />
              </label>
              <div className="flex-1">
                <input
                  type="text"
                  value={hexInput || (color.startsWith("#") ? color : (LIFE_PALETTE[color] ? "" : color))}
                  onChange={(e) => handleHexChange(e.target.value)}
                  placeholder="#60a5fa"
                  maxLength={7}
                  className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder:text-[#3F3F46] focus:outline-none focus:border-[#52525B] font-mono"
                />
              </div>
              <span className="text-xs text-[#52525B] flex-shrink-0 min-w-[56px] text-right">
                {color.startsWith("#") ? color : (LIFE_PALETTE[color] ? color : "")}
              </span>
            </div>
            {/* Palette swatches for quick picks */}
            <div className="flex flex-wrap gap-1.5">
              {PALETTE_KEYS.map((key) => {
                const hex = LIFE_PALETTE[key];
                const isSelected = color === key || effectiveColor === hex;
                return (
                  <button
                    key={key}
                    type="button"
                    title={key}
                    onClick={() => handlePaletteClick(key)}
                    className={`w-5 h-5 rounded-full transition-transform ${
                      isSelected ? "ring-2 ring-white ring-offset-1 ring-offset-[#09090B] scale-110" : "hover:scale-110"
                    }`}
                    style={{ background: hex }}
                  />
                );
              })}
            </div>
          </div>

          {/* Dates */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs text-[#71717A] uppercase tracking-widest mb-1.5 block">
                Start date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2.5 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#52525B]"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-[#71717A] uppercase tracking-widest mb-1.5 block">
                End date <span className="normal-case text-[#3F3F46]">(blank = ongoing)</span>
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2.5 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#52525B]"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs text-[#71717A] uppercase tracking-widest mb-1.5 block">
              Notes <span className="normal-case text-[#3F3F46]">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any context worth remembering…"
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
            {isPending ? "Saving…" : editing ? "Save changes" : "Add period"}
          </button>
        </div>
      </div>
    </>
  );
}
