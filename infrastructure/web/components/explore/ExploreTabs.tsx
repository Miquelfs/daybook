"use client";

import { Database, Globe, PersonStanding } from "lucide-react";
import { SectionTabs } from "@/components/ui/kit";

const TABS = [
  { href: "/explore", label: "Travel", icon: Globe },
  { href: "/explore/movement", label: "Movement", icon: PersonStanding },
  { href: "/explore/databases", label: "Databases", icon: Database },
] as const;

/** Explore's sub-nav — Travel · Movement · Databases. */
export function ExploreTabs({ active }: { active: (typeof TABS)[number]["href"] }) {
  return <SectionTabs tabs={TABS} active={active} />;
}
