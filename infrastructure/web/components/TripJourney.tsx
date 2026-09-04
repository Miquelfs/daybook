"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { MapPin, ArrowRight } from "lucide-react";
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
export function TripJourney({ dates, geojson }: { dates: string[]; geojson: TracksGeoJSON }) {
  const [selected, setSelected] = useState<string>("all");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const mapRef = useRef<LocationMapHandle>(null);
  const mapWrapRef = useRef<HTMLDivElement>(null);

  const features = useMemo(
    () => (selected === "all" ? geojson.features : geojson.features.filter((f) => f.properties.date === selected)),
    [selected, geojson.features]
  );

  const filtered: TracksGeoJSON = { type: "FeatureCollection", features };

  // Named stops for the current selection, chronological, de-duped.
  const stops = useMemo(() => {
    const out: { date?: string; name: string; mapKey: string; city: string | null; start: string; end: string; semantic: string | null }[] = [];
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

      {/* Map — remount on selection so the frame + labels rebuild cleanly */}
      <div ref={mapWrapRef}>
        <LocationMap ref={mapRef} key={selected} geojson={filtered} showLabels={selected !== "all"} />
      </div>

      {/* Places list */}
      {stops.length > 0 ? (
        <div className="flex flex-col gap-1">
          {selected !== "all" && (
            <div className="flex items-center justify-between">
              <p className="text-xs text-[#52525B] uppercase tracking-widest">{stops.length} place{stops.length === 1 ? "" : "s"}</p>
              <Link href={`/day/${selected}`} className="inline-flex items-center gap-1 text-xs text-[#71717A] hover:text-[#F59E0B] transition-colors">
                Open day <ArrowRight size={11} />
              </Link>
            </div>
          )}
          {stops.map((s, i) => (
            <button
              key={i}
              onClick={() => {
                setActiveKey(s.mapKey);
                mapWrapRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                mapRef.current?.focusPlace(s.mapKey);
              }}
              className={`flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-lg transition-colors ${
                activeKey === s.mapKey ? "bg-[#18181B]" : "hover:bg-[#18181B]"
              }`}
            >
              <span className="text-sm w-5 text-center shrink-0">{s.semantic ? SEMANTIC_ICON[s.semantic] ?? <MapPin size={13} className="inline text-[#F59E0B]" /> : <MapPin size={13} className="inline text-[#F59E0B]" />}</span>
              <div className="flex-1 min-w-0">
                <span className="text-sm text-[#D4D4D8] truncate">{s.name}</span>
                {s.city && s.city !== s.name && <span className="text-xs text-[#52525B] ml-2">{s.city}</span>}
              </div>
              {selected === "all" && s.date && (
                <span className="text-[10px] text-[#3F3F46] tabular-nums shrink-0">{shortDate(s.date)}</span>
              )}
              <span className="text-xs text-[#52525B] tabular-nums shrink-0">{hhmm(s.start)}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-[#52525B] text-center py-2">No named stops for this {selected === "all" ? "trip" : "day"}.</p>
      )}
    </div>
  );
}
