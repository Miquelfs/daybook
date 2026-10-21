// Areas tie goals, tasks and notes to the part of the daybook they belong to.
// A goal's area comes from its metric unless set; a task's area also puts it
// on that page (Money, Health, Logbook, …). Line icons, like the app's tabs.

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
  href: string | null;
}

export const AREAS: Record<AreaKey, Area> = {
  training: { key: "training", label: "Training",  icon: Activity,     href: "/omyra" },
  health:   { key: "health",   label: "Health",    icon: HeartPulse,   href: "/health" },
  food:     { key: "food",     label: "Food",      icon: Apple,        href: "/food" },
  habits:   { key: "habits",   label: "Habits",    icon: Sprout,       href: "/plan?tab=habits" },
  people:   { key: "people",   label: "People",    icon: Users,        href: "/plan?tab=people" },
  money:    { key: "money",    label: "Money",     icon: Wallet,       href: "/money" },
  aviation: { key: "aviation", label: "Aviation",  icon: PlaneTakeoff, href: "/aviation" },
  travel:   { key: "travel",   label: "Travel",    icon: Earth,        href: "/explore" },
  culture:  { key: "culture",  label: "Reading & culture", icon: BookOpen, href: "/explore" },
  projects: { key: "projects", label: "Projects",  icon: Wrench,       href: null },
  home:     { key: "home",     label: "Home",      icon: House,        href: null },
  admin:    { key: "admin",    label: "Admin",     icon: FileText,     href: null },
  personal: { key: "personal", label: "Personal",  icon: Sparkles,     href: null },
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
