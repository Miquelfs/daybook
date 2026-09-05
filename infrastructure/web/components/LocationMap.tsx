"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { api } from "@/lib/api";
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

// Route coloring, in priority order: a manual override always wins; then an
// authoritative exercise mode (a logged Garmin/Strava activity); then
// Overland's own on-device motion classification (walking/running/cycling/
// driving, the last refined to car/scooter by the day's transport tag when
// unambiguous); last resort is a speed-derived tier. "Vehicle" stays muted —
// it means "some kind of motorized transport, unconfirmed" — while a
// confirmed mode gets a real color, so confidence reads visually.
const MODE_STYLE: Record<string, { color: string; label: string }> = {
  run:              { color: SPORT_COLORS.run,  label: "Run" },
  ride:             { color: SPORT_COLORS.ride, label: "Ride" },
  swim:             { color: SPORT_COLORS.swim, label: "Swim" },
  other_ex:         { color: SPORT_COLORS.other, label: "Exercise" },
  foot:             { color: "#94A3B8", label: "On foot" },
  car:              { color: "#8B5CF6", label: "Car" },
  scooter:          { color: "#F97316", label: "Scooter" },
  public_transport: { color: "#0EA5E9", label: "Public transport" },
  vehicle:          { color: "#71717A", label: "Vehicle" },
  stationary:       { color: "#52525B", label: "Stationary" },
};
const MOVE_COLOR = MODE_STYLE.foot.color;

// Manually-settable modes, in the order offered in the edit popup.
const EDITABLE_MODES = ["run", "ride", "swim", "foot", "car", "scooter", "public_transport", "vehicle", "stationary"];

// Backend's raw motion/activity vocabulary → our MODE_STYLE keys.
const MOTION_TO_MODE: Record<string, string> = {
  walking: "foot", running: "run", cycling: "ride",
  driving: "vehicle", car: "car", scooter: "scooter", stationary: "stationary",
};

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

/** Auto-detect the leg between two consecutive track points (a manual
 * override, checked separately by the caller, always wins over this).
 * Priority: a logged Garmin/Strava activity_type on either endpoint, then
 * Overland's own on-device motion classification, then a speed-derived
 * tier as the last resort. */
function classifyLeg(
  a: { latlng: [number, number]; time: string; activityType: string | null; motion: string | null },
  b: { latlng: [number, number]; time: string; activityType: string | null; motion: string | null }
): string {
  const activityType = b.activityType ?? a.activityType;
  if (activityType) {
    const sport = sportOf(activityType);
    return sport === "other" ? "other_ex" : sport;
  }
  const motion = b.motion ?? a.motion;
  if (motion && MOTION_TO_MODE[motion]) return MOTION_TO_MODE[motion];
  const distM = haversineM(a.latlng[0], a.latlng[1], b.latlng[0], b.latlng[1]);
  const durS = (new Date(b.time).getTime() - new Date(a.time).getTime()) / 1000;
  if (durS <= 0 || distM < 15) return "stationary";
  const speedKmh = (distM / 1000) / (durS / 3600);
  if (speedKmh < 1.5) return "stationary";
  if (speedKmh <= 7) return "foot";
  return "vehicle";
}

/** Small DOM popup for correcting a leg's mode by hand — built imperatively
 * since Leaflet popup content is a raw DOM node, not JSX. */
