"use client";

import { useEffect, useRef } from "react";
import type { WorldCoverage } from "@/lib/api";

type Country = WorldCoverage["country_details"][number];

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

/**
 * Geographic choropleth of visited countries. Fills each country polygon amber,
 * with opacity scaled by days spent there, using a locally-bundled world
 * GeoJSON (public/world-countries.geo.json) — no external boundary service.
 */
export function WorldCoverageMap({ details }: { details: Country[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<{ remove: () => void } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    let destroyed = false;

    // iso2 (upper) → visited detail; plus a name fallback for the handful of
    // features whose ISO code is missing.
    const byIso = new Map<string, Country>();
    const byName = new Map<string, Country>();
    for (const c of details) {
      if (c.iso2) byIso.set(c.iso2.toUpperCase(), c);
      byName.set(c.country.toLowerCase(), c);
    }
    const maxDays = Math.max(1, ...details.map((c) => c.total_days));

    (async () => {
      const [, geo] = await Promise.all([
        loadScript("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"),
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
        mapRef.current = null;
        if (destroyed) return;
      }

      const map = L.map(containerRef.current, {
        zoomControl: true, center: [25, 5], zoom: 2, worldCopyJump: true,
        minZoom: 1, maxBounds: [[-85, -200], [85, 200]],
      });
      mapRef.current = map;

      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png",
        { attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com">CARTO</a>', maxZoom: 19 }
      ).addTo(map);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      function visitedFor(props: any): Country | undefined {
        const iso = (props.iso2 || "").toUpperCase();
        return byIso.get(iso) ?? byName.get((props.name || "").toLowerCase());
      }

      L.geoJSON(geo, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        style: (feat: any) => {
          const c = visitedFor(feat.properties);
          if (!c) {
            return { color: "#27272A", weight: 0.5, fillColor: "#18181B", fillOpacity: 0.35 };
          }
          const intensity = Math.sqrt(c.total_days) / Math.sqrt(maxDays); // 0–1
          return {
            color: "#F59E0B",
            weight: 0.7,
            fillColor: "#F59E0B",
            fillOpacity: 0.2 + intensity * 0.65, // 0.2–0.85
          };
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onEachFeature: (feat: any, layer: any) => {
          const c = visitedFor(feat.properties);
          if (c) {
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
          }
        },
      }).addTo(map);
    })();

    return () => {
      destroyed = true;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [details]);

  return (
    <>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <div className="rounded-xl overflow-hidden border border-[#27272A] shadow-sm">
        <div ref={containerRef} style={{ height: 360, width: "100%", background: "#0D0D0F" }} />
      </div>
    </>
  );
}
