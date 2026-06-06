"use client";

// Account badge colors matched to Notion color scheme
export const ACCOUNT_COLORS: Record<string, { bg: string; text: string }> = {
  "BBVA Diaria":                  { bg: "bg-blue-900/40",   text: "text-blue-300" },
  "BBVA Estalvis":                { bg: "bg-teal-900/40",   text: "text-teal-300" },
  "Trade Republic Cash":          { bg: "bg-amber-900/30",  text: "text-amber-400" },
  "Trade Republic Wealth":        { bg: "bg-zinc-700/40",   text: "text-zinc-300" },
  "Revolut":                      { bg: "bg-violet-900/40", text: "text-violet-300" },
  "Revolut Cripto":               { bg: "bg-orange-900/40", text: "text-orange-300" },
  "Revolut Flexible Cash Funds":  { bg: "bg-pink-900/40",   text: "text-pink-300" },
  "Sabadell":                     { bg: "bg-sky-900/40",    text: "text-sky-300" },
  "Cash":                         { bg: "bg-zinc-800/60",   text: "text-zinc-400" },
  "Mapfre Inversió":              { bg: "bg-yellow-900/40", text: "text-yellow-300" },
  "Accions":                      { bg: "bg-rose-900/40",   text: "text-rose-300" },
  "Binance":                      { bg: "bg-emerald-900/40", text: "text-emerald-300" },
};

export function accountBadgeClass(account: string): { bg: string; text: string } {
  return ACCOUNT_COLORS[account] ?? { bg: "bg-zinc-800/60", text: "text-zinc-400" };
}

export const CATEGORY_EMOJI: Record<string, string> = {
  Restaurant:     "🍴",
  Groceries:      "🛒",
  Transportation: "🚗",
  Home:           "🏠",
  Sports:         "🏋",
  Trips:          "✈️",
  Tech:           "💻",
  Gifts:          "🎁",
  Personal:       "🧴",
  Alert:          "🚨",
  Pilot:          "🛩️",
  Fun:            "🎉",
  Clothes:        "👕",
  "Barça":        "⚽",
  Bizum:          "💸",
  Sweets:         "🍬",
  Other:          "📦",
  Income:         "💰",
  OMYRA:          "📱",
  Finance:        "📊",
  Transfer:       "🔄",
};

export const EXPENSE_CATEGORIES = [
  "Restaurant", "Groceries", "Transportation", "Home",
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
