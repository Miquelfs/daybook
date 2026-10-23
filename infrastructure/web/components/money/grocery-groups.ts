// Product types on supermarket tickets — mirrors GROUPS in domains/money/groceries.py
export const GROUP_STYLE: Record<string, { emoji: string; color: string }> = {
  "Fruit & veg":     { emoji: "🥦", color: "#22C55E" },
  "Meat & fish":     { emoji: "🍗", color: "#EF4444" },
  "Dairy & eggs":    { emoji: "🧀", color: "#3B82F6" },
  "Bakery":          { emoji: "🥖", color: "#F59E0B" },
  "Pantry":          { emoji: "🥫", color: "#A78BFA" },
  "Frozen & ready":  { emoji: "🍕", color: "#06B6D4" },
  "Sweets & snacks": { emoji: "🍬", color: "#EC4899" },
  "Drinks":          { emoji: "🥤", color: "#14B8A6" },
  "Household":       { emoji: "🧻", color: "#71717A" },
  "Personal care":   { emoji: "🧴", color: "#A1A1AA" },
  "Other":           { emoji: "🛒", color: "#52525B" },
};

export function groupStyle(group: string) {
  return GROUP_STYLE[group] ?? GROUP_STYLE.Other;
}

/** "0,680 kg × 5,00 €/kg" / "2 × 0,89" — the ticket's own breakdown, if any. */
export function itemDetail(it: { quantity: number; weight_kg: number | null; unit_price: number | null }): string | null {
  if (it.weight_kg) return `${it.weight_kg.toFixed(3)} kg × €${(it.unit_price ?? 0).toFixed(2)}/kg`;
  if (it.quantity > 1 && it.unit_price != null) return `${it.quantity} × €${it.unit_price.toFixed(2)}`;
  return null;
}
