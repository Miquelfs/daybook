"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Activity, Mountain, CalendarRange, List, Zap, TrendingUp, Map, Droplet, Flame, Plus } from "lucide-react";
import { RaceCockpit } from "@/components/race/RaceCockpit";
import OmyraTab from "@/components/training/OmyraTab";
import FuelTab from "@/components/training/FuelTab";
import FitnessFreshnessChart from "@/components/training/FitnessFreshnessChart";
import RelativeEffortChart from "@/components/training/RelativeEffortChart";
import TrainingLogCalendar from "@/components/training/TrainingLogCalendar";
import { VolumeChart, ProgressComparisonChart } from "@/components/training/ProgressChart";
import { TrainingRouteMap } from "@/components/training/TrainingRouteMap";
import { TrainingOverview } from "@/components/omyra/TrainingOverview";
import { AddActivitySheet } from "@/components/omyra/AddActivitySheet";
import { AreaPlan } from "@/components/plan/AreaPlan";
import { ActivityStreaks } from "@/components/training/ActivityStreaks";

const TABS = [
  { key: "training", label: "Training", icon: Activity },
  { key: "race", label: "Mallorca 312", icon: Mountain },
  { key: "plan", label: "Plan", icon: CalendarRange },
  { key: "log", label: "Log", icon: List },
  { key: "load", label: "Load", icon: Zap },
  { key: "progress", label: "Progress", icon: TrendingUp },
  { key: "streaks", label: "Streaks", icon: Flame },
  { key: "map", label: "Map", icon: Map },
  { key: "fuel", label: "Fuel", icon: Droplet },
] as const;
type Tab = (typeof TABS)[number]["key"];
const KEYS = TABS.map((t) => t.key) as readonly string[];

function Block({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-2">{title}</h2>
      {note && <p className="text-xs text-[#52525B] mb-3">{note}</p>}
      <div className="bg-[#0D0D0F] border border-[#27272A] rounded-2xl p-4">{children}</div>
    </div>
  );
}

// Omyra — training as its own home: Training overview first (with the Mallorca 312
// banner), then the race cockpit, the plan and the analytics.
// Deep links: /omyra?tab=race|plan|log|load|progress|streaks|map|fuel, /omyra?plan=next (→ race).
export function OmyraHub() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("training");
  const [showAdd, setShowAdd] = useState(false);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const t = p.get("tab");
    if (t && KEYS.includes(t)) setTab(t as Tab);
    else if (p.get("plan") === "next") setTab("race");
  }, []);

  function select(t: Tab) {
    setTab(t);
    const url = new URL(window.location.href);
    if (t === "training") url.searchParams.delete("tab"); else url.searchParams.set("tab", t);
    url.searchParams.delete("plan");
    window.history.replaceState(null, "", url.toString());
    window.scrollTo({ top: 0 });
  }

  return (
    <>
      <div className="mb-6">
        <div className="flex items-end justify-between gap-3 mb-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Omyra</h1>
            <p className="text-sm text-[#71717A] mt-0.5">Training, Mallorca 312 & everything in between</p>
          </div>
          <button onClick={() => setShowAdd(true)}
                  className="inline-flex items-center gap-1 text-xs bg-[#F59E0B]/10 border border-[#F59E0B]/30 text-[#F59E0B] hover:bg-[#F59E0B]/20 rounded-lg px-3 py-1.5 transition-colors">
            <Plus size={13} />Log
          </button>
        </div>
        <div className="flex gap-1 bg-[#0D0D0F] border border-[#27272A] rounded-xl p-1 w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => select(key)}
              className={`shrink-0 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                tab === key ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"}`}>
              <Icon size={13} />{label}
            </button>
          ))}
        </div>
      </div>

      <AreaPlan area="training" className="mb-6" />

      {tab === "training" && <TrainingOverview onOpenRace={() => select("race")} />}
      {tab === "race" && <RaceCockpit />}
      {tab === "plan" && <OmyraTab />}
      {tab === "fuel" && <FuelTab />}
      {tab === "streaks" && <ActivityStreaks />}
      {tab === "log" && <Block title="Training log"><TrainingLogCalendar /></Block>}
      {tab === "load" && (
        <section className="space-y-6">
          <Block title="Fitness & freshness" note="Fitness (42-day load), fatigue (7-day load) and form. Tap a day to see what drove it.">
            <FitnessFreshnessChart />
          </Block>
          <Block title="Weekly relative effort" note="Weekly load with a 3-week rolling band — the amber zone is your normal range.">
            <RelativeEffortChart />
          </Block>
        </section>
      )}
      {tab === "progress" && (
        <section className="space-y-6">
          <Block title="Volume over time"><VolumeChart /></Block>
          <Block title="Year over year"><ProgressComparisonChart /></Block>
        </section>
      )}
      {tab === "map" && <TrainingRouteMap />}

      {showAdd && (
        <AddActivitySheet onClose={() => setShowAdd(false)} onSaved={() => {
          qc.invalidateQueries({ queryKey: ["training-activities"] });
          qc.invalidateQueries({ queryKey: ["training-summary"] });
        }} />
      )}
    </>
  );
}
