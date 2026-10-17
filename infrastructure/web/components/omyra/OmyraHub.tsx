"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Mountain, CalendarRange, Droplet } from "lucide-react";
import { RaceCockpit } from "@/components/race/RaceCockpit";
import OmyraTab from "@/components/training/OmyraTab";
import FuelTab from "@/components/training/FuelTab";

const TABS = [
  { key: "race", label: "Race", icon: Mountain },
  { key: "plan", label: "Plan", icon: CalendarRange },
  { key: "fuel", label: "Fuel", icon: Droplet },
] as const;
type Tab = (typeof TABS)[number]["key"];

// Omyra — the training home: the A-race cockpit first, then the plan behind it
// (goals, weeks, sessions) and fuelling. Deep links: /omyra?tab=plan, /omyra?plan=next.
export function OmyraHub() {
  const [tab, setTab] = useState<Tab>("race");
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t === "plan" || t === "fuel" || t === "race") setTab(t);
  }, []);

  function select(t: Tab) {
    setTab(t);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", t);
    url.searchParams.delete("plan");
    window.history.replaceState(null, "", url.toString());
  }

  return (
    <>
      <div className="mb-6">
        <div className="flex items-end justify-between gap-3 mb-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Omyra</h1>
            <p className="text-sm text-[#71717A] mt-0.5">Mallorca 312 · plan, coach & fuel</p>
          </div>
          <Link href="/training" className="text-xs text-[#71717A] hover:text-[#F59E0B] whitespace-nowrap">
            Training analytics →
          </Link>
        </div>
        <div className="flex gap-0 bg-[#0D0D0F] border border-[#27272A] rounded-lg p-1 w-full">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => select(key)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium whitespace-nowrap transition-colors ${
                tab === key ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"}`}>
              <Icon size={13} />{label}
            </button>
          ))}
        </div>
      </div>
      {tab === "race" && <RaceCockpit />}
      {tab === "plan" && <OmyraTab />}
      {tab === "fuel" && <FuelTab />}
    </>
  );
}
