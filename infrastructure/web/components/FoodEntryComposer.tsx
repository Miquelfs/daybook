"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Sparkles, X } from "lucide-react";
import { foodApi, type AnalyzeItem, type RecentFood, type HeartRating } from "@/lib/food-api";
import { HeartRatingBadge, HeartDot } from "@/components/HeartRatingBadge";

const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack", "extra"];

type EditItem = AnalyzeItem & { _key: string };

const inputCls =
  "bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:outline-none focus:border-[#3F3F46]";

function blankItem(): EditItem {
  return { _key: Math.random().toString(36).slice(2), name: "", kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, sugar_g: 0 };
}

// Shared add-food form. Type what you ate (photo optional) → AI proposes macros
// → confirm/edit → save one entry per item. A "duty meal: …" line matches the
// PMI crew-meal presets server-side.
export function FoodEntryComposer({ date, onDone }: { date: string; onDone?: () => void }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [mealType, setMealType] = useState("");
  const [time, setTime] = useState(() => new Date().toTimeString().slice(0, 5)); // local HH:MM, editable
  const [items, setItems] = useState<EditItem[] | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [heart, setHeart] = useState<{ rating: HeartRating; note: string | null } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: recent = [] } = useQuery<RecentFood[]>({
    queryKey: ["food-recent"],
    queryFn: () => foodApi.recent(8),
    staleTime: 60_000,
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["day-food", date] });
    qc.invalidateQueries({ queryKey: ["food-summary", date] });
    qc.invalidateQueries({ queryKey: ["food-week"] });
    qc.invalidateQueries({ queryKey: ["food-recent"] });
  }

  async function quickLog(r: RecentFood) {
    await foodApi.create({
      date,
      description: r.description,
      meal_type: (mealType || r.meal_type) || undefined,
      source: "text",
      eaten_at: `${date}T${time}`,
      kcal: r.kcal, protein_g: r.protein_g, carbs_g: r.carbs_g, fat_g: r.fat_g, sugar_g: r.sugar_g,
    });
    invalidate();
  }

  async function analyze() {
    if (!text.trim() && !file) return;
    setAnalyzing(true);
    setError(null);
    try {
      const fd = new FormData();
      if (text.trim()) fd.set("text", text.trim());
      if (file) fd.set("file", file);
      const res = await foodApi.analyze(fd);
      setItems(res.items.map((it) => ({ ...it, _key: Math.random().toString(36).slice(2) })));
      setConfidence(res.confidence ?? null);
      setHeart(res.heart_rating ? { rating: res.heart_rating, note: res.heart_note ?? null } : null);
    } catch {
      // AI unavailable (or failed) → let the user enter one item manually.
      setError("AI unavailable — enter macros manually.");
      setItems([{ ...blankItem(), name: text.trim() || "Food" }]);
      setConfidence(null);
      setHeart(null);
    } finally {
      setAnalyzing(false);
    }
  }

  function patchItem(key: string, field: keyof AnalyzeItem, value: string) {
    setItems((prev) =>
      (prev ?? []).map((it) =>
        it._key === key
          ? { ...it, [field]: field === "name" ? value : Number(value) || 0 }
          : it
      )
    );
  }

  function removeItem(key: string) {
    setItems((prev) => (prev ?? []).filter((it) => it._key !== key));
  }

  async function saveAll() {
    if (!items || items.length === 0) return;
    setSaving(true);
    try {
      for (const it of items) {
        await foodApi.create({
          date,
          description: it.name.trim() || "Food",
          meal_type: mealType || undefined,
          source: file ? "photo" : "text",
          eaten_at: `${date}T${time}`,
          kcal: it.kcal,
          protein_g: it.protein_g,
          carbs_g: it.carbs_g,
          fat_g: it.fat_g,
          sugar_g: it.sugar_g ?? 0,
          saturated_fat_g: it.saturated_fat_g ?? null,
          fiber_g: it.fiber_g ?? null,
          ai_confidence: confidence,
        });
      }
      qc.invalidateQueries({ queryKey: ["day-food", date] });
      qc.invalidateQueries({ queryKey: ["food-summary", date] });
      qc.invalidateQueries({ queryKey: ["food-entries", date] });
      qc.invalidateQueries({ queryKey: ["food-week"] });
      // Reset back to the input state so the next item can be added (on the
      // dashboard there's no sheet to close; the Analyze button is gated on !items).
      setText("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      setItems(null);
      setConfidence(null);
      onDone?.();
    } finally {
      setSaving(false);
    }
  }

  const totals = (items ?? []).reduce(
    (acc, it) => ({
      kcal: acc.kcal + (it.kcal || 0),
      p: acc.p + (it.protein_g || 0),
      c: acc.c + (it.carbs_g || 0),
      f: acc.f + (it.fat_g || 0),
      s: acc.s + (it.sugar_g || 0),
    }),
    { kcal: 0, p: 0, c: 0, f: 0, s: 0 }
  );

  return (
    <div className="space-y-3">
      {!items && recent.length > 0 && (
        <div>
          <p className="text-[11px] text-[#52525B] mb-1.5">Quick add (recent)</p>
          <div className="flex flex-wrap gap-1.5">
            {recent.map((r, i) => (
              <button
                key={i}
                type="button"
                onClick={() => quickLog(r)}
                title={`${Math.round(r.kcal)} kcal · ${Math.round(r.protein_g)}g protein`}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-[#18181B] border border-[#27272A] text-[#D4D4D8] hover:border-[#3F3F46] hover:bg-[#1F1F23] transition-colors"
              >
                {r.heart_rating && <HeartDot rating={r.heart_rating} />}
                <span className="truncate max-w-[140px]">{r.description}</span>
                <span className="text-[#52525B] tabular-nums">{Math.round(r.kcal)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder='What did you eat? e.g. "200g grilled chicken + rice" or "duty meal: lasagna and ham tapas with bread, yoghurt and pear"'
        className={`w-full resize-none ${inputCls}`}
      />

      <div className="flex gap-2">
        <select value={mealType} onChange={(e) => setMealType(e.target.value)} className={`flex-1 ${inputCls}`}>
          <option value="">Meal type (optional)</option>
          {MEAL_TYPES.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          title="When you ate it"
          className={`w-[92px] shrink-0 ${inputCls}`}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className={`shrink-0 flex items-center gap-1.5 px-3 rounded-lg text-xs font-medium transition-colors ${
            file ? "bg-[#F59E0B]/15 text-[#F59E0B]" : "bg-[#18181B] text-[#71717A] border border-[#27272A] hover:border-[#3F3F46]"
          }`}
        >
          <Camera size={14} /> {file ? "Photo ✓" : "Photo"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </div>

      {!items && (
        <button
          type="button"
          onClick={analyze}
          disabled={analyzing || (!text.trim() && !file)}
          className="w-full flex items-center justify-center gap-2 bg-[#F59E0B] hover:bg-[#FBBF24] disabled:opacity-40 text-black font-semibold text-sm rounded-lg py-2.5 transition-colors"
        >
          <Sparkles size={15} /> {analyzing ? "Analyzing…" : "Analyze"}
        </button>
      )}

      {error && <p className="text-[11px] text-[#71717A]">{error}</p>}

      {items && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-[#52525B]">
              {confidence != null
                ? `AI estimate · confidence ${Math.round(confidence * 100)}% — edit anything below.`
                : "Edit the values below."}
            </p>
            <button
              type="button"
              onClick={() => { setItems(null); setConfidence(null); setHeart(null); }}
              className="text-[11px] text-[#71717A] hover:text-[#A1A1AA]"
            >
              ↺ start over
            </button>
          </div>

          {/* Cholesterol verdict for what you're logging */}
          {heart && (
            <div className="flex items-start gap-2 rounded-lg border border-[#27272A] bg-[#0D0D0F] px-3 py-2">
              <HeartRatingBadge rating={heart.rating} />
              {heart.note && <p className="text-xs text-[#A1A1AA] leading-snug flex-1 min-w-0">{heart.note}</p>}
            </div>
          )}
          {items.map((it) => (
            <div key={it._key} className="bg-[#0D0D0F] border border-[#27272A] rounded-lg p-2.5 space-y-2">
              <div className="flex gap-2 items-center">
                <input
                  value={it.name}
                  onChange={(e) => patchItem(it._key, "name", e.target.value)}
                  placeholder="Item"
                  className={`flex-1 ${inputCls}`}
                />
                <button type="button" onClick={() => removeItem(it._key)} className="p-1.5 rounded-lg hover:bg-[#27272A]">
                  <X size={14} className="text-[#71717A]" />
                </button>
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {([["kcal", "kcal"], ["protein_g", "P g"], ["carbs_g", "C g"], ["fat_g", "F g"], ["sugar_g", "Sug g"]] as const).map(
                  ([field, label]) => (
                    <div key={field}>
                      <label className="block text-[10px] text-[#52525B] mb-0.5">{label}</label>
                      <input
                        type="number"
                        value={it[field] ?? 0}
                        onChange={(e) => patchItem(it._key, field, e.target.value)}
                        className={`w-full ${inputCls} tabular-nums`}
                      />
                    </div>
                  )
                )}
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={() => setItems([...(items ?? []), blankItem()])}
            className="text-xs text-[#71717A] hover:text-[#A1A1AA]"
          >
            + add item
          </button>

          <div className="flex items-center justify-between pt-1 text-xs text-[#A1A1AA] tabular-nums">
            <span>Total</span>
            <span>
              {Math.round(totals.kcal)} kcal · {Math.round(totals.p)}P / {Math.round(totals.c)}C / {Math.round(totals.f)}F · {Math.round(totals.s)}g sugar
            </span>
          </div>

          <button
            type="button"
            onClick={saveAll}
            disabled={saving || items.length === 0}
            className="w-full bg-[#F59E0B] hover:bg-[#FBBF24] disabled:opacity-40 text-black font-semibold text-sm rounded-lg py-2.5 transition-colors"
          >
            {saving ? "Saving…" : `Log ${items.length} item${items.length !== 1 ? "s" : ""}`}
          </button>
        </div>
      )}
    </div>
  );
}
