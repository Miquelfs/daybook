"use client";

import { useEffect, useRef } from "react";
import type { HeatmapData } from "@/lib/api";

interface Props {
  data: HeatmapData;
}

// Loads a script tag once and resolves when loaded
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

export function HeatMap({ data }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<{ remove: () => void } | null>(null);

  useEffect(() => {
    if (!containerRef.current || data.points.length === 0) return;

    let destroyed = false;

    (async () => {
      // Load Leaflet as a global (leaflet.heat requires window.L)
      await loadScript("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js");
      await loadScript("https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js");

      if (destroyed || !containerRef.current) return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const L = (window as any).L;
      if (!L) return;

      const node = containerRef.current as unknown as { _leaflet_id?: number };
      if (node._leaflet_id != null) {
        try {
          mapRef.current?.remove();
        } catch {
          /* ignore */
        }
        delete node._leaflet_id;
        mapRef.current = null;
        if (destroyed) return;
      }

      const map = L.map(containerRef.current, {
        zoomControl: true,
        center: [20, 10],
        zoom: 3,
      });
      mapRef.current = map;

      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
        {
          attribution:
            '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com">CARTO</a>',
          maxZoom: 19,
        }
      ).addTo(map);

      const heatLayer = L.heatLayer(data.points, {
        radius: 18,
        blur: 22,
        maxZoom: 10,
        gradient: {
          0.2: "#3B82F6",
          0.5: "#8B5CF6",
          0.75: "#F59E0B",
          1.0: "#EF4444",
        },
      });
      heatLayer.addTo(map);

      const lats = data.points.map((p: [number, number, number]) => p[0]);
      const lngs = data.points.map((p: [number, number, number]) => p[1]);
      map.fitBounds(
        [
          [Math.min(...lats), Math.min(...lngs)],
          [Math.max(...lats), Math.max(...lngs)],
        ],
        { padding: [40, 40], maxZoom: 6 }
      );
    })();

    return () => {
      destroyed = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.points.length]);

  return (
    <>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <div className="rounded-xl overflow-hidden border border-[#27272A] shadow-sm">
        <div ref={containerRef} style={{ height: 420, width: "100%" }} />
      </div>
    </>
  );
}
