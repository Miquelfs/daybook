"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import Link from "next/link";
import { Globe, Flame, Maximize2, Minimize2, X } from "lucide-react";
import { Flag } from "@/components/Flag";
import type { HeatmapData, WorldCoverage } from "@/lib/api";

type Country = WorldCoverage["country_details"][number];
type Mode = "coverage" | "heatmap";
type Theme = "dark" | "light";

/** Lets the Countries list elsewhere on the page jump this map to a country
 * (switch to coverage mode, fit its shape, pop its info) instead of the list
 * being a dead read-only ranking. */
export interface ExploreMapHandle {
  focusCountry: (c: { country: string; iso2: string | null }) => void;
}

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

// Keyless OSM tiles (CARTO now stamps "API KEY REQUIRED"). Dark is faked by a
// CSS filter on the tile pane only, so overlays/heat/markers stay untouched.
const OSM_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_FILTER: Record<Theme, string> = {
  dark: "invert(1) hue-rotate(180deg) brightness(0.9) contrast(0.9)",
  light: "",
};

/** Amber → orange → deep red as a country fills with days (0–1). */
function heatColor(x: number): string {
  const stops = [[253, 230, 138], [245, 158, 11], [234, 88, 12], [185, 28, 28]];
  const p = Math.max(0, Math.min(1, x)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(p)), f = p - i;
  const c = stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/**
 * One map for the whole "travel" picture — toggle between a geographic
 * coverage choropleth (countries filled by days visited, from the
 * locally-bundled world GeoJSON) and a GPS heatmap. Light/dark selectable.
 */
export const ExploreMap = forwardRef<ExploreMapHandle, { points: HeatmapData["points"]; details: Country[] }>(
  function ExploreMap({ points, details }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tileRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const coverageRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const heatRef = useRef<any>(null);

  const [mode, setMode] = useState<Mode>("heatmap");
  const [selected, setSelected] = useState<Country | null>(null);
  const [tall, setTall] = useState(false);
  const [theme, setTheme] = useState<Theme>("dark");
  const [ready, setReady] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pendingFocusRef = useRef<{ country: string; iso2: string | null } | null>(null);

  // Follow the app's global light/dark theme (set as data-theme on <html> by
  // ThemeToggle) so the map always matches the view you're in.
  useEffect(() => {
    const read = () =>
      setTheme(document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark");
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

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
      // Leaflet MUST load and execute before leaflet.heat — the heat plugin
      // assigns L.heatLayer at load time and needs window.L to already exist.
      // Loading them in parallel raced the plugin ahead of core Leaflet, so
      // L.heatLayer was undefined and the whole build threw (no heat layer, and
      // setReady never ran → tiles stuck on the initial dark theme).
      const geoPromise = fetch("/world-countries.geo.json").then((r) => r.json());
      await loadScript("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js");
      await loadScript("https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js");
      const geo = await geoPromise;
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

      // Read the live theme from the DOM (the `theme` state captured by this
      // once-on-mount effect is the initial "dark" default; the app may already
      // be in light mode) so the map builds with the correct basemap, no flash.
      const liveTheme: Theme =
        document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
      tileRef.current = L.tileLayer(OSM_URL, {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);
      const tilePane = map.getPane("tilePane");
      if (tilePane) tilePane.style.filter = TILE_FILTER[liveTheme];

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
          return { color: "#FFFFFF", weight: 0.6, fillColor: heatColor(intensity), fillOpacity: 0.55 + intensity * 0.35 };
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onEachFeature: (feat: any, layer: any) => {
          const c = visitedFor(feat.properties);
          if (!c) return;
          layer.bindTooltip(`<b>${c.country}</b> · ${c.total_days} day${c.total_days === 1 ? "" : "s"}`,
                            { sticky: true, direction: "top", opacity: 0.95 });
          layer.on({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            mouseover: (e: any) => { e.target.setStyle({ weight: 2, color: "#111827" }); e.target.bringToFront(); },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            mouseout: (e: any) => e.target.setStyle({ weight: 0.6, color: "#FFFFFF" }),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            click: (e: any) => { setSelected(c); map.fitBounds(e.target.getBounds(), { padding: [40, 40], maxZoom: 6 }); },
          });
        },
      });

      if (hasHeat && typeof L.heatLayer === "function") {
        heatRef.current = L.heatLayer(points, {
          radius: 18, blur: 22, maxZoom: 10,
          gradient: { 0.2: "#3B82F6", 0.5: "#8B5CF6", 0.75: "#F59E0B", 1.0: "#EF4444" },
        });
      }

      // Show the initial mode + frame it. Heatmap is the default view.
      const initial: Mode = hasHeat ? "heatmap" : "coverage";
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

  // Theme swap — recolour the tile pane (tiles stay the same OSM source).
  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const tilePane = mapRef.current.getPane("tilePane");
    if (tilePane) tilePane.style.filter = TILE_FILTER[theme];
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

  // Resolves a pending focusCountry() request once the coverage layer is
  // actually on the map (it may have just been switched on by the effect
  // above, which runs first on the same commit).
  const tryFocus = () => {
    const c = pendingFocusRef.current;
    const map = mapRef.current;
    const coverage = coverageRef.current;
    if (!c || !map || !coverage || !ready || !map.hasLayer(coverage)) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let target: any = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    coverage.eachLayer((layer: any) => {
      if (target) return;
      const props = layer.feature?.properties ?? {};
      const iso = (props.iso2 || "").toUpperCase();
      if ((c.iso2 && iso === c.iso2.toUpperCase()) || (props.name || "").toLowerCase() === c.country.toLowerCase()) {
        target = layer;
      }
    });
    pendingFocusRef.current = null;
    if (!target) return;
    map.fitBounds(target.getBounds(), { padding: [40, 40], maxZoom: 6 });
    const hit = details.find((d) => (c.iso2 && d.iso2?.toUpperCase() === c.iso2.toUpperCase()) || d.country === c.country);
    if (hit) setSelected(hit);
  };

  useEffect(() => {
    if (mode === "coverage") tryFocus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, ready]);

  useImperativeHandle(ref, () => ({
    focusCountry: (c) => {
      pendingFocusRef.current = c;
      setMode("coverage");
      tryFocus(); // covers the case where we're already in coverage mode (no mode change → no effect re-run)
    },
  }), []);

  // Taller map: Leaflet must re-measure its container
  useEffect(() => {
    if (ready && mapRef.current) setTimeout(() => mapRef.current?.invalidateSize(), 50);
  }, [tall, ready]);

  const btn = (active: boolean) =>
    `flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
      active ? "bg-[#F59E0B] text-[#0D0D0F]" : "text-[#A1A1AA] hover:text-[#FAFAFA]"
    }`;

  return (
    <>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <div className="relative rounded-xl overflow-hidden border border-[#27272A] shadow-sm">
        <div ref={containerRef} style={{ height: tall ? 640 : 420, width: "100%", background: theme === "dark" ? "#0D0D0F" : "#e5e7eb", transition: "height .25s" }} />

        {/* Mode toggle */}
        <div className="absolute top-3 left-3 z-[1000] flex items-center gap-0.5 bg-[#0D0D0F]/85 border border-[#27272A] rounded-lg p-0.5 backdrop-blur-sm">
          <button className={btn(mode === "coverage")} onClick={() => setMode("coverage")} disabled={!hasCoverage}>
            <Globe size={12} /> Coverage
          </button>
          <button className={btn(mode === "heatmap")} onClick={() => setMode("heatmap")} disabled={!hasHeat}>
            <Flame size={12} /> Heatmap
          </button>
        </div>

        {/* Taller / shorter */}
        <button onClick={() => setTall((v) => !v)} aria-label={tall ? "Smaller map" : "Bigger map"}
                className="absolute top-3 right-3 z-[1000] p-1.5 rounded-lg bg-[#0D0D0F]/85 border border-[#27272A] text-[#A1A1AA] hover:text-[#FAFAFA] backdrop-blur-sm">
          {tall ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>

        {/* Coverage legend */}
        {mode === "coverage" && !selected && (
          <div className="absolute bottom-3 left-3 z-[1000] flex items-center gap-2 bg-[#0D0D0F]/85 border border-[#27272A] rounded-lg px-2.5 py-1.5 backdrop-blur-sm text-[10px] text-[#A1A1AA]">
            fewer days
            <span className="w-20 h-1.5 rounded-full" style={{ background: `linear-gradient(90deg, ${heatColor(0)}, ${heatColor(0.5)}, ${heatColor(1)})` }} />
            more · tap a country
          </div>
        )}

        {/* The tapped country */}
        {selected && (
          <div className="absolute bottom-3 left-3 right-3 sm:right-auto sm:w-80 z-[1000] rounded-2xl border border-[#27272A] bg-[#0D0D0F]/95 backdrop-blur p-4 shadow-lg">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-base font-semibold"><Flag country={selected.country} fallback="" /> {selected.country}</p>
                <p className="text-xs text-[#71717A]">{selected.continent}{selected.manual ? " · added by hand" : ""}</p>
              </div>
              <button onClick={() => setSelected(null)} aria-label="Close" className="text-[#52525B] hover:text-[#A1A1AA]"><X size={15} /></button>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-3">
              {[["days", selected.total_days], ["cities", selected.cities_visited],
                ["since", selected.first_visit ? selected.first_visit.slice(0, 4) : "—"]].map(([l, v]) => (
                <div key={l as string} className="rounded-xl bg-[#18181B] px-2.5 py-2">
                  <p className="text-lg font-semibold tabular-nums leading-none">{v}</p>
                  <p className="text-[10px] text-[#71717A] uppercase tracking-widest mt-1">{l}</p>
                </div>
              ))}
            </div>
            {selected.last_visit && <p className="text-xs text-[#71717A] mt-2">Last there {selected.last_visit}</p>}
            <Link href={`/explore/country/${encodeURIComponent(selected.country)}`} className="inline-block mt-3 text-xs font-medium text-[#F59E0B] hover:underline">
              Cities, days and trips →
            </Link>
          </div>
        )}
      </div>
    </>
  );
});
