import Link from "next/link";
import { Activity, AlertTriangle, Moon, Scale } from "lucide-react";

const TABS = [
  { href: "/health", label: "Overview", icon: Activity },
  { href: "/health/sleep", label: "Sleep", icon: Moon },
  { href: "/health/weight", label: "Weight", icon: Scale },
  { href: "/health/injuries", label: "Injuries", icon: AlertTriangle },
] as const;

/** Health's sub-nav (Omyra pill style) — one copy for every Health page. */
export function HealthTabs({ active }: { active: (typeof TABS)[number]["href"] }) {
  return (
    <div className="flex gap-0 bg-[#0D0D0F] border border-[#27272A] rounded-lg p-1 mt-4 w-full overflow-x-auto">
      {TABS.map(({ href, label, icon: Icon }) => (
        <Link key={href} href={href}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium whitespace-nowrap transition-colors ${
                href === active ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"}`}>
          <Icon size={13} />{label}
        </Link>
      ))}
    </div>
  );
}
