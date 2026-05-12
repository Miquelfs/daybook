"use client";

export const CATEGORY_EMOJI: Record<string, string> = {
  Restaurant:     "🍴",
  Groceries:      "🛒",
  Transportation: "🚗",
  Sports:         "🏋",
  Tech:           "💻",
  Gifts:          "🎁",
  Trips:          "✈️",
  Home:           "🏠",
  Personal:       "🧴",
  Alert:          "🚨",
};

export const EXPENSE_CATEGORIES = [
  "Restaurant", "Groceries", "Transportation", "Home",
  "Sports", "Trips", "Tech", "Gifts", "Personal", "Alert",
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
