"use client";

import { useEffect, useRef, useState, useCallback } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

type Route = {
  id: string;
  name: string;
  date: string;
  distance_km: number | null;
  coords: [number, number][];
  metric_value: number | null;
};

type PolylinesResponse = {
  run?: Route[];
  ride?: Route[];
  swim?: Route[];
};

const SPORT_COLORS: Record<string, string> = {
  run: "#F59E0B",
  ride: "#3B82F6",
  swim: "#06B6D4",
};

const SPORT_LABELS: Record<string, string> = {
  run: "Run",
  ride: "Ride",
  swim: "Swim",
};

const METRIC_OPTIONS = [
  { key: "none", label: "Default" },
  { key: "pace", label: "Pace" },
  { key: "elevation", label: "Elevation" },
  { key: "hr", label: "HR" },
] as const;
type Metric = typeof METRIC_OPTIONS[number]["key"];

const DAY_OPTIONS = [
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
  { label: "All", days: 3650 },
];

function lerpColor(a: string, b: string, t: number): string {
  const ah = parseInt(a.slice(1), 16);
  const bh = parseInt(b.slice(1), 16);
  const ar = (ah >> 16) & 0xff, ag = (ah >> 8) & 0xff, ab = ah & 0xff;
  const br = (bh >> 16) & 0xff, bg = (bh >> 8) & 0xff, bb = bh & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bv = Math.round(ab + (bb - ab) * t);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${bv.toString(16).padStart(2, "0")}`;
}

function metricColor(value: number | null, min: number, max: number, sport: string, metric: Metric): string {
  if (metric === "none" || value === null) return SPORT_COLORS[sport] ?? "#71717A";
  const t = max > min ? (value - min) / (max - min) : 0.5;
  // HR: low=green (#22C55E), high=red (#EF4444)
  if (metric === "hr") return lerpColor("#22C55E", "#EF4444", t);
  // Pace: s/km — lower = faster; fast=yellow (#EAB308), slow=blue (#3B82F6)
  if (metric === "pace") return lerpColor("#EAB308", "#3B82F6", t);
  // Elevation: low=blue, high=amber
  return lerpColor("#3B82F6", "#F59E0B", t);
}

export function TrainingRouteMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layersRef = useRef<any[]>([]);
  // Track whether we've ever fit bounds (only do it on first load)
  const hasFitRef = useRef(false);

  const [activeSports, setActiveSports] = useState<Record<string, boolean>>({ run: true, ride: true, swim: false });
  const [metric, setMetric] = useState<Metric>("none");
  const [days, setDays] = useState(365);
  const [data, setData] = useState<PolylinesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [count, setCount] = useState(0);

  const toggleSport = (s: string) =>
    setActiveSports((prev) => ({ ...prev, [s]: !prev[s] }));

  // Fetch when sports/days change (metric only re-colors, no refetch needed if already cached)
  // But metric affects the metric_value returned by the backend, so we do need to refetch.
  const fetchData = useCallback(async () => {
    const sports = Object.keys(activeSports).filter((s) => activeSports[s]);
    if (sports.length === 0) { setData({}); setCount(0); return; }
    setLoading(true);
    try {
      const res = await fetch(
        `${API}/training/polylines?sports=${sports.join(",")}&days=${days}&metric=${metric}&limit=200`
      );
      if (res.ok) {
        const d: PolylinesResponse = await res.json();
        setData(d);
        setCount(Object.values(d).reduce((a, r) => a + (r?.length ?? 0), 0));
      }
    } finally {
      setLoading(false);
    }
  }, [activeSports, days, metric]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Init map once on mount
  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;

    (async () => {
      const L = (await import("leaflet")).default;
      await import("leaflet/dist/leaflet.css");
      if (cancelled || !containerRef.current || mapRef.current) return;

      mapRef.current = L.map(containerRef.current, {
        zoomControl: true,
        center: [40, 10],
        zoom: 4,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(mapRef.current);
    })();

    return () => { cancelled = true; };
  }, []); // runs once

  // Redraw route layers whenever data changes — WITHOUT resetting the viewport
  useEffect(() => {
    if (!mapRef.current || data === null) return;

    // Remove old route layers
    layersRef.current.forEach((l) => { try { l.remove(); } catch { /* */ } });
    layersRef.current = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const L = (window as any).L;
    if (!L) return;

    const allCoords: [number, number][] = [];

    const allValues: number[] = [];
    for (const routes of Object.values(data)) {
      routes?.forEach((r) => { if (r.metric_value !== null) allValues.push(r.metric_value); });
    }
    const metricMin = allValues.length ? Math.min(...allValues) : 0;
    const metricMax = allValues.length ? Math.max(...allValues) : 1;

    for (const [sport, routes] of Object.entries(data)) {
      if (!routes || !activeSports[sport]) continue;
      for (const route of routes) {
        if (!route.coords?.length) continue;
        const color = metricColor(route.metric_value, metricMin, metricMax, sport, metric);

        const line = L.polyline(route.coords, { color, weight: 2, opacity: 0.75 });

        const dist = route.distance_km ? `${route.distance_km} km` : "";
        const metStr = metric !== "none" && route.metric_value !== null
          ? metric === "pace"
            ? ` · ${Math.floor(route.metric_value / 60)}:${Math.round(route.metric_value % 60).toString().padStart(2, "0")}/km`
            : metric === "elevation"
            ? ` · ↑${Math.round(route.metric_value)}m`
            : ` · ${Math.round(route.metric_value)} bpm`
          : "";
        line.bindPopup(`<b>${route.name}</b><br/>${route.date}${dist ? ` · ${dist}` : ""}${metStr}`);

        line.addTo(mapRef.current);
        layersRef.current.push(line);
        route.coords.forEach((c) => allCoords.push(c));
      }
    }

    // Only auto-fit on the very first load with real data
    if (!hasFitRef.current && allCoords.length > 0) {
      hasFitRef.current = true;
      const lats = allCoords.map((c) => c[0]);
      const lngs = allCoords.map((c) => c[1]);
      try {
        mapRef.current.fitBounds(
          [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]],
          { padding: [30, 30], maxZoom: 14 }
        );
      } catch { /* */ }
    }
  }, [data, activeSports, metric]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      layersRef.current.forEach((l) => { try { l.remove(); } catch { /* */ } });
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
      hasFitRef.current = false;
    };
  }, []);

  return (
    <>
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="flex gap-1">
          {(["run", "ride", "swim"] as const).map((s) => (
            <button
              key={s}
              onClick={() => toggleSport(s)}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors border ${
                activeSports[s]
                  ? "text-[#09090B] border-transparent"
                  : "bg-transparent border-[#27272A] text-[#52525B] hover:text-[#A1A1AA]"
              }`}
              style={activeSports[s] ? { background: SPORT_COLORS[s] } : {}}
            >
              {SPORT_LABELS[s]}
            </button>
          ))}
        </div>

        <div className="flex gap-1">
          {METRIC_OPTIONS.map((m) => (
            <button
              key={m.key}
              onClick={() => setMetric(m.key)}
              className={`px-2.5 py-1 rounded text-xs transition-colors ${
                metric === m.key ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="flex gap-1">
          {DAY_OPTIONS.map((d) => (
            <button
              key={d.days}
              onClick={() => setDays(d.days)}
              className={`px-2.5 py-1 rounded text-xs transition-colors ${
                days === d.days ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>

        {!loading && count > 0 && (
          <span className="text-xs text-[#52525B]">{count} routes</span>
        )}
        {loading && <span className="text-xs text-[#52525B]">Loading…</span>}
      </div>

      {/* Metric color legend */}
      {metric !== "none" && (
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs text-[#52525B]">
            {metric === "pace" ? "Fast" : metric === "hr" ? "Low" : "Low"}
          </span>
          <div className="h-2 w-24 rounded-full" style={{
            background: metric === "hr"
              ? "linear-gradient(to right, #22C55E, #EF4444)"
              : metric === "pace"
              ? "linear-gradient(to right, #EAB308, #3B82F6)"
              : "linear-gradient(to right, #3B82F6, #F59E0B)"
          }} />
          <span className="text-xs text-[#52525B]">
            {metric === "pace" ? "Slow" : metric === "hr" ? "High" : "High"}
          </span>
          <span className="text-xs text-[#3F3F46] ml-1">
            {metric === "pace" ? "pace" : metric === "elevation" ? "elevation gain" : "avg HR"}
          </span>
        </div>
      )}

      <div className="rounded-xl overflow-hidden border border-[#27272A]">
        <div ref={containerRef} style={{ height: 480, width: "100%" }} />
      </div>
    </>
  );
}
