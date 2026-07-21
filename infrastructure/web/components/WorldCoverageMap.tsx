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

export function WorldCoverageMap({ details }: { details: Country[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<{ remove: () => void } | null>(null);

  const points = details.filter((c) => c.lat != null && c.lng != null);

  useEffect(() => {
    if (!containerRef.current || points.length === 0) return;
    let destroyed = false;

    (async () => {
      await loadScript("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js");
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

      const map = L.map(containerRef.current, { zoomControl: true, center: [20, 10], zoom: 2, worldCopyJump: true });
      mapRef.current = map;

      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
        { attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com">CARTO</a>', maxZoom: 19 }
      ).addTo(map);

      const maxDays = Math.max(...points.map((c) => c.total_days), 1);
      for (const c of points) {
        const radius = 5 + (Math.sqrt(c.total_days) / Math.sqrt(maxDays)) * 19; // 5–24px
        L.circleMarker([c.lat, c.lng], {
          radius,
          color: "#F59E0B",
          weight: 1.5,
          fillColor: "#F59E0B",
          fillOpacity: 0.35,
        })
          .bindPopup(
            `<strong>${c.country}</strong><br>${c.total_days} day${c.total_days === 1 ? "" : "s"} · ${c.cities_visited} ${c.cities_visited === 1 ? "city" : "cities"}`
          )
          .addTo(map);
      }

      const lats = points.map((c) => c.lat as number);
      const lngs = points.map((c) => c.lng as number);
      map.fitBounds(
        [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]],
        { padding: [40, 40], maxZoom: 5 }
      );
    })();

    return () => {
      destroyed = true;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points.length]);

  if (points.length === 0) return null;

  return (
    <>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <div className="rounded-xl overflow-hidden border border-[#27272A] shadow-sm">
        <div ref={containerRef} style={{ height: 340, width: "100%" }} />
      </div>
    </>
  );
}
