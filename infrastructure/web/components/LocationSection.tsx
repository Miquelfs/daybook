"use client";

import { useState } from "react";
import { LocationMap } from "@/components/LocationMap";
import type { TracksGeoJSON } from "@/lib/api";

const BASE =
  (typeof window === "undefined" ? process.env.API_INTERNAL_URL : undefined) ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

const STOP_COLOR = "#EA580C";

interface Props {
  date: string;
  initialTracks: TracksGeoJSON;
  editable?: boolean;
}

function fmtDist(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function computeDistanceM(tracks: TracksGeoJSON): number {
  let total = 0;
  const features = tracks.features;

  const endOf = (f: TracksGeoJSON["features"][number]): [number, number] | null => {
    if (f.geometry.type === "Point") {
      const [lng, lat] = f.geometry.coordinates as [number, number];
      return [lat, lng];
    }
    if (f.geometry.type === "LineString") {
      const coords = f.geometry.coordinates as [number, number][];
      if (!coords.length) return null;
      const [lng, lat] = coords[coords.length - 1];
      return [lat, lng];
    }
    return null;
  };

  const startOf = (f: TracksGeoJSON["features"][number]): [number, number] | null => {
    if (f.geometry.type === "Point") {
      const [lng, lat] = f.geometry.coordinates as [number, number];
      return [lat, lng];
    }
    if (f.geometry.type === "LineString") {
      const coords = f.geometry.coordinates as [number, number][];
      if (!coords.length) return null;
      const [lng, lat] = coords[0];
      return [lat, lng];
    }
    return null;
  };

  for (let i = 0; i < features.length; i++) {
    const f = features[i];

    if (f.geometry.type === "LineString") {
      const coords = f.geometry.coordinates as [number, number][];
      for (let j = 1; j < coords.length; j++) {
        const [lng1, lat1] = coords[j - 1];
        const [lng2, lat2] = coords[j];
        total += haversineM(lat1, lng1, lat2, lng2);
      }
    }

    if (i < features.length - 1) {
      const e = endOf(f);
      const s = startOf(features[i + 1]);
      if (e && s) total += haversineM(e[0], e[1], s[0], s[1]);
    }
  }

  return total;
}

export function LocationSection({ date, initialTracks, editable = false }: Props) {
  const [tracks, setTracks] = useState<TracksGeoJSON>(initialTracks);
  const [listOpen, setListOpen] = useState(false);

  const refresh = () => {
    fetch(`${BASE}/locations/tracks/${date}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => setTracks(data))
      .catch(() => {});
  };

  const distanceM = computeDistanceM(tracks);

  // Build deduplicated named stop list for the collapsible
  const stops = tracks.features.filter((f) => f.properties.place_name ?? f.properties.city);
  const seen = new Set<string>();
  const legendItems = stops.filter((f) => {
    const key = f.properties.place_name ?? f.properties.city ?? "";
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const hasData = distanceM > 0 || legendItems.length > 0;

  return (
    <div className="flex flex-col gap-3">
      {/* Distance + place count summary row */}
      {hasData && (
        <div className="flex items-center gap-3">
          {distanceM > 0 && (
            <span className="text-sm font-semibold text-[#FAFAFA] tabular-nums">
              {fmtDist(distanceM)}
              <span className="text-xs text-[#52525B] font-normal ml-1">traveled</span>
            </span>
          )}
          {legendItems.length > 0 && (
            <span className="text-xs text-[#52525B]">
              {legendItems.length} {legendItems.length === 1 ? "place" : "places"}
            </span>
          )}
        </div>
      )}

      {/* Map */}
      <LocationMap
        geojson={tracks}
        editable={editable}
        date={date}
        onVisitAdded={refresh}
      />

      {/* Show/hide places toggle + collapsible list */}
      {legendItems.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <button
            onClick={() => setListOpen((o) => !o)}
            className="flex items-center gap-1.5 text-xs text-[#52525B] hover:text-[#A1A1AA] transition-colors self-start"
          >
            <span className={`inline-block transition-transform duration-150 ${listOpen ? "rotate-90" : ""}`}>▶</span>
            {listOpen ? "Hide places" : `Show places (${legendItems.length})`}
          </button>

          {listOpen && (
            <div className="flex flex-col gap-1.5 mt-1">
              {legendItems.map((f, i) => {
                const props = f.properties;
                const name  = props.place_name ?? props.city ?? "Unknown";
                const start = new Date(props.segment_start).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
                const end   = new Date(props.segment_end).toLocaleTimeString("en-GB",   { hour: "2-digit", minute: "2-digit" });
                return (
                  <div key={i} className="flex items-center gap-2 text-xs text-[#A1A1AA]">
                    <span className="shrink-0 w-2.5 h-2.5 rounded-full border-2 border-white/20" style={{ backgroundColor: STOP_COLOR }} />
                    <span className="font-medium text-[#D4D4D8] truncate">{name}</span>
                    {props.city && props.city !== name && (
                      <span className="text-[#52525B] truncate">{props.city}</span>
                    )}
                    <span className="ml-auto shrink-0 tabular-nums text-[#52525B]">{start}–{end}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
