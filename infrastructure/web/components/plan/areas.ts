// Areas tie goals, tasks and notes to the part of the daybook they belong to.
// A goal's area comes from its metric unless set; a task's area also puts it
// on that page (Money, Health, Logbook, …). Line icons (lucide, like the rest
// of the app) and mid-tone colours that read on both the dark and light theme.

import {
  Activity, Apple, Bike, BookOpen, Clock, Coins, Dumbbell, Earth, FileText, Flame, Footprints, Gauge,
  HeartPulse, House, Landmark, Luggage, Moon, Mountain, PiggyBank, Plane, PlaneLanding, PlaneTakeoff,
  Smartphone, Smile, Sparkles, Sprout, Timer, Users, Utensils, Wallet, Waves, Weight, Wrench, BatteryCharging,
  type LucideIcon,
} from "lucide-react";

export type AreaKey =
  | "training" | "health" | "food" | "habits" | "people" | "money" | "aviation"
  | "travel" | "culture" | "projects" | "home" | "admin" | "personal";

export interface Area {
  key: AreaKey;
  label: string;
  icon: LucideIcon;
  color: string;
  href: string | null;
}

export const AREAS: Record<AreaKey, Area> = {
  training: { key: "training", label: "Training",  icon: Activity,     color: "#EA580C", href: "/omyra" },
  health:   { key: "health",   label: "Health",    icon: HeartPulse,   color: "#C026D3", href: "/health" },
  food:     { key: "food",     label: "Food",      icon: Apple,        color: "#65A30D", href: "/food" },
  habits:   { key: "habits",   label: "Habits",    icon: Sprout,       color: "#0891B2", href: "/tags" },
  people:   { key: "people",   label: "People",    icon: Users,        color: "#DB2777", href: "/plan?tab=people" },
  money:    { key: "money",    label: "Money",     icon: Wallet,       color: "#059669", href: "/money" },
  aviation: { key: "aviation", label: "Aviation",  icon: PlaneTakeoff, color: "#2563EB", href: "/aviation" },
  travel:   { key: "travel",   label: "Travel",    icon: Earth,        color: "#0D9488", href: "/explore" },
  culture:  { key: "culture",  label: "Reading & culture", icon: BookOpen, color: "#7C3AED", href: "/explore" },
  projects: { key: "projects", label: "Projects",  icon: Wrench,       color: "#4F46E5", href: null },
  home:     { key: "home",     label: "Home",      icon: House,        color: "#CA8A04", href: null },
  admin:    { key: "admin",    label: "Admin",     icon: FileText,     color: "#64748B", href: null },
  personal: { key: "personal", label: "Personal",  icon: Sparkles,     color: "#D97706", href: null },
};

export const AREA_LIST = Object.values(AREAS);

export function area(key: string | null | undefined): Area {
  return AREAS[(key ?? "") as AreaKey] ?? AREAS.personal;
}

/** A goal's icon: what it measures, so a run and a ride don't look alike. Manual → its area. */
const METRIC_ICON: Record<string, LucideIcon> = {
  run_km: Footprints, ride_km: Bike, swim_km: Waves, workouts: Dumbbell, training_hours: Clock,
  elevation_m: Mountain, best_time: Timer, vo2max: Gauge,
  sleep_hours: Moon, steps: Footprints, resting_hr: HeartPulse, weight: Weight, screen_time: Smartphone,
  tag_days: Sprout, tag_streak: Flame, mood: Smile, energy: BatteryCharging,
  person_days: Users,
  net_worth: PiggyBank, saved: Coins, budget_months: Landmark,
  block_hours: Plane, pic_hours: PlaneTakeoff, sectors: Plane, landings: PlaneLanding,
  countries: Earth, new_countries: Earth, trips: Luggage,
  books: BookOpen, restaurants: Utensils,
};

export function goalIcon(metric: string, areaKey: string | null | undefined): LucideIcon {
  return METRIC_ICON[metric] ?? area(areaKey).icon;
}

/** Translucent fill of an area colour (hex + alpha) for tiles and chips. */
export function tint(color: string, alpha = 0.14): string {
  return `${color}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
}
