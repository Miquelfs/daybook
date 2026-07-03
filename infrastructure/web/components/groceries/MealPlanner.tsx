"use client";

import { useState } from "react";
import type { MealPlan } from "@/lib/api";

interface Props {
  initialPlan: MealPlan | null;
}

export function MealPlanner({ initialPlan }: Props) {
  const [plan, setPlan] = useState<MealPlan | null>(initialPlan);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meals, setMeals] = useState(5);
  const [budget, setBudget] = useState(60);
  const [constraints, setConstraints] = useState("");

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/groceries/meal-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meals,
          budget_eur: budget,
          constraints: constraints.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.message && !data.meals) {
        setError(data.message);
        return;
      }
      if (!res.ok) {
        setError(data.detail ?? "Generation failed");
        return;
      }
      setPlan(data);
    } catch {
      setError("Could not reach the API");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* Controls */}
      <div className="bg-[#18181B] rounded-xl border border-[#27272A] p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-[#52525B] uppercase tracking-widest block mb-1.5">Dinners</label>
            <input
              type="number"
              min={1}
              max={7}
              value={meals}
              onChange={(e) => setMeals(Number(e.target.value))}
              className="w-full bg-[#09090B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#E4E4E7] focus:outline-none focus:border-[#F59E0B]"
            />
          </div>
          <div>
            <label className="text-xs text-[#52525B] uppercase tracking-widest block mb-1.5">Budget (€)</label>
            <input
              type="number"
              min={10}
              max={200}
              value={budget}
              onChange={(e) => setBudget(Number(e.target.value))}
              className="w-full bg-[#09090B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#E4E4E7] focus:outline-none focus:border-[#F59E0B]"
            />
          </div>
        </div>
        <div>
          <label className="text-xs text-[#52525B] uppercase tracking-widest block mb-1.5">Constraints (optional)</label>
          <input
            value={constraints}
            onChange={(e) => setConstraints(e.target.value)}
            placeholder="e.g. no pork, pescatarian this week"
            className="w-full bg-[#09090B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#E4E4E7] placeholder-[#52525B] focus:outline-none focus:border-[#F59E0B]"
          />
        </div>
        <button
          onClick={generate}
          disabled={loading}
          className="w-full py-2.5 rounded-full bg-[#F59E0B] text-[#18181B] font-medium text-sm hover:bg-[#FBBF24] transition-colors disabled:opacity-50"
        >
          {loading ? "Generating… (20–60 seconds on the HP)" : plan ? "Regenerate plan" : "Generate meal plan"}
        </button>
        {error && <p className="text-xs text-rose-400 text-center">{error}</p>}
      </div>

      {/* Plan display */}
      {plan && (
        <>
          <div>
            <p className="text-xs text-[#F59E0B] uppercase tracking-[0.2em] mb-4">
              Week of {plan.week_start} · €{plan.total_estimated_eur?.toFixed(2)} estimated
            </p>
            <div className="space-y-3">
              {(plan.meals ?? []).map((meal, i) => (
                <div key={i} className="bg-[#18181B] rounded-xl border border-[#27272A] p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="text-xs text-[#52525B] uppercase tracking-widest">{meal.day}</p>
                      <p className="text-sm font-medium text-[#E4E4E7] mt-0.5">{meal.name}</p>
                    </div>
                    <span className="text-sm font-semibold text-[#A1A1AA]">€{meal.meal_cost_eur?.toFixed(2)}</span>
                  </div>
                  {meal.ingredients && (
                    <p className="text-xs text-[#52525B]">
                      {meal.ingredients.map((ing) => ing.name).join(", ")}
                    </p>
                  )}
                  {meal.notes && <p className="text-xs text-[#3F3F46] mt-1 italic">{meal.notes}</p>}
                </div>
              ))}
            </div>
          </div>

          {plan.shopping_list && plan.shopping_list.length > 0 && (
            <div>
              <p className="text-xs text-[#F59E0B] uppercase tracking-[0.2em] mb-4">Shopping list</p>
              <div className="bg-[#18181B] rounded-xl border border-[#27272A] divide-y divide-[#27272A]">
                {plan.shopping_list.map((item, i) => (
                  <div key={i} className="px-4 py-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm text-[#E4E4E7]">{item.name}</p>
                      <p className="text-xs text-[#52525B]">{item.qty}</p>
                    </div>
                    <span className="text-sm text-[#71717A]">~€{item.estimated_eur?.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {!plan && !loading && (
        <div className="text-center py-8">
          <p className="text-sm text-[#52525B]">Set your preferences and generate a plan above.</p>
          <p className="text-xs text-[#3F3F46] mt-1">Requires Ollama running on the HP.</p>
        </div>
      )}
    </div>
  );
}
