"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ChevronLeft, Search, Check, Plus } from "lucide-react";
import { foodApi, type FoodLibraryItem } from "@/lib/food-api";

const MEALS = ["breakfast", "lunch", "dinner", "snack"];

export function FoodsLibrary() {
  const today = format(new Date(), "yyyy-MM-dd");
  const [q, setQ] = useState("");
  const [meal, setMeal] = useState("");
  const [added, setAdded] = useState<Record<string, boolean>>({});

  const { data, isFetching } = useQuery({
    queryKey: ["food-library", q],
    queryFn: () => foodApi.library(q, 80),
    staleTime: 60_000,
  });
  const items = data?.items ?? [];

  async function add(it: FoodLibraryItem) {
    await foodApi.create({
      date: today,
      description: it.name,
      meal_type: (meal || it.meal_type || undefined) as string | undefined,
      source: "text",
      eaten_at: `${today}T${new Date().toTimeString().slice(0, 5)}`,
      kcal: it.kcal, protein_g: it.protein_g, carbs_g: it.carbs_g, fat_g: it.fat_g, sugar_g: it.sugar_g,
    });
    setAdded((a) => ({ ...a, [it.name]: true }));
    setTimeout(() => setAdded((a) => ({ ...a, [it.name]: false })), 1500);
  }

  return (
    <div>
      <Link href="/food" className="text-xs text-[#71717A] hover:text-[#A1A1AA] uppercase tracking-widest inline-flex items-center gap-1 mb-2">
        <ChevronLeft size={13} /> Food
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Foods</h1>
      <p className="text-sm text-[#71717A] mt-0.5 mb-4">Your logged foods + crew meals — tap to add to today.</p>

      <div className="flex gap-2 mb-4 sticky top-0 bg-[#09090B] py-2 z-10">
        <div className="flex-1 flex items-center gap-2 bg-[#18181B] border border-[#27272A] rounded-lg px-3">
          <Search size={14} className="text-[#52525B]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search foods…"
            className="flex-1 bg-transparent py-2 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:outline-none"
          />
        </div>
        <select
          value={meal}
          onChange={(e) => setMeal(e.target.value)}
          className="bg-[#18181B] border border-[#27272A] rounded-lg px-2 text-xs text-[#D4D4D8] focus:outline-none focus:border-[#3F3F46]"
        >
          <option value="">Meal</option>
          {MEALS.map((m) => <option key={m} value={m}>{m[0].toUpperCase() + m.slice(1)}</option>)}
        </select>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-[#52525B] py-8 text-center">
          {isFetching ? "Searching…" : "No foods found — log some meals and they'll appear here."}
        </p>
      ) : (
        <div className="space-y-1.5">
          {items.map((it) => (
            <div key={`${it.source}-${it.name}`} className="flex items-center gap-3 bg-[#0D0D0F] border border-[#27272A] rounded-lg px-3 py-2.5">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm text-[#FAFAFA] font-medium truncate">{it.name}</p>
                  {it.source === "preset" ? (
                    <span className="text-[9px] uppercase tracking-wider text-[#60A5FA] bg-[#60A5FA]/10 rounded px-1 py-0.5 shrink-0">crew</span>
                  ) : it.times_logged > 1 ? (
                    <span className="text-[9px] text-[#52525B] shrink-0">×{it.times_logged}</span>
                  ) : null}
                </div>
                <p className="text-[11px] text-[#71717A] tabular-nums mt-0.5">
                  {Math.round(it.kcal)} kcal · {Math.round(it.protein_g)}P / {Math.round(it.carbs_g)}C / {Math.round(it.fat_g)}F
                </p>
              </div>
              <button
                onClick={() => add(it)}
                className={`shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  added[it.name]
                    ? "bg-[#34D399]/15 text-[#34D399]"
                    : "bg-[#18181B] border border-[#27272A] text-[#D4D4D8] hover:border-[#3F3F46]"
                }`}
              >
                {added[it.name] ? <><Check size={13} /> Added</> : <><Plus size={13} /> Add</>}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
