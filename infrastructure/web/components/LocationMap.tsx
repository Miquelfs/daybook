"use client";

import { useEffect, useRef } from "react";
import type { TracksGeoJSON } from "@/lib/api";

interface Props {
  geojson: TracksGeoJSON;
}

const SEMANTIC_ICON: Record<string, string> = {
  Home: "🏠",
  Work: "💼",
  home: "🏠",
  work: "💼",
};

// Single track colour — the line is one journey, dots distinguish stops
const TRACK_COLOR  = "#2563EB";  // blue line
const STOP_COLOR   = "#EA580C";  // orange dots at named stops
const MOVE_COLOR   = "#94A3B8";  // grey dots between segments

export function LocationMap({ geojson }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<{ remove: () => void } | null>(null);

  useEffect(() => {
    if (!containerRef.current || geojson.features.length === 0) return;

    let destroyed = false;

    import("leaflet").then((L) => {
      if (destroyed || !containerRef.current) return;

      // Clear any stale Leaflet instance (StrictMode / HMR)
      const node = containerRef.current as unknown as { _leaflet_id?: number };
      if (node._leaflet_id != null) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (L as any).map(containerRef.current).remove();
        } catch {
          delete node._leaflet_id;
        }
      }

      const map = L.map(containerRef.current, { zoomControl: true });
      mapRef.current = map;

      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
        {
          attribution:
            '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com">CARTO</a>',
          maxZoom: 19,
        }
      ).addTo(map);

      const allBounds: [number, number][] = [];

      // ── 1. Draw one continuous line through all LineString segment points ───
      const allLatlngs: [number, number][] = geojson.features.flatMap((f) => {
        if (f.geometry.type === "LineString") {
          const coords = f.geometry.coordinates as [number, number][];
          return coords.map(([lng, lat]): [number, number] => [lat, lng]);
        }
        // Point features contribute their single coordinate to the path
        const [lng, lat] = f.geometry.coordinates as [number, number];
        return [[lat, lng] as [number, number]];
      });
      allBounds.push(...allLatlngs);

      if (allLatlngs.length >= 2) {
        // White halo for contrast on light tiles
        L.polyline(allLatlngs, { color: "#fff", weight: 6, opacity: 0.55 }).addTo(map);
        L.polyline(allLatlngs, {
          color: TRACK_COLOR,
          weight: 3.5,
          opacity: 0.9,
        }).addTo(map);
      }

      // ── 2. Place a labelled dot at each segment's anchor point ──────────────
      // LineString → last coordinate; Point → its single coordinate.
      const seen = new Set<string>();

      geojson.features.forEach((feature) => {
        const props  = feature.properties;
        const name   = props.place_name ?? props.city ?? null;

        let latlng: [number, number];
        if (feature.geometry.type === "Point") {
          const [lng, lat] = feature.geometry.coordinates as [number, number];
          latlng = [lat, lng];
        } else {
          const coords = feature.geometry.coordinates as [number, number][];
          if (coords.length === 0) return;
          const [lng, lat] = coords[coords.length - 1];
          latlng = [lat, lng];
        }

        const key    = name ?? `${latlng.join(",")}`;
        const isStop = !!name && !seen.has(key);
        if (isStop) seen.add(key);

        allBounds.push(latlng);

        const dotColor = isStop ? STOP_COLOR : MOVE_COLOR;
        const radius   = isStop ? 7 : 4;

        const dot = L.circleMarker(latlng, {
          radius,
          color: "#fff",
          weight: 2,
          fillColor: dotColor,
          fillOpacity: 1,
        }).addTo(map);

        if (name) {
          const icon   = props.semantic_type ? (SEMANTIC_ICON[props.semantic_type] ?? "") : "";
          const city   = props.city && props.city !== name ? `<div style="font-size:11px;color:#888;margin-top:1px">${props.city}${props.country ? `, ${props.country}` : ""}</div>` : "";
          const start  = new Date(props.segment_start).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
          const end    = new Date(props.segment_end).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

          dot.bindPopup(
            `<div style="font-family:system-ui;min-width:140px">
              <div style="font-weight:600;font-size:13px;color:#111">${icon ? icon + " " : ""}${name}</div>
              ${city}
              <div style="font-size:11px;color:#555;margin-top:5px;border-top:1px solid #eee;padding-top:4px">${start} – ${end}</div>
            </div>`,
            { maxWidth: 240 }
          );
        }
      });

      if (allBounds.length > 0) {
        map.fitBounds(L.latLngBounds(allBounds), { padding: [32, 32], maxZoom: 15 });
      }
    });

    return () => {
      destroyed = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geojson.features.length]);

  if (geojson.features.length === 0) {
    return (
      <div className="border border-dashed border-[#27272A] rounded-lg px-4 py-6 text-center">
        <p className="text-sm text-[#52525B]">No GPS tracks for this day</p>
      </div>
    );
  }

  // Legend: deduplicated named stops in chronological order (both Point and LineString)
  const stops = geojson.features.filter((f) => f.properties.place_name ?? f.properties.city);
  const seen  = new Set<string>();
  const legendItems = stops.filter((f) => {
    const key = f.properties.place_name ?? f.properties.city ?? "";
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return (
    <div className="flex flex-col gap-3">
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <div className="rounded-xl overflow-hidden border border-[#27272A] shadow-sm">
        <div ref={containerRef} style={{ height: 360, width: "100%" }} />
      </div>

      {/* Legend — one row per unique named stop */}
      {legendItems.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {legendItems.map((f, i) => {
            const props = f.properties;
            const icon  = props.semantic_type ? (SEMANTIC_ICON[props.semantic_type] ?? null) : null;
            const name  = props.place_name ?? props.city ?? "Unknown";
            const start = new Date(props.segment_start).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
            const end   = new Date(props.segment_end).toLocaleTimeString("en-GB",   { hour: "2-digit", minute: "2-digit" });

            return (
              <div key={i} className="flex items-center gap-2 text-xs text-[#A1A1AA]">
                <span
                  className="shrink-0 w-2.5 h-2.5 rounded-full border-2 border-white/20"
                  style={{ backgroundColor: STOP_COLOR }}
                />
                {icon && <span className="text-sm leading-none">{icon}</span>}
                <span className="font-medium text-[#D4D4D8] truncate">{name}</span>
                {props.city && props.city !== name && (
                  <span className="text-[#52525B] truncate">{props.city}</span>
                )}
                <span className="ml-auto shrink-0 tabular-nums text-[#52525B]">
                  {start}–{end}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
