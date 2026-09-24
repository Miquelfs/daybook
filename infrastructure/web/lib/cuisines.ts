// Shared curated cuisine list — used by the full restaurant database page and
// the FAB's quick-add form, so both offer the same picker instead of the FAB
// falling back to a plain free-text field.
export const CUISINE_EMOJI: Record<string, string> = {
  Italian: "🍝", Sushi: "🍣", Japanese: "🍱", Tapas: "🥘", Spanish: "🥘",
  Catalan: "🥘", French: "🥐", Mexican: "🌮", Asian: "🥡", Chinese: "🥟",
  Indian: "🍛", Thai: "🍜", Greek: "🫒", Pizza: "🍕", Burger: "🍔",
  Brunch: "🍳", Breakfast: "🥐", "Fast Food": "🍟", Ramen: "🍜",
  "Bar/Tapas": "🍺", Portuguese: "🍷", "Middle Eastern": "🧆",
  Peruvian: "🐟", Vegetarian: "🥗",
};

export const CUISINE_LIST = Object.keys(CUISINE_EMOJI).sort();
