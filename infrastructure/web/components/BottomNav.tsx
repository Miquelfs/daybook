"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, List, Wallet, Globe, Camera, HeartPulse, TrendingUp, PlaneTakeoff } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";

const tabs = [
  { href: "/",             label: "Today",    icon: CalendarDays },
  { href: "/timeline",     label: "Timeline", icon: List },
  { href: "/moments",      label: "Moments",  icon: Camera },
  { href: "/money",        label: "Finance",  icon: Wallet },
  { href: "/health",       label: "Health",   icon: HeartPulse },
  { href: "/aviation",     label: "Logbook",  icon: PlaneTakeoff },
  { href: "/correlations", label: "Insights", icon: TrendingUp },
  { href: "/explore",      label: "Explore",  icon: Globe },
];

export function BottomNav() {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === "/") return pathname === "/" || pathname.startsWith("/day/");
    if (href === "/timeline") return pathname.startsWith("/timeline") || pathname.startsWith("/life");
    if (href === "/money") return pathname.startsWith("/money");
    if (href === "/health") return pathname.startsWith("/health");
    if (href === "/aviation") return pathname.startsWith("/aviation");
    if (href === "/correlations") return pathname.startsWith("/correlations");
    return pathname.startsWith(href);
  }

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-[#27272A] bg-[#09090B]/95 backdrop-blur-sm">
      <div className="flex items-center justify-center gap-1 max-w-2xl mx-auto px-4 h-11">
        {tabs.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              title={label}
              className={`flex items-center justify-center w-10 h-10 rounded-lg transition-colors ${
                active
                  ? "text-[#F59E0B] bg-[#F59E0B]/10"
                  : "text-[#52525B] hover:text-[#A1A1AA] hover:bg-[#18181B]"
              }`}
            >
              <Icon size={18} strokeWidth={active ? 2 : 1.5} />
            </Link>
          );
        })}
        <ThemeToggle />
      </div>
    </nav>
  );
}
