"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ArrowLeft, ArrowRight, Backpack, CalendarRange, Info as InfoIcon, LayoutGrid, ListChecks, Pencil, Wallet } from "lucide-react";
import { plansApi, type Task } from "@/lib/plans-api";
import { Avatar } from "@/components/plan/Avatar";
import { TaskSheet } from "@/components/plan/TaskSheet";
import { PlannedTripSheet } from "@/components/plan/TripsAhead";
import { TabBar } from "@/components/plan/ui";
import { Budget, Checklist, Info, Itinerary, Overview, Packing } from "@/components/trip/TripSections";

const TABS = [
  { key: "overview", label: "Overview", icon: LayoutGrid },
  { key: "itinerary", label: "Itinerary", icon: CalendarRange },
  { key: "checklist", label: "Checklist", icon: ListChecks },
  { key: "packing", label: "Packing", icon: Backpack },
  { key: "budget", label: "Budget", icon: Wallet },
  { key: "info", label: "Info", icon: InfoIcon },
] as const;
type Tab = (typeof TABS)[number]["key"];

/**
 * A planned trip, laid out like a trip document: overview (decisions, next
 * to-dos, risks), itinerary with where you sleep, checklist by phase, packing,
 * budget low / mid / high / actual, and the logistics notes. After it happens
 * it points to the detected trip, whose page shows this plan next to reality.
 */
export default function PlannedTripPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number(use(params).id);
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("overview");
  const [editing, setEditing] = useState(false);
  const [task, setTask] = useState<Task | null>(null);
  const { data: t, isLoading } = useQuery({ queryKey: ["planned-trip", id], queryFn: () => plansApi.plannedTrip(id) });

  if (isLoading) return <main className="max-w-2xl mx-auto px-4 pt-8"><div className="h-48 rounded-2xl bg-[#18181B] animate-pulse" /></main>;
  if (!t) return <main className="max-w-2xl mx-auto px-4 pt-8 text-sm text-[#71717A]">Trip not found.</main>;

  const today = format(new Date(), "yyyy-MM-dd");
  const past = t.end_date < today;
  const dayN = t.ongoing ? t.days.findIndex((d) => d.date === today) + 1 : null;

  return (
    <main className="max-w-2xl mx-auto px-4 pb-24 pt-8">
      <div className="mb-6">
        <Link href="/plan?tab=calendar" className="inline-flex items-center gap-1 text-xs text-[#71717A] hover:text-[#A1A1AA] uppercase tracking-widest mb-3">
          <ArrowLeft size={12} /> Plan
        </Link>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">{t.name}</h1>
            <p className="text-sm text-[#71717A] mt-0.5">
              {t.destination ? `${t.destination} · ` : ""}{format(parseISO(t.start_date), "EEE d MMM")} – {format(parseISO(t.end_date), "EEE d MMM yyyy")}
            </p>
            <div className="flex items-center gap-3 mt-2">
              <span className="text-sm font-semibold text-[#F59E0B] tabular-nums">
                {t.ongoing ? `Day ${dayN} of ${t.days.length}` : past ? "Back home" : t.days_until === 0 ? "Today!" : `${t.days_until} days to go`}
              </span>
              {t.with.length > 0 && (
                <span className="flex -space-x-2">{t.with.map((p) => <Avatar key={p.id} name={p.name} emoji={p.emoji} size={22} />)}</span>
              )}
            </div>
          </div>
          <button onClick={() => setEditing(true)}
                  className="shrink-0 inline-flex items-center gap-1 text-xs bg-[#F59E0B]/10 border border-[#F59E0B]/30 text-[#F59E0B] hover:bg-[#F59E0B]/20 rounded-lg px-3 py-1.5">
            <Pencil size={12} /> Edit
          </button>
        </div>
        {t.adopted_start && t.adopted_end && (
          <Link href={`/explore/trip/${t.adopted_start}/${t.adopted_end}`}
                className="mt-4 flex items-center justify-between rounded-2xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-400">
            It happened — see the trip, with this plan next to it <ArrowRight size={14} />
          </Link>
        )}
        <div className="mt-4"><TabBar tabs={TABS} value={tab} onChange={setTab} /></div>
      </div>

      {tab === "overview" && <Overview t={t} onTab={(x) => setTab(x as Tab)} />}
      {tab === "itinerary" && <Itinerary t={t} />}
      {tab === "checklist" && <Checklist t={t} onEdit={setTask} />}
      {tab === "packing" && <Packing t={t} />}
      {tab === "budget" && <Budget t={t} />}
      {tab === "info" && <Info t={t} />}

      {editing && <PlannedTripSheet trip={t} onClose={() => { setEditing(false); qc.invalidateQueries({ queryKey: ["planned-trip", id] }); }} />}
      {task && (
        <TaskSheet task={task} defaultTripId={id}
                   onClose={() => { setTask(null); qc.invalidateQueries({ queryKey: ["planned-trip", id] }); }} />
      )}
    </main>
  );
}
