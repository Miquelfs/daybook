// Sport identity palette (Plan C.1): color follows the sport everywhere.
// Plain module — safe to import from both server and client components.

export const SPORT_COLORS: Record<string, string> = {
  run: "#FB923C",   // coral
  ride: "#3B82F6",  // blue
  swim: "#2DD4BF",  // teal
  other: "#A1A1AA",
};

export function sportOf(activityType: string | null): "run" | "ride" | "swim" | "other" {
  const t = (activityType ?? "").toLowerCase();
  if (t.includes("run") || t.includes("jog") || t.includes("trail")) return "run";
  if (t.includes("cycl") || t.includes("bik") || t.includes("ride")) return "ride";
  if (t.includes("swim")) return "swim";
  return "other";
}

/** Icon for a plan session — by discipline, refined by the session type (gym, mobility, test…). */
export function sessionIcon(discipline: string | null | undefined, sessionType?: string | null): string {
  const d = (discipline ?? "").toLowerCase();
  const t = (sessionType ?? "").toLowerCase();
  if (t.includes("race day")) return "🏁";
  if (t.startsWith("test") && /bike|ftp|climb|ride|cycl/.test(t)) return "🚴";
  if (t.startsWith("test") && /run/.test(t)) return "🏃";
  if (t.startsWith("strength") || t.includes("gym")) return "🏋️";
  if (t.includes("mobility") || t.includes("yoga") || t.includes("stretch")) return "🧘";
  if (t.includes("rest")) return "😴";
  if (d === "brick") return "⚡";
  if (d === "cycling" || d === "ride" || d === "bike" || t.startsWith("cycling") || t.includes("ride")) return "🚴";
  if (d === "running" || d === "run" || t.startsWith("run")) return "🏃";
  if (d === "swimming" || d === "swim" || t.startsWith("swim")) return "🏊";
  return "🏋️";
}