function buildModePopup(currentMode: string, isManual: boolean, onPick: (mode: string | null) => void): HTMLElement {
  const wrap = document.createElement("div");
  wrap.style.cssText = "font-family:system-ui;min-width:190px";

  const title = document.createElement("div");
  title.style.cssText = "font-weight:600;font-size:12px;color:#111;margin-bottom:6px";
  title.textContent = isManual
    ? `Set: ${MODE_STYLE[currentMode]?.label ?? currentMode}`
    : `Detected: ${MODE_STYLE[currentMode]?.label ?? "Unknown"}`;
  wrap.appendChild(title);

  const grid = document.createElement("div");
  grid.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:4px";
  for (const m of EDITABLE_MODES) {
    const btn = document.createElement("button");
    btn.textContent = MODE_STYLE[m].label;
    const active = m === currentMode;
    btn.style.cssText =
      `font-size:11px;padding:4px 6px;border-radius:6px;text-align:left;cursor:pointer;` +
      `border:1px solid ${active ? MODE_STYLE[m].color : "#ddd"};` +
      `background:${active ? MODE_STYLE[m].color + "22" : "#fff"};color:#111`;
    btn.onclick = () => onPick(m);
    grid.appendChild(btn);
  }
  wrap.appendChild(grid);

  if (isManual) {
    const reset = document.createElement("button");
    reset.textContent = "↺ Reset to auto-detect";
    reset.style.cssText = "margin-top:6px;font-size:11px;color:#888;background:none;border:none;cursor:pointer;padding:0";
    reset.onclick = () => onPick(null);
    wrap.appendChild(reset);
  }
  return wrap;
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

  // Manual mode overrides for this day, keyed "legStartIso|legEndIso" — a
  // ref (not state) because edits patch the map directly; overridesVersion
  // is what actually triggers redraws (initial load, and each edit).
  const overridesRef = useRef<Map<string, string>>(new Map());
  const [overridesVersion, setOverridesVersion] = useState(0);
  // Preserved pan/zoom, so an override-edit rebuild doesn't snap the map back.
  const viewRef = useRef<{ center: [number, number]; zoom: number } | null>(null);

  // New data → forget the preserved view so the next build re-fits bounds.
  useEffect(() => { viewRef.current = null; }, [geojson]);

  useEffect(() => {
    if (!date) { overridesRef.current = new Map(); setOverridesVersion((v) => v + 1); return; }
    let cancelled = false;
    api.modeOverrides(date).then((rows) => {
      if (cancelled) return;
      overridesRef.current = new Map(rows.map((r) => [`${r.leg_start}|${r.leg_end}`, r.mode]));
      setOverridesVersion((v) => v + 1);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [date]);

  const saveOverride = async (legKey: string, mode: string | null) => {
    if (!date) return;
    const [legStart, legEnd] = legKey.split("|");
    const prev = overridesRef.current.get(legKey) ?? null;
    if (mode) overridesRef.current.set(legKey, mode); else overridesRef.current.delete(legKey);
    setOverridesVersion((v) => v + 1);
    try {
      await api.setModeOverride(date, legStart, legEnd, mode);
    } catch {
      if (prev) overridesRef.current.set(legKey, prev); else overridesRef.current.delete(legKey);
      setOverridesVersion((v) => v + 1);
    }
  };

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
      // its own timestamp + activity_type/motion, so consecutive legs can be
      // classified and colored individually instead of drawn as one flat line.
      type LegPoint = { latlng: [number, number]; time: string; activityType: string | null; motion: string | null };
      const legPoints: LegPoint[] = geojson.features.flatMap((f) => {
        const props = f.properties;
        if (f.geometry.type === "LineString") {
          const coords = f.geometry.coordinates as [number, number][];
          return coords.map(([lng, lat], i): LegPoint => ({
            latlng: [lat, lng],
            time: i === 0 ? props.segment_start : props.segment_end,
            activityType: props.activity_type,
            motion: props.motion,
          }));
        }
        const [lng, lat] = f.geometry.coordinates as [number, number];
        return [{ latlng: [lat, lng] as [number, number], time: props.segment_start, activityType: props.activity_type, motion: props.motion }];
      });

      const allBounds: [number, number][] = legPoints.map((p) => p.latlng);
      const usedModes = new Set<string>();

      if (legPoints.length >= 2) {
        L.polyline(allBounds, { color: "#fff", weight: 6, opacity: 0.55 }).addTo(map);
        for (let i = 0; i < legPoints.length - 1; i++) {
          const legKey     = `${legPoints[i].time}|${legPoints[i + 1].time}`;
          const manualMode = overridesRef.current.get(legKey) ?? null;
          const mode       = manualMode ?? classifyLeg(legPoints[i], legPoints[i + 1]);
          const style      = MODE_STYLE[mode] ?? MODE_STYLE.vehicle;
          usedModes.add(mode);
          const line = L.polyline([legPoints[i].latlng, legPoints[i + 1].latlng], {
            color: style.color, weight: 3.5, opacity: 0.9,
          }).addTo(map);
          // A wider, invisible line underneath makes the thin route easier to tap.
          const hitArea = L.polyline([legPoints[i].latlng, legPoints[i + 1].latlng], {
            color: "#000", weight: 16, opacity: 0,
          }).addTo(map);
          if (date) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            hitArea.on("click", (e: any) => {
              L.DomEvent.stopPropagation(e);
              const popupEl = buildModePopup(mode, !!manualMode, (picked) => {
                saveOverride(legKey, picked);
                hitArea.closePopup();
              });
              hitArea.bindPopup(popupEl, { maxWidth: 230 }).openPopup(e.latlng);
            });
          }
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

      // Preserve the user's pan/zoom across a rebuild (an override edit bumps
      // overridesVersion → full re-render); only re-fit on a genuine data load.
      if (viewRef.current) {
        map.setView(viewRef.current.center, viewRef.current.zoom);
      } else if (allBounds.length > 0) {
        map.fitBounds(L.latLngBounds(allBounds), { padding: [32, 32], maxZoom: 15 });
      }
    });

    return () => {
      destroyed = true;
      if (mapRef.current) {
        try {
          const c = mapRef.current.getCenter();
          viewRef.current = { center: [c.lat, c.lng], zoom: mapRef.current.getZoom() };
        } catch { /* map not ready */ }
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geojson.features.length, showLabels, overridesVersion]);

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
