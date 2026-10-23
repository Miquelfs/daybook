"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/money", label: "This month" },
  { href: "/money/insights", label: "Insights" },
  { href: "/money/trends", label: "Trends" },
  { href: "/money/portfolio", label: "Portfolio" },
  { href: "/money/groceries", label: "Groceries" },
];

// One tab bar for the whole Money section. Drill-down pages (a category, an
// account, a holding) light up the tab they belong to.
function activeTab(pathname: string): string {
  if (pathname.startsWith("/money/portfolio")) return "/money/portfolio";
  if (pathname.startsWith("/money/groceries")) return "/money/groceries";
  if (pathname.startsWith("/money/insights")) return "/money/insights";
  if (pathname.startsWith("/money/trends")) return "/money/trends";
  return "/money";
}

export function MoneyNav() {
  const active = activeTab(usePathname());
  return (
    <nav className="max-w-2xl mx-auto px-4 pt-6">
      <div className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden border-b border-[#18181B]">
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={`shrink-0 px-3 py-2 text-sm -mb-px border-b-2 transition-colors ${
              active === t.href
                ? "border-[#F59E0B] text-[#FAFAFA] font-medium"
                : "border-transparent text-[#71717A] hover:text-[#D4D4D8]"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
