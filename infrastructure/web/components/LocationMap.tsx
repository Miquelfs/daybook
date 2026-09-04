"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { TracksGeoJSON } from "@/lib/api";
import { SPORT_COLORS, sportOf } from "@/lib/sport";

interface Props {
  geojson: TracksGeoJSON;
  editable?: boolean;
  date?: string;
  onVisitAdded?: () => void;
  showLabels?: boolean;   // permanent place-name tooltips on named stops
}

/** Imperative handle so a places list elsewhere on the page can jump the map
 * to a stop and pop its marker open, instead of the stop just being dead text. */
export interface LocationMapHandle {
  focusPlace: (key: string) => void;
}

const SEMANTIC_ICON: Record<string, string> = {
  Home: "🏠", Work: "💼", home: "🏠", work: "💼",
};

const STOP_COLOR  = "#EA580C";
const PIN_COLOR   = "#F59E0B";

// Route coloring: authoritative exercise mode (from a logged Garmin/Strava
// activity) wins when a leg overlaps one; everything else falls back to a
// coarse, honest speed tier — we can't reliably tell car from bus from train
// off raw GPS alone, so "vehicle" doesn't pretend to know which.
const MODE_STYLE: Record<string, { color: string; label: string }> = {
  run:        { color: SPORT_COLORS.run,  label: "Run" },
  ride:       { color: SPORT_COLORS.ride, label: "Ride" },
  swim:       { color: SPORT_COLORS.swim, label: "Swim" },
  other_ex:   { color: SPORT_COLORS.other, label: "Exercise" },
  foot:       { color: "#94A3B8", label: "On foot" },
  vehicle:    { color: "#8B5CF6", label: "Vehicle" },
  stationary: { color: "#52525B", label: "Stationary" },
};
const MOVE_COLOR = MODE_STYLE.foot.color;

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

/** Classify the leg between two consecutive track points. An activity_type
 * on either endpoint (a logged Garmin/Strava session) is authoritative;
 * otherwise fall back to a speed-derived tier. */
function classifyLeg(
  a: { latlng: [number, number]; time: string; activityType: string | null },
  b: { latlng: [number, number]; time: string; activityType: string | null }
): string {
  const activityType = b.activityType ?? a.activityType;
  if (activityType) {
    const sport = sportOf(activityType);
    return sport === "other" ? "other_ex" : sport;
  }
  const distM = haversineM(a.latlng[0], a.latlng[1], b.latlng[0], b.latlng[1]);
  const durS = (new Date(b.time).getTime() - new Date(a.time).getTime()) / 1000;
  if (durS <= 0 || distM < 15) return "stationary";
  const speedKmh = (distM / 1000) / (durS / 3600);
  if (speedKmh < 1.5) return "stationary";
  if (speedKmh <= 7) return "foot";
  return "vehicle";
}

