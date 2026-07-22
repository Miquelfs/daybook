"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, CalendarPlus, Pencil, Trash2 } from "lucide-react";
import { LifeGrid, LifeLegend, colorHex } from "@/components/LifeGrid";
import { AddPeriodSheet } from "@/components/life/AddPeriodSheet";
import { AddEventSheet } from "@/components/life/AddEventSheet";
import { api, type LifeGridResponse, type LifePeriod, type LifeEvent } from "@/lib/api";

const EVENT_TYPE_COLORS: Record<string, string> = {
  career:       "#60a5fa", // blue
  relationship: "#f472b6", // pink
  travel:       "#34d399", // emerald
  loss:         "#a1a1aa", // zinc
  achievement:  "#fbbf24", // amber
  other:        "#a78bfa", // violet
};

interface Props {
  grid: LifeGridResponse;
  periods: LifePeriod[];
  events: LifeEvent[];
}

export function LifeGridClient({ grid, periods, events }: Props) {
  const qc = useQueryClient();

  const [periodSheetOpen, setPeriodSheetOpen] = useState(false);
  const [eventSheetOpen, setEventSheetOpen]   = useState(false);
  const [editingPeriod, setEditingPeriod]     = useState<LifePeriod | null>(null);
  const [editingEvent, setEditingEvent]       = useState<LifeEvent | null>(null);
  const [fabOpen, setFabOpen]                 = useState(false);
  const [showArchive, setShowArchive]         = useState(false);
  const [mergeByLabel, setMergeByLabel]       = useState(false);

  // Category filter: empty set = all visible
  const [visibleCategories, setVisibleCategories] = useState<Set<string>>(new Set());
  const [eventsOnly, setEventsOnly]               = useState(false);

  const { mutate: deletePeriod } = useMutation({
    mutationFn: (id: number) => api.deletePeriod(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["life-grid"] });
      qc.invalidateQueries({ queryKey: ["life-periods"] });
    },
  });

  const { mutate: deleteEvent } = useMutation({
    mutationFn: (id: number) => api.deleteEvent(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["life-grid"] });
      qc.invalidateQueries({ queryKey: ["life-events"] });
    },
  });

  function toggleCategory(cat: string) {
    setVisibleCategories((prev) => {
      if (prev.size === 0) return new Set([cat]);
      const next = new Set(prev);
      if (next.has(cat)) {
        next.delete(cat);
        if (next.size === 0) return new Set();
      } else {
        next.add(cat);
      }
      return next;
    });
  }

  const currentAge = (() => {
    const bd = new Date(grid.birthdate);
    const today = new Date(grid.today);
    return (
      today.getFullYear() -
      bd.getFullYear() -
      (today < new Date(today.getFullYear(), bd.getMonth(), bd.getDate()) ? 1 : 0)
    );
  })();

  const weeksLived     = grid.cells.filter((c) => c.is_past || c.is_current).length;
  const weeksRemaining = grid.cells.length - weeksLived;

  const todayStr  = grid.today;
  const lifeEndStr = (() => {
    const bd = new Date(grid.birthdate);
    bd.setFullYear(bd.getFullYear() + 90);
    return bd.toISOString().slice(0, 10);
  })();
  const totalLifeDays = (new Date(lifeEndStr).getTime() - new Date(grid.birthdate).getTime()) / 86400000;
  const livedDays     = (new Date(todayStr).getTime() - new Date(grid.birthdate).getTime()) / 86400000;

  function periodStats(p: LifePeriod) {
    const start    = new Date(p.start_date).getTime();
    const rawEnd   = p.end_date ? new Date(p.end_date).getTime() : new Date(todayStr).getTime();
    const lifeEnd  = new Date(lifeEndStr).getTime();
    const birth    = new Date(grid.birthdate).getTime();
    const durDays  = (rawEnd - start) / 86400000;
    const pctLife  = Math.round((durDays / totalLifeDays) * 100 * 10) / 10;
    const pctLived = Math.round((durDays / livedDays) * 100 * 10) / 10;
    const ongoing  = !p.end_date;
    return { pctLife, pctLived, ongoing };
  }

  // Group periods by category, sorted by start_date within each group
  const periodsByCategory = periods.reduce<Record<string, LifePeriod[]>>((acc, p) => {
    (acc[p.category] ??= []).push(p);
    return acc;
  }, {});
  const categoryOrder = Object.keys(periodsByCategory).sort();
  categoryOrder.forEach((cat) => {
    periodsByCategory[cat].sort((a, b) => a.start_date.localeCompare(b.start_date));
  });

  // Combined view — aggregate periods that share a label (e.g. two "Barcelona"
  // stints, two "Iberia" jobs) into a single summary row per label.
  function combinedStats(list: LifePeriod[]) {
    const durDays = list.reduce((s, p) => {
      const start = new Date(p.start_date).getTime();
      const end = p.end_date ? new Date(p.end_date).getTime() : new Date(todayStr).getTime();
      return s + (end - start) / 86400000;
    }, 0);
    const pctLife = Math.round((durDays / totalLifeDays) * 100 * 10) / 10;
    const pctLived = Math.round((durDays / livedDays) * 100 * 10) / 10;
    const ongoing = list.some((p) => !p.end_date);
    const earliest = list.reduce((m, p) => (p.start_date < m ? p.start_date : m), list[0].start_date);
    const latest = ongoing ? null : list.reduce((m, p) => ((p.end_date ?? "") > m ? (p.end_date ?? "") : m), "");
    return { pctLife, pctLived, ongoing, stints: list.length, earliest, latest, color: list[0].color };
  }

  // For each category, group its periods by label, ordered by earliest start.
  const labelGroupsByCategory: Record<string, [string, LifePeriod[]][]> = {};
  categoryOrder.forEach((cat) => {
    const groups: Record<string, LifePeriod[]> = {};
    periodsByCategory[cat].forEach((p) => { (groups[p.label] ??= []).push(p); });
    labelGroupsByCategory[cat] = Object.entries(groups).sort(
      (a, b) => a[1][0].start_date.localeCompare(b[1][0].start_date)
    );
  });

  // Events sorted by date descending (most recent first)
  const sortedEvents = [...events].sort((a, b) => b.event_date.localeCompare(a.event_date));

  return (
    <div className="relative">
      {/* Stats row */}
      <div className="flex gap-6 mb-4 text-xs text-[#52525B]">
        <span><span className="text-[#A1A1AA] font-medium">{currentAge}</span> years old</span>
        <span><span className="text-[#A1A1AA] font-medium">{weeksLived.toLocaleString()}</span> weeks lived</span>
        <span><span className="text-[#A1A1AA] font-medium">{weeksRemaining.toLocaleString()}</span> weeks ahead</span>
      </div>

      {/* Grid */}
      <LifeGrid
        data={grid}
        visibleCategories={visibleCategories}
        eventsOnly={eventsOnly}
      />

      {/* Legend / filter pills */}
      <LifeLegend
        periods={periods}
        visibleCategories={visibleCategories}
        eventsOnly={eventsOnly}
        onToggleCategory={toggleCategory}
        onToggleEventsOnly={() => setEventsOnly((v) => !v)}
      />

      {/* Key */}
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-[#3F3F46]">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-[#27272A]" /> past
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-[#F59E0B]" /> now
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-[#18181B] opacity-60" /> future
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-white" /> event
        </span>
      </div>

      {/* Archive: periods + events */}
      {(periods.length > 0 || events.length > 0) && (
        <div className="mt-8">
          <button
            onClick={() => setShowArchive((v) => !v)}
            className="text-xs text-[#52525B] hover:text-[#A1A1AA] transition-colors mb-4 uppercase tracking-widest"
          >
            {showArchive ? "▾" : "▸"} Archive ({periods.length} periods · {events.length} events)
          </button>

          {showArchive && (
            <div className="flex flex-col gap-6">
              {/* View toggle: chronological vs combined-by-name */}
              {periods.length > 0 && (
                <div className="inline-flex self-start rounded-lg border border-[#27272A] p-0.5 bg-[#09090B] -mb-2">
                  <button
                    onClick={() => setMergeByLabel(false)}
                    className={`px-3 py-1 text-xs rounded-md transition-colors ${!mergeByLabel ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"}`}
                  >
                    Chronological
                  </button>
                  <button
                    onClick={() => setMergeByLabel(true)}
                    className={`px-3 py-1 text-xs rounded-md transition-colors ${mergeByLabel ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"}`}
                  >
                    Combined by name
                  </button>
                </div>
              )}

              {/* Combined-by-name view: one aggregated row per label */}
              {mergeByLabel && categoryOrder.map((cat) => (
                <div key={cat}>
                  <p className="text-xs text-[#52525B] uppercase tracking-widest mb-2">{cat}</p>
                  <div className="flex flex-col gap-1.5">
                    {labelGroupsByCategory[cat].map(([label, list]) => {
                      const { pctLife, pctLived, ongoing, stints, earliest, latest, color } = combinedStats(list);
                      return (
                        <div key={label} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-[#18181B] bg-[#0D0D0F]">
                          <span className="inline-block h-3 w-3 rounded-sm flex-shrink-0" style={{ background: colorHex(color) }} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-[#A1A1AA] truncate">
                              {label}
                              {stints > 1 && <span className="text-[#52525B] font-normal"> · {stints} stints</span>}
                            </p>
                            <p className="text-xs text-[#3F3F46]">
                              {earliest} → {latest ?? "ongoing"}
                            </p>
                            <p className="text-xs text-[#52525B] mt-0.5">
                              <span className="text-[#71717A]">{pctLife}%</span> of 90yr life
                              <span className="mx-1.5 text-[#27272A]">·</span>
                              <span className="text-[#71717A]">{pctLived}%</span> of life so far
                              {ongoing && <span className="text-[#3F3F46]"> · ongoing</span>}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* Periods grouped by category */}
              {!mergeByLabel && categoryOrder.map((cat) => (
                <div key={cat}>
                  <p className="text-xs text-[#52525B] uppercase tracking-widest mb-2">{cat}</p>
                  <div className="flex flex-col gap-1.5">
                    {periodsByCategory[cat].map((p) => {
                      const { pctLife, pctLived, ongoing } = periodStats(p);
                      return (
                      <div
                        key={p.id}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-[#18181B] bg-[#0D0D0F]"
                      >
                        <span
                          className="inline-block h-3 w-3 rounded-sm flex-shrink-0"
                          style={{ background: colorHex(p.color) }}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-[#A1A1AA] truncate">{p.label}</p>
                          <p className="text-xs text-[#3F3F46]">
                            {p.start_date} → {p.end_date ?? "ongoing"}
                          </p>
                          <p className="text-xs text-[#52525B] mt-0.5">
                            <span className="text-[#71717A]">{pctLife}%</span> of 90yr life
                            <span className="mx-1.5 text-[#27272A]">·</span>
                            <span className="text-[#71717A]">{pctLived}%</span> of life so far
                            {ongoing && <span className="text-[#3F3F46]"> · ongoing</span>}
                          </p>
                        </div>
                        <button
                          onClick={() => { setEditingPeriod(p); setPeriodSheetOpen(true); }}
                          className="text-[#3F3F46] hover:text-[#A1A1AA] transition-colors p-1"
                          title="Edit"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Delete "${p.label}"?`)) deletePeriod(p.id);
                          }}
                          className="text-[#3F3F46] hover:text-red-500 transition-colors p-1"
                          title="Delete"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    );
                    })}
                  </div>
                </div>
              ))}

              {/* Events */}
              {events.length > 0 && (
                <div>
                  <p className="text-xs text-[#52525B] uppercase tracking-widest mb-2">Events</p>
                  <div className="flex flex-col gap-1.5">
                    {sortedEvents.map((ev) => (
                      <div
                        key={ev.id}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-[#18181B] bg-[#0D0D0F]"
                      >
                        <span
                          className="inline-block h-2 w-2 rounded-full flex-shrink-0"
                          style={{ background: EVENT_TYPE_COLORS[ev.type] ?? "#FAFAFA" }}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-[#A1A1AA] truncate">{ev.label}</p>
                          <p className="text-xs text-[#3F3F46]">
                            {ev.event_date}
                            <span className="text-[#27272A]"> · {ev.type}</span>
                          </p>
                          {ev.notes && (
                            <p className="text-xs text-[#52525B] mt-0.5 italic truncate">{ev.notes}</p>
                          )}
                        </div>
                        <button
                          onClick={() => { setEditingEvent(ev); setEventSheetOpen(true); }}
                          className="text-[#3F3F46] hover:text-[#A1A1AA] transition-colors p-1"
                          title="Edit"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Delete "${ev.label}"?`)) deleteEvent(ev.id);
                          }}
                          className="text-[#3F3F46] hover:text-red-500 transition-colors p-1"
                          title="Delete"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* FAB */}
      <div className="fixed bottom-20 right-4 z-30 flex flex-col items-end gap-2">
        {fabOpen && (
          <>
            <button
              onClick={() => { setFabOpen(false); setEditingPeriod(null); setPeriodSheetOpen(true); }}
              className="flex items-center gap-2 bg-[#18181B] border border-[#27272A] text-[#A1A1AA] text-sm px-4 py-2.5 rounded-full shadow-lg hover:text-[#FAFAFA] transition-colors"
            >
              <CalendarPlus size={15} />
              Add period
            </button>
            <button
              onClick={() => { setFabOpen(false); setEditingEvent(null); setEventSheetOpen(true); }}
              className="flex items-center gap-2 bg-[#18181B] border border-[#27272A] text-[#A1A1AA] text-sm px-4 py-2.5 rounded-full shadow-lg hover:text-[#FAFAFA] transition-colors"
            >
              <Plus size={15} />
              Add event
            </button>
          </>
        )}

        <button
          onClick={() => setFabOpen((v) => !v)}
          className={`flex items-center justify-center w-12 h-12 rounded-full shadow-xl transition-all ${
            fabOpen
              ? "bg-[#27272A] text-[#A1A1AA] rotate-45"
              : "bg-[#F59E0B] text-[#09090B] hover:bg-[#D97706]"
          }`}
          title="Add"
        >
          <Plus size={20} />
        </button>
      </div>

      {fabOpen && (
        <div className="fixed inset-0 z-20" onClick={() => setFabOpen(false)} />
      )}

      <AddPeriodSheet
        isOpen={periodSheetOpen}
        editing={editingPeriod}
        existingCategories={[...new Set(periods.map((p) => p.category))]}
        onClose={() => { setPeriodSheetOpen(false); setEditingPeriod(null); }}
      />
      <AddEventSheet
        isOpen={eventSheetOpen}
        editing={editingEvent}
        onClose={() => { setEventSheetOpen(false); setEditingEvent(null); }}
      />
    </div>
  );
}
