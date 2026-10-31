"use client";

import { usePathname } from "next/navigation";
import { CalendarDays, Lightbulb, TrendingUp, PieChart } from "lucide-react";
import { PageHeader, SectionTabs } from "@/components/ui/kit";

const TABS = [
  { href: "/money", label: "This month", icon: CalendarDays },
  { href: "/money/insights", label: "Insights", icon: Lightbulb },
  { href: "/money/trends", label: "Trends", icon: TrendingUp },
  { href: "/money/portfolio", label: "Portfolio", icon: PieChart },
];

// Drill-downs light up the tab they belong to: a holding → Portfolio; a
// category, an account, the grocery basket or the budget planner → This month.
function activeTab(pathname: string): string {
  if (pathname.startsWith("/money/portfolio")) return "/money/portfolio";
  if (pathname.startsWith("/money/insights")) return "/money/insights";
  if (pathname.startsWith("/money/trends")) return "/money/trends";
  return "/money";
}

// The kit's header + section tabs, like every other area.
export function MoneyNav() {
  const active = activeTab(usePathname());
  return (
    <div className="max-w-2xl mx-auto px-4 pt-8">
      <PageHeader title="Money" subtitle="Spending, savings & what you own"
                  tabs={<SectionTabs tabs={TABS} active={active} />} />
    </div>
  );
}
