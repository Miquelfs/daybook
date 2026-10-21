// Areas tie goals, tasks and notes to the part of the daybook they belong to.
// A goal's area comes from its metric unless set; a task's area also puts it
// on that page (Money, Health, Logbook, …). Colours are mid-tones that read on
// both the dark cockpit and the light paper theme.

export type AreaKey =
  | "training" | "health" | "food" | "habits" | "people" | "money" | "aviation"
  | "travel" | "culture" | "projects" | "home" | "admin" | "personal";

export interface Area {
  key: AreaKey;
  label: string;
  emoji: string;
  color: string;
  href: string | null;
}

export const AREAS: Record<AreaKey, Area> = {
  training: { key: "training", label: "Training",  emoji: "🏃", color: "#EA580C", href: "/omyra" },
  health:   { key: "health",   label: "Health",    emoji: "🫀", color: "#C026D3", href: "/health" },
  food:     { key: "food",     label: "Food",      emoji: "🥗", color: "#65A30D", href: "/food" },
  habits:   { key: "habits",   label: "Habits",    emoji: "🌱", color: "#0891B2", href: "/tags" },
  people:   { key: "people",   label: "People",    emoji: "🫂", color: "#DB2777", href: "/plan?tab=people" },
  money:    { key: "money",    label: "Money",     emoji: "💸", color: "#059669", href: "/money" },
  aviation: { key: "aviation", label: "Aviation",  emoji: "✈️", color: "#2563EB", href: "/aviation" },
  travel:   { key: "travel",   label: "Travel",    emoji: "🌍", color: "#0D9488", href: "/explore" },
  culture:  { key: "culture",  label: "Reading & culture", emoji: "📚", color: "#7C3AED", href: "/explore" },
  projects: { key: "projects", label: "Projects",  emoji: "🛠️", color: "#4F46E5", href: null },
  home:     { key: "home",     label: "Home",      emoji: "🏠", color: "#CA8A04", href: null },
  admin:    { key: "admin",    label: "Admin",     emoji: "🗂️", color: "#64748B", href: null },
  personal: { key: "personal", label: "Personal",  emoji: "✨", color: "#D97706", href: null },
};

export const AREA_LIST = Object.values(AREAS);

export function area(key: string | null | undefined): Area {
  return AREAS[(key ?? "") as AreaKey] ?? AREAS.personal;
}

/** Translucent fill of an area colour (hex + alpha) for tiles and chips. */
export function tint(color: string, alpha = 0.14): string {
  return `${color}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
}

/** Emoji suggestions offered when naming a goal in this area. */
export const AREA_EMOJI: Record<AreaKey, string[]> = {
  training: ["🏃", "🚴", "🏊", "⛰️", "🏅", "⏱️"],
  health:   ["🫀", "😴", "⚖️", "🚶", "📵", "🧘"],
  food:     ["🥗", "🍎", "💧", "🍳", "🥦", "🚫"],
  habits:   ["🌱", "🔥", "🍬", "🍷", "📓", "☀️"],
  people:   ["🫂", "💓", "👨‍👩‍👧", "🎂", "☎️", "🍻"],
  money:    ["💸", "💰", "📈", "🏦", "🧾", "🪙"],
  aviation: ["✈️", "🛫", "🛬", "🧑‍✈️", "📘", "🌙"],
  travel:   ["🌍", "🗺️", "🧳", "🏝️", "🏔️", "🚆"],
  culture:  ["📚", "📖", "🍽️", "🎬", "🎵", "🎨"],
  projects: ["🛠️", "🐍", "🪁", "🧮", "💻", "🚀"],
  home:     ["🏠", "🧹", "🪴", "🔧", "📦", "🛋️"],
  admin:    ["🗂️", "🪪", "📄", "🏛️", "🧾", "📅"],
  personal: ["✨", "🎯", "🏍️", "🧠", "🗣️", "🎸"],
};
