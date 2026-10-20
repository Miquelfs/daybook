"use client";

import Link from "next/link";
import { List, BarChart2, MapPin, TrendingUp, Clock, Gauge, CalendarDays } from "lucide-react";

export type AviationTab = "overview" | "logbook" | "map" | "stats" | "punctuality" | "stress" | "roster";

export const AVIATION_TABS: { id: AviationTab; label: string; Icon: typeof List }[] = [
  { id: "overview", label: "Overview", Icon: List },
  { id: "logbook", label: "EASA", Icon: BarChart2 },
  { id: "map", label: "Routes", Icon: MapPin },
  { id: "stats", label: "Analytics", Icon: TrendingUp },
  { id: "punctuality", label: "Punctuality", Icon: Clock },
  { id: "stress", label: "Stress", Icon: Gauge },
  { id: "roster", label: "Roster", Icon: CalendarDays },
];

export function isAviationTab(v: string | null): v is AviationTab {
  return !!v && AVIATION_TABS.some(t => t.id === v);
}

/** Aviation sub-nav. With `onSelect` the logbook tabs switch in place; without it
 *  (the roster page) each tab links to /aviation?tab=… */
export function AviationTabs({ active, onSelect, className = "" }: {
  active: AviationTab;
  onSelect?: (t: AviationTab) => void;
  className?: string;
}) {
  const cls = (t: AviationTab) =>
    `flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium whitespace-nowrap transition-colors ${active === t
      ? "bg-[#27272A] text-[#FAFAFA]"
      : "text-[#52525B] hover:text-[#A1A1AA]"}`;

  return (
    <nav className={`flex gap-0 bg-[#0D0D0F] border border-[#27272A] rounded-lg p-1 overflow-x-auto ${className}`}>
      {AVIATION_TABS.map(({ id, label, Icon }) => {
        const body = <><Icon size={13} />{label}</>;
        if (id === "roster") {
          return <Link key={id} href="/aviation/roster" className={cls(id)} aria-current={active === id ? "page" : undefined}>{body}</Link>;
        }
        if (onSelect) {
          return <button key={id} className={cls(id)} onClick={() => onSelect(id)} aria-current={active === id ? "page" : undefined}>{body}</button>;
        }
        return <Link key={id} href={id === "overview" ? "/aviation" : `/aviation?tab=${id}`} className={cls(id)}>{body}</Link>;
      })}
    </nav>
  );
}
