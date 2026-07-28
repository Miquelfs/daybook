"use client";

import { useEffect, useRef, useState } from "react";
import { Globe, Flame, Sun, Moon } from "lucide-react";
import type { HeatmapData, WorldCoverage } from "@/lib/api";

type Country = WorldCoverage["country_details"][number];
type Mode = "coverage" | "heatmap";
type Theme = "dark" | "light";

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

const TILES: Record<Theme, string> = {
  dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  light: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
};

/**
 * One map for the whole "travel" picture — toggle between a geographic
 * coverage choropleth (countries filled by days visited, from the
 * locally-bundled world GeoJSON) and a GPS heatmap. Light/dark selectable.
 */
export function ExploreMap({ points, details }: { points: HeatmapData["points"]; details: Country[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tileRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const coverageRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const heatRef = useRef<any>(null);

  const [mode, setMode] = useState<Mode>("coverage");
  const [theme, setTheme] = useState<Theme>("dark");
  const [ready, setReady] = useState(false);

  const hasCoverage = details.length > 0;
  const hasHeat = points.length > 0;

  // Mount: build the map, both layers, show the active one.
  useEffect(() => {
    if (!containerRef.current) return;
    let destroyed = false;

    const byIso = new Map<string, Country>();
    const byName = new Map<string, Country>();
    for (const c of details) {
      if (c.iso2) byIso.set(c.iso2.toUpperCase(), c);
      byName.set(c.country.toLowerCase(), c);
    }
    const maxDays = Math.max(1, ...details.map((c) => c.total_days));

    (async () => {
      const [, , geo] = await Promise.all([
        loadScript("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"),
        loadScript("https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js"),
        fetch("/world-countries.geo.json").then((r) => r.json()),
      ]);
      if (destroyed || !containerRef.current) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const L = (window as any).L;
      if (!L) return;

      const node = containerRef.current as unknown as { _leaflet_id?: number };
      if (node._leaflet_id != null) {
        try { mapRef.current?.remove(); } catch { /* ignore */ }
        delete node._leaflet_id;
      }

      const map = L.map(containerRef.current, {
        zoomControl: true, center: [30, 5], zoom: 2, worldCopyJump: true,
        minZoom: 1, maxBounds: [[-85, -200], [85, 200]],
      });
      mapRef.current = map;

      tileRef.current = L.tileLayer(TILES[theme], {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com">CARTO</a>',
        maxZoom: 19,
      }).addTo(map);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const visitedFor = (props: any): Country | undefined => {
        const iso = (props.iso2 || "").toUpperCase();
        return byIso.get(iso) ?? byName.get((props.name || "").toLowerCase());
      };

      coverageRef.current = L.geoJSON(geo, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        style: (feat: any) => {
          const c = visitedFor(feat.properties);
          if (!c) return { color: "transparent", weight: 0, fillColor: "#000", fillOpacity: 0 };
          const intensity = Math.sqrt(c.total_days) / Math.sqrt(maxDays);
          return { color: "#F59E0B", weight: 0.7, fillColor: "#F59E0B", fillOpacity: 0.25 + intensity * 0.6 };
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onEachFeature: (feat: any, layer: any) => {
          const c = visitedFor(feat.properties);
          if (!c) return;
          layer.bindPopup(
            `<strong>${c.country}</strong><br>${c.total_days} day${c.total_days === 1 ? "" : "s"} · ${c.cities_visited} ${c.cities_visited === 1 ? "city" : "cities"}` +
            (c.first_visit ? `<br><span style="color:#888">since ${c.first_visit}</span>` : "")
          );
          layer.on({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            mouseover: (e: any) => e.target.setStyle({ weight: 1.5, color: "#FBBF24" }),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            mouseout: (e: any) => e.target.setStyle({ weight: 0.7, color: "#F59E0B" }),
          });
        },
      });

      if (hasHeat) {
        heatRef.current = L.heatLayer(points, {
          radius: 18, blur: 22, maxZoom: 10,
          gradient: { 0.2: "#3B82F6", 0.5: "#8B5CF6", 0.75: "#F59E0B", 1.0: "#EF4444" },
        });
      }

      // Show the initial mode + frame it.
      const initial: Mode = hasCoverage ? "coverage" : "heatmap";
      setMode(initial);
      if (initial === "coverage") coverageRef.current.addTo(map);
      else if (heatRef.current) heatRef.current.addTo(map);

      const coords = details.filter((c) => c.lat != null && c.lng != null);
      if (initial === "heatmap" && hasHeat) {
        const lats = points.map((p) => p[0]); const lngs = points.map((p) => p[1]);
        map.fitBounds([[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]], { padding: [30, 30], maxZoom: 6 });
      } else if (coords.length > 0) {
        const lats = coords.map((c) => c.lat as number); const lngs = coords.map((c) => c.lng as number);
        map.fitBounds([[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]], { padding: [30, 30], maxZoom: 5 });
      }
      setReady(true);
    })();

    return () => {
      destroyed = true;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
      coverageRef.current = heatRef.current = tileRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Theme swap.
  useEffect(() => {
    if (!ready || !mapRef.current || !tileRef.current) return;
    tileRef.current.setUrl(TILES[theme]);
  }, [theme, ready]);

  // Mode swap.
  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const map = mapRef.current;
    if (coverageRef.current && map.hasLayer(coverageRef.current)) map.removeLayer(coverageRef.current);
    if (heatRef.current && map.hasLayer(heatRef.current)) map.removeLayer(heatRef.current);
    if (mode === "coverage" && coverageRef.current) coverageRef.current.addTo(map);
    if (mode === "heatmap" && heatRef.current) heatRef.current.addTo(map);
  }, [mode, ready]);

  const btn = (active: boolean) =>
    `flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
      active ? "bg-[#F59E0B] text-[#0D0D0F]" : "text-[#A1A1AA] hover:text-[#FAFAFA]"
    }`;

  return (
    <>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <div className="relative rounded-xl overflow-hidden border border-[#27272A] shadow-sm">
        <div ref={containerRef} style={{ height: 420, width: "100%", background: theme === "dark" ? "#0D0D0F" : "#e5e7eb" }} />

        {/* Mode toggle */}
        <div className="absolute top-3 left-3 z-[1000] flex items-center gap-0.5 bg-[#0D0D0F]/85 border border-[#27272A] rounded-lg p-0.5 backdrop-blur-sm">
          <button className={btn(mode === "coverage")} onClick={() => setMode("coverage")} disabled={!hasCoverage}>
            <Globe size={12} /> Coverage
          </button>
          <button className={btn(mode === "heatmap")} onClick={() => setMode("heatmap")} disabled={!hasHeat}>
            <Flame size={12} /> Heatmap
          </button>
        </div>

        {/* Theme toggle */}
        <button
          onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          className="absolute top-3 right-3 z-[1000] flex items-center justify-center h-7 w-7 bg-[#0D0D0F]/85 border border-[#27272A] rounded-lg text-[#A1A1AA] hover:text-[#F59E0B] backdrop-blur-sm transition-colors"
          aria-label="Toggle map theme"
        >
          {theme === "dark" ? <Sun size={13} /> : <Moon size={13} />}
        </button>
      </div>
    </>
  );
}
