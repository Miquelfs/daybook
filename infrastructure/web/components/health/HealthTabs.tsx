"use client";

import { Activity, AlertTriangle, Moon, Scale } from "lucide-react";
import { SectionTabs } from "@/components/ui/kit";

const TABS = [
  { href: "/health", label: "Overview", icon: Activity },
  { href: "/health/sleep", label: "Sleep", icon: Moon },
  { href: "/health/weight", label: "Weight", icon: Scale },
  { href: "/health/injuries", label: "Injuries", icon: AlertTriangle },
] as const;

/** Health's sub-nav — one copy for every Health page. */
export function HealthTabs({ active }: { active: (typeof TABS)[number]["href"] }) {
  return <SectionTabs tabs={TABS} active={active} />;
}
