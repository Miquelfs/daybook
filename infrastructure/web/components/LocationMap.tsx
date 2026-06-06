"use client";

import { useEffect, useRef, useState } from "react";
import type { TracksGeoJSON } from "@/lib/api";

interface Props {
  geojson: TracksGeoJSON;
  editable?: boolean;
  date?: string;
  onVisitAdded?: () => void;
}

const SEMANTIC_ICON: Record<string, string> = {
  Home: "🏠", Work: "💼", home: "🏠", work: "💼",
};

const TRACK_COLOR = "#2563EB";
const STOP_COLOR  = "#EA580C";
const MOVE_COLOR  = "#94A3B8";
const PIN_COLOR   = "#F59E0B";

export function LocationMap({ geojson, editable = false, date, onVisitAdded }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef       = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pinMarkerRef = useRef<any>(null);

  const [pinMode, setPinMode]     = useState(false);
  const [pending, setPending]     = useState<{ lat: number; lng: number } | null>(null);
  const [placeName, setPlaceName] = useState("");
  const [arrivedAt, setArrivedAt] = useState("");
  const [departedAt, setDepartedAt] = useState("");
  const [geocoding, setGeocoding] = useState(false);
  const [saving, setSaving]       = useState(false);

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
        "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
        { attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com">CARTO</a>', maxZoom: 19 }
      ).addTo(map);

      const allBounds: [number, number][] = [];
      const allLatlngs: [number, number][] = geojson.features.flatMap((f) => {
        if (f.geometry.type === "LineString") {
          return (f.geometry.coordinates as [number, number][]).map(([lng, lat]): [number, number] => [lat, lng]);
        }
        const [lng, lat] = f.geometry.coordinates as [number, number];
        return [[lat, lng] as [number, number]];
      });
      allBounds.push(...allLatlngs);

      if (allLatlngs.length >= 2) {
        L.polyline(allLatlngs, { color: "#fff", weight: 6, opacity: 0.55 }).addTo(map);
        L.polyline(allLatlngs, { color: TRACK_COLOR, weight: 3.5, opacity: 0.9 }).addTo(map);
      }

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
        allBounds.push(latlng);

        const dot = L.circleMarker(latlng, {
          radius: isStop ? 7 : 4,
          color: "#fff", weight: 2,
          fillColor: isStop ? STOP_COLOR : MOVE_COLOR,
          fillOpacity: 1,
        }).addTo(map);

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
  }, [geojson.features.length]);

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
}
