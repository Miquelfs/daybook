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

/** Groups for filtering and comparing activities: the activity list's chips, "similar" matches. */
export type SportFamily = "ride" | "run" | "swim" | "walk" | "racket" | "strength" | "snow" | "other";

export const FAMILY_LABEL: Record<SportFamily, string> = {
  ride: "Ride", run: "Run", swim: "Swim", walk: "Walk & hike", racket: "Tennis & padel",
  strength: "Gym & mobility", snow: "Snow", other: "Other",
};

export function sportFamily(activityType: string | null): SportFamily {
  const t = (activityType ?? "").toLowerCase();
  if (/tennis|padel|paddel|pickleball|squash|badminton|racquet/.test(t)) return "racket";
  const s = sportOf(t);
  if (s !== "other") return s;
  if (/walk|hik|trek/.test(t)) return "walk";
  if (/strength|gym|weight|yoga|pilates|stretch|mobility|hiit|crossfit|stop_?watch|workout/.test(t)) return "strength";
  if (/ski|snow/.test(t)) return "snow";
  return "other";
}
