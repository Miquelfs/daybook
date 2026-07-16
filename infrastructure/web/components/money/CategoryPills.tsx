"use client";

// Account colors live in ./account-colors (plain module) so server components
// can use them too; re-exported here for existing client imports.
export { ACCOUNT_COLORS, accountBadgeClass } from "./account-colors";

export const CATEGORY_EMOJI: Record<string, string> = {
  Restaurant:         "🍴",
  "Food & Beverages": "🥤",
  Groceries:          "🛒",
  Transportation:     "🚗",
  Home:               "🏠",
  Sports:             "🏋",
  Trips:              "✈️",
  Tech:               "💻",
  Gifts:              "🎁",
  Personal:           "😊",
  Alert:              "🚨",
  Pilot:              "🛩️",
  Fun:                "🎉",
  Clothes:            "👕",
  "Barça":            "⚽",
  Bizum:              "💸",
  Sweets:             "🍬",
  Other:              "📦",
  Income:             "💰",
  OMYRA:              "📱",
  Finance:            "📊",
  Transfer:           "🔄",
};

export const EXPENSE_CATEGORIES = [
  "Restaurant", "Food & Beverages", "Groceries", "Transportation", "Home",
  "Sports", "Trips", "Tech", "Gifts", "Personal", "Alert",
  "Pilot", "Fun", "Clothes", "Barça", "Bizum", "Sweets", "Other",
];

interface Props {
  selected: string;
  onSelect: (cat: string) => void;
  categories?: string[];
}

export function CategoryPills({ selected, onSelect, categories = EXPENSE_CATEGORIES }: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      {categories.map((cat) => (
        <button
          key={cat}
          type="button"
          onClick={() => onSelect(cat)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-medium transition-colors
            ${selected === cat
              ? "bg-[#F59E0B] text-[#09090B]"
              : "bg-[#18181B] border border-[#27272A] text-[#A1A1AA] hover:text-[#FAFAFA] hover:border-[#3F3F46]"
            }`}
        >
          <span>{CATEGORY_EMOJI[cat] ?? "💳"}</span>
          <span>{cat}</span>
        </button>
      ))}
    </div>
  );
}
