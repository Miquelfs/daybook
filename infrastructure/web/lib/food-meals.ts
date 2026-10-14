// Shared meal-type ordering + labels, and a grouping helper used by the food
// dashboard and the day-view food block.

// "ride" = eaten on the bike — counts toward that ride's carbs/h in the training plan.
export const MEAL_ORDER = ["breakfast", "lunch", "dinner", "snack", "ride", "extra"] as const;

export const MEAL_LABEL: Record<string, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snacks",
  ride: "On the bike",
  extra: "Extra",
  other: "Other",
};

export const MEAL_EMOJI: Record<string, string> = {
  breakfast: "🥣",
  lunch: "🥗",
  dinner: "🍽️",
  snack: "🍎",
  ride: "🚴",
  extra: "☕",
  other: "•",
};

export function groupByMeal<T extends { meal_type: string | null }>(
  items: T[]
): { key: string; label: string; emoji: string; items: T[] }[] {
  const buckets: Record<string, T[]> = {};
  for (const it of items) {
    const k = it.meal_type && (MEAL_ORDER as readonly string[]).includes(it.meal_type) ? it.meal_type : "other";
    (buckets[k] ||= []).push(it);
  }
  const order = [...MEAL_ORDER, "other"];
  return order
    .filter((k) => buckets[k]?.length)
    .map((k) => ({ key: k, label: MEAL_LABEL[k] ?? k, emoji: MEAL_EMOJI[k] ?? "•", items: buckets[k] }));
}
