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
