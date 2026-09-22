"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { MapPin, ArrowRight, ChevronDown } from "lucide-react";
import { LocationMap, type LocationMapHandle } from "@/components/LocationMap";
import type { TracksGeoJSON } from "@/lib/api";

const SEMANTIC_ICON: Record<string, string> = { Home: "🏠", Work: "💼", home: "🏠", work: "💼" };

function shortDate(d: string): string {
  return new Date(d + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/**
 * The interactive trip journey: one map you can scrub day-by-day, with visible
 * place-name labels and a chronological list of the named stops for whichever
 * day (or the whole trip) is selected.
 */
type Stop = { date?: string; name: string; mapKey: string; city: string | null; start: string; end: string; semantic: string | null };

export function TripJourney({ dates, geojson }: { dates: string[]; geojson: TracksGeoJSON }) {
  const [selected, setSelected] = useState<string>("all");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  // "All days" starts fully collapsed (one trip can have 100+ stops); a single
  // day's list starts open since it's already a much shorter list.
  const [openDates, setOpenDates] = useState<Set<string>>(new Set());
  const [dayListOpen, setDayListOpen] = useState(true);
  const mapRef = useRef<LocationMapHandle>(null);
  const mapWrapRef = useRef<HTMLDivElement>(null);

  function toggleDate(d: string) {
    setOpenDates((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d); else next.add(d);
      return next;
    });
  }

  const features = useMemo(
    () => (selected === "all" ? geojson.features : geojson.features.filter((f) => f.properties.date === selected)),
    [selected, geojson.features]
  );

  const filtered: TracksGeoJSON = { type: "FeatureCollection", features };

  // Named stops for the current selection, chronological, de-duped.
  const stops = useMemo(() => {
    const out: Stop[] = [];
    const seen = new Set<string>();
    const sorted = [...features].sort((a, b) => a.properties.segment_start.localeCompare(b.properties.segment_start));
    for (const f of sorted) {
      const name = f.properties.place_name;
      if (!name) continue;
      // De-dupe the *displayed* list per day-in-"all"-view, but the map only
      // ever registers one marker per name — so jumping to it always targets
      // that bare name, regardless of which day's row was clicked.
      const key = selected === "all" ? `${f.properties.date}|${name}` : name;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        date: f.properties.date,
        name,
        mapKey: name,
        city: f.properties.city,
        start: f.properties.segment_start,
        end: f.properties.segment_end,
        semantic: f.properties.semantic_type,
      });
    }
    return out;
  }, [features, selected]);

  // Grouped by day for "all" mode — one collapsible section per date instead
  // of one giant flat list of every stop across the whole trip.
  const groupedByDate = useMemo(() => {
    if (selected !== "all") return null;
    const map = new Map<string, Stop[]>();
    for (const s of stops) {
      const key = s.date ?? "";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [stops, selected]);

  function focusStop(s: Stop) {
    setActiveKey(s.mapKey);
    mapWrapRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    mapRef.current?.focusPlace(s.mapKey);
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Day scrubber */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        <button
          onClick={() => setSelected("all")}
          className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            selected === "all" ? "bg-[#F59E0B] text-[#0D0D0F]" : "bg-[#0D0D0F] border border-[#27272A] text-[#A1A1AA] hover:text-[#FAFAFA]"
          }`}
        >
          All days
        </button>
        {dates.map((d, i) => (
          <button
            key={d}
            onClick={() => setSelected(d)}
            className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              selected === d ? "bg-[#F59E0B] text-[#0D0D0F]" : "bg-[#0D0D0F] border border-[#27272A] text-[#A1A1AA] hover:text-[#FAFAFA]"
            }`}
          >
            D{i + 1} · {shortDate(d)}
          </button>
        ))}
      </div>

      {/* Map — remount on selection so the frame + labels rebuild cleanly.
          Pass `date` only for a single day so per-leg mode editing works there. */}
      <div ref={mapWrapRef}>
        <LocationMap
          ref={mapRef}
          key={selected}
          geojson={filtered}
          showLabels={selected !== "all"}
          date={selected !== "all" ? selected : undefined}
        />
      </div>

      {/* Places list — grouped & collapsible per day in "all" mode; a single
          collapsible section for one day, so either view can be tucked away
          instead of dumping every stop in one long flat list. */}
      {stops.length > 0 ? (
        groupedByDate ? (
          <div className="flex flex-col gap-2">
            {groupedByDate.map(([date, items]) => {
              const isOpen = openDates.has(date);
              const dayIdx = dates.indexOf(date);
              return (
                <div key={date || "unknown"} className="rounded-lg border border-[#18181B] overflow-hidden">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleDate(date)}
                    onKeyDown={(e) => { if (e.key === "Enter") toggleDate(date); }}
                    className="w-full flex items-center justify-between px-3 py-2 hover:bg-[#18181B] transition-colors cursor-pointer"
                  >
                    <span className="text-xs font-medium text-[#A1A1AA]">
                      {dayIdx >= 0 ? `D${dayIdx + 1} · ` : ""}{date ? shortDate(date) : "Unknown day"}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="text-[10px] text-[#52525B] tabular-nums">{items.length} place{items.length === 1 ? "" : "s"}</span>
                      <ChevronDown size={12} className={`text-[#52525B] transition-transform ${isOpen ? "rotate-180" : ""}`} />
                    </span>
                  </div>
                  {isOpen && (
                    <div className="px-2 pb-2 pt-1 border-t border-[#18181B]">
                      <StopsTimeline items={items} activeKey={activeKey} onFocus={focusStop} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-lg border border-[#18181B] overflow-hidden">
            <div
              role="button"
              tabIndex={0}
              onClick={() => setDayListOpen((o) => !o)}
              onKeyDown={(e) => { if (e.key === "Enter") setDayListOpen((o) => !o); }}
              className="w-full flex items-center justify-between px-3 py-2 hover:bg-[#18181B] transition-colors cursor-pointer"
            >
              <span className="text-xs text-[#52525B] uppercase tracking-widest">{stops.length} place{stops.length === 1 ? "" : "s"}</span>
              <span className="flex items-center gap-3">
                <Link
                  href={`/day/${selected}`}
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 text-xs text-[#71717A] hover:text-[#F59E0B] transition-colors"
                >
                  Open day <ArrowRight size={11} />
                </Link>
                <ChevronDown size={12} className={`text-[#52525B] transition-transform ${dayListOpen ? "rotate-180" : ""}`} />
              </span>
            </div>
            {dayListOpen && (
              <div className="px-2 pb-2 pt-1 border-t border-[#18181B]">
                <StopsTimeline items={stops} activeKey={activeKey} onFocus={focusStop} />
              </div>
            )}
          </div>
        )
      ) : (
        <p className="text-xs text-[#52525B] text-center py-2">No named stops for this {selected === "all" ? "trip" : "day"}.</p>
      )}
    </div>
  );
}

// One stop row — a small icon "bead" that sits on a continuous vertical line
// shared by the whole group, giving the list a journey/timeline feel instead
// of a flat list of disconnected pins.
function StopsTimeline({ items, activeKey, onFocus }: {
  items: Stop[];
  activeKey: string | null;
  onFocus: (s: Stop) => void;
}) {
  return (
    <div className="relative">
      {items.length > 1 && <div className="absolute left-3 top-3 bottom-3 w-px bg-[#27272A]" />}
      <div className="flex flex-col gap-0.5">
        {items.map((s, i) => (
          <button
            key={i}
            onClick={() => onFocus(s)}
            className={`relative flex items-start gap-3 w-full text-left py-1.5 pr-2 rounded-lg transition-colors ${
              activeKey === s.mapKey ? "bg-[#18181B]" : "hover:bg-[#18181B]"
            }`}
          >
            <span className="relative z-10 shrink-0 w-6 h-6 rounded-full bg-[#0D0D0F] border border-[#27272A] flex items-center justify-center text-xs">
              {s.semantic ? SEMANTIC_ICON[s.semantic] ?? <MapPin size={12} className="text-[#F59E0B]" /> : <MapPin size={12} className="text-[#F59E0B]" />}
            </span>
            <div className="flex-1 min-w-0 pt-0.5">
              <span className="text-sm text-[#D4D4D8] truncate block">{s.name}</span>
              {s.city && s.city !== s.name && <span className="text-xs text-[#52525B]">{s.city}</span>}
            </div>
            <span className="text-xs text-[#52525B] tabular-nums shrink-0 pt-1">{hhmm(s.start)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