export const LocationMap = forwardRef<LocationMapHandle, Props>(function LocationMap(
  { geojson, editable = false, date, onVisitAdded, showLabels = false },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef       = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pinMarkerRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef   = useRef<Map<string, any>>(new Map());
  const [modesUsed, setModesUsed] = useState<string[]>([]);

  const [pinMode, setPinMode]     = useState(false);
  const [pending, setPending]     = useState<{ lat: number; lng: number } | null>(null);
  const [placeName, setPlaceName] = useState("");
  const [arrivedAt, setArrivedAt] = useState("");
  const [departedAt, setDepartedAt] = useState("");
  const [geocoding, setGeocoding] = useState(false);
  const [saving, setSaving]       = useState(false);

  useImperativeHandle(ref, () => ({
    focusPlace: (key: string) => {
      const map = mapRef.current;
      const marker = markersRef.current.get(key);
      if (!map || !marker) return;
      const targetZoom = Math.max(map.getZoom(), 16);
      map.flyTo(marker.getLatLng(), targetZoom, { duration: 0.6 });
      marker.openPopup();
    },
  }), []);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.style.cursor = pinMode ? "crosshair" : "";
  }, [pinMode]);

  useEffect(() => {
    if (!mapRef.current || !pinMode) return;
    const map = mapRef.current;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onClick = (e: any) => {
      const { lat, lng } = e.latlng;
      const now = new Date();
      const hhmm = now.toTimeString().slice(0, 5);
      const later = new Date(now.getTime() + 30 * 60000).toTimeString().slice(0, 5);
      setPending({ lat, lng });
      setPlaceName("");
      setArrivedAt(hhmm);
      setDepartedAt(later);
      setPinMode(false);

      setGeocoding(true);
      const params = new URLSearchParams({ lat: String(lat), lon: String(lng), format: "jsonv2", zoom: "18", addressdetails: "1" });
      fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, {
        headers: { "Accept-Language": "en" },
      })
        .then((r) => r.json())
        .then((geo) => {
          const addr = geo.address ?? {};
          const name =
            geo.name || addr.amenity || addr.building || addr.road ||
            (geo.display_name ?? "").split(",")[0];
          setPlaceName(name || "");
        })
        .catch(() => setPlaceName(""))
        .finally(() => setGeocoding(false));
    };

    map.on("click", onClick);
    return () => map.off("click", onClick);
  }, [pinMode]);

  useEffect(() => {
    if (!mapRef.current) return;
    import("leaflet").then((L) => {
      if (pinMarkerRef.current) { pinMarkerRef.current.remove(); pinMarkerRef.current = null; }
      if (!pending || !mapRef.current) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pinMarkerRef.current = (L as any).circleMarker([pending.lat, pending.lng], {
        radius: 10, color: PIN_COLOR, weight: 3,
        fillColor: PIN_COLOR, fillOpacity: 0.4,
      }).addTo(mapRef.current);
    });
  }, [pending]);

  const cancelPin = () => {
    setPending(null);
    setPlaceName("");
    if (pinMarkerRef.current) { pinMarkerRef.current.remove(); pinMarkerRef.current = null; }
  };

  const savePin = async () => {
    if (!pending || !date) return;
    setSaving(true);
    try {
      const arrived_at  = arrivedAt  ? `${date}T${arrivedAt}:00Z`  : undefined;
      const departed_at = departedAt ? `${date}T${departedAt}:00Z` : undefined;
      await fetch("/api/locations/manual-visit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date, lat: pending.lat, lng: pending.lng,
          place_name: placeName || undefined,
          arrived_at, departed_at,
        }),
      });
      cancelPin();
      onVisitAdded?.();
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!containerRef.current || geojson.features.length === 0) return;
    let destroyed = false;

    import("leaflet").then((L) => {
      if (destroyed || !containerRef.current) return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const node = containerRef.current as any;
      if (node._leaflet_id != null) {
        try { (L as any).map(containerRef.current).remove(); } catch { delete node._leaflet_id; }
      }

      const map = L.map(containerRef.current, { zoomControl: true });
      mapRef.current = map;

      L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        { attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 19 }
      ).addTo(map);

      // Flatten every feature into an ordered list of points, each carrying
      // its own timestamp + activity_type, so consecutive legs can be
      // classified and colored individually instead of drawn as one flat line.
      type LegPoint = { latlng: [number, number]; time: string; activityType: string | null };
      const legPoints: LegPoint[] = geojson.features.flatMap((f) => {
        const props = f.properties;
        if (f.geometry.type === "LineString") {
          const coords = f.geometry.coordinates as [number, number][];
          return coords.map(([lng, lat], i): LegPoint => ({
            latlng: [lat, lng],
            time: i === 0 ? props.segment_start : props.segment_end,
            activityType: props.activity_type,
          }));
        }
        const [lng, lat] = f.geometry.coordinates as [number, number];
        return [{ latlng: [lat, lng] as [number, number], time: props.segment_start, activityType: props.activity_type }];
      });

      const allBounds: [number, number][] = legPoints.map((p) => p.latlng);
      const usedModes = new Set<string>();

      if (legPoints.length >= 2) {
        L.polyline(allBounds, { color: "#fff", weight: 6, opacity: 0.55 }).addTo(map);
        for (let i = 0; i < legPoints.length - 1; i++) {
          const mode  = classifyLeg(legPoints[i], legPoints[i + 1]);
          const style = MODE_STYLE[mode] ?? MODE_STYLE.vehicle;
          usedModes.add(mode);
          L.polyline([legPoints[i].latlng, legPoints[i + 1].latlng], {
            color: style.color, weight: 3.5, opacity: 0.9,
          }).addTo(map);
        }
      }
      setModesUsed([...usedModes]);

      markersRef.current = new Map();
      const seen = new Set<string>();
      geojson.features.forEach((feature) => {
        const props = feature.properties;
        const name  = props.place_name ?? props.city ?? null;

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

        const dot = L.circleMarker(latlng, {
          radius: isStop ? 7 : 4,
          color: "#fff", weight: 2,
          fillColor: isStop ? STOP_COLOR : MOVE_COLOR,
          fillOpacity: 1,
        }).addTo(map);

        if (isStop) markersRef.current.set(key, dot);

        if (name) {
          const icon  = props.semantic_type ? (SEMANTIC_ICON[props.semantic_type] ?? "") : "";
          const city  = props.city && props.city !== name ? `<div style="font-size:11px;color:#888;margin-top:1px">${props.city}${props.country ? `, ${props.country}` : ""}</div>` : "";
          const start = new Date(props.segment_start).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
          const end   = new Date(props.segment_end).toLocaleTimeString("en-GB",   { hour: "2-digit", minute: "2-digit" });
          dot.bindPopup(
            `<div style="font-family:system-ui;min-width:140px">
              <div style="font-weight:600;font-size:13px;color:#111">${icon ? icon + " " : ""}${name}</div>
              ${city}
              <div style="font-size:11px;color:#555;margin-top:5px;border-top:1px solid #eee;padding-top:4px">${start} – ${end}</div>
            </div>`,
            { maxWidth: 240 }
          );
          if (showLabels && isStop) {
            dot.bindTooltip(`${icon ? icon + " " : ""}${name}`, {
              permanent: true, direction: "top", offset: [0, -6],
              className: "db-place-label",
            });
          }
        }
      });

      if (allBounds.length > 0) {
        map.fitBounds(L.latLngBounds(allBounds), { padding: [32, 32], maxZoom: 15 });
      }
    });

    return () => {
      destroyed = true;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geojson.features.length, showLabels]);

  return (
    <div className="flex flex-col gap-3">
      <div className="isolate rounded-xl overflow-hidden border border-[#27272A] shadow-sm" style={{ position: "relative", zIndex: 0 }}>
        {geojson.features.length === 0 ? (
          <div className="flex items-center justify-center h-36 text-sm text-[#52525B]">
            No GPS tracks for this day
          </div>
        ) : (
          <div ref={containerRef} style={{ height: 360, width: "100%", position: "relative" }} />
        )}

        {editable && !pinMode && !pending && (
          <button
            onClick={() => setPinMode(true)}
            className="absolute top-3 right-3 z-[1000] flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0D0D0F]/90 border border-[#27272A] text-xs text-[#A1A1AA] hover:text-[#F59E0B] hover:border-[#F59E0B]/40 transition-colors backdrop-blur-sm"
          >
            + Add place
          </button>
        )}

        {pinMode && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#F59E0B]/90 text-[#0D0D0F] text-xs font-medium backdrop-blur-sm">
            Tap on the map to pin a place
            <button onClick={() => setPinMode(false)} className="ml-1 opacity-70 hover:opacity-100">✕</button>
          </div>
        )}
      </div>

      {/* Route legend — only worth showing once the route mixes more than one mode */}
      {modesUsed.length > 1 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {modesUsed
            .filter((m) => m !== "stationary")
            .map((m) => (
              <span key={m} className="flex items-center gap-1.5 text-[11px] text-[#71717A]">
                <span className="inline-block w-3 h-[3px] rounded-full" style={{ backgroundColor: MODE_STYLE[m].color }} />
                {MODE_STYLE[m].label}
              </span>
            ))}
        </div>
      )}

      {/* Confirm popover */}
      {pending && (
        <div className="bg-[#0D0D0F] border border-[#F59E0B]/30 rounded-xl px-4 py-3 flex flex-col gap-3">
          <p className="text-xs text-[#F59E0B] font-medium uppercase tracking-wide">New place</p>
          <input
            type="text"
            value={geocoding ? "Searching…" : placeName}
            onChange={(e) => setPlaceName(e.target.value)}
            disabled={geocoding}
            placeholder="Place name"
            className="bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder:text-[#52525B] focus:outline-none focus:border-[#F59E0B] transition-colors disabled:opacity-50"
          />
          <div className="flex gap-3">
            <div className="flex-1 flex flex-col gap-1">
              <label className="text-[10px] text-[#52525B] uppercase tracking-wide">Arrived</label>
              <input
                type="time"
                value={arrivedAt}
                onChange={(e) => setArrivedAt(e.target.value)}
                className="bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#F59E0B] transition-colors"
              />
            </div>
            <div className="flex-1 flex flex-col gap-1">
              <label className="text-[10px] text-[#52525B] uppercase tracking-wide">Departed</label>
              <input
                type="time"
                value={departedAt}
                onChange={(e) => setDepartedAt(e.target.value)}
                className="bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#F59E0B] transition-colors"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={savePin}
              disabled={saving || geocoding || !placeName}
              className="flex-1 py-2 rounded-lg bg-[#F59E0B] text-[#0D0D0F] text-sm font-medium disabled:opacity-40 hover:bg-[#FBBF24] transition-colors"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              onClick={cancelPin}
              className="px-4 py-2 rounded-lg border border-[#27272A] text-sm text-[#71717A] hover:text-[#A1A1AA] transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
});
