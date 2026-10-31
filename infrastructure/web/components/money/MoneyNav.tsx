"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Lightbulb, TrendingUp, PieChart } from "lucide-react";

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

// Same header + segmented tabs as Omyra.
export function MoneyNav() {
  const active = activeTab(usePathname());
  return (
    <div className="max-w-2xl mx-auto px-4 pt-8">
      <h1 className="text-2xl font-semibold tracking-tight">Money</h1>
      <p className="text-sm text-[#71717A] mt-0.5 mb-4">Spending, savings &amp; what you own</p>
      <nav className="flex gap-1 bg-[#0D0D0F] border border-[#27272A] rounded-2xl p-1 w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={`flex-1 shrink-0 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
              active === href ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"
            }`}
          >
            <Icon size={13} />
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
