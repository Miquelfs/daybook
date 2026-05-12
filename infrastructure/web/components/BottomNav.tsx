"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, List, Wallet, Globe } from "lucide-react";

const tabs = [
  { href: "/",         label: "Today",    icon: CalendarDays },
  { href: "/timeline", label: "Timeline", icon: List },
  { href: "/money",    label: "Finance",  icon: Wallet },
  { href: "/explore",  label: "Explore",  icon: Globe },
];

export function BottomNav() {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === "/") return pathname === "/" || pathname.startsWith("/day/");
    return pathname.startsWith(href);
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-[#27272A] bg-[#09090B]/95 backdrop-blur-sm pb-safe">
      <div className="flex items-center justify-around max-w-2xl mx-auto">
        {tabs.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-col items-center gap-1 px-4 py-3 text-[10px] uppercase tracking-widest transition-colors ${
                active
                  ? "text-[#F59E0B]"
                  : "text-[#52525B] hover:text-[#A1A1AA]"
              }`}
            >
              <Icon size={20} strokeWidth={active ? 2 : 1.5} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
