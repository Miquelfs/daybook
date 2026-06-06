"use client";

import { useEffect, useRef } from "react";

interface Props {
  polyline: string;         // Google-encoded polyline string
  height?: string;
}

export function ActivityMap({ polyline, height = "280px" }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current || !polyline) return;

    let map: import("leaflet").Map | null = null;

    const init = async () => {
      const L = (await import("leaflet")).default;
      await import("leaflet/dist/leaflet.css");

      // Decode Google polyline → [[lat, lng], ...]
      const poly = await import("polyline");
      const coords: [number, number][] = (poly.decode(polyline) as number[][]).map(
        (p) => [p[0], p[1]] as [number, number]
      );
      if (!coords.length) return;

      if (map) {
        map.remove();
      }

      map = L.map(ref.current!, { zoomControl: true, attributionControl: false });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
      }).addTo(map);

      const line = L.polyline(coords, {
        color: "#3B82F6",
        weight: 3,
        opacity: 0.85,
      }).addTo(map);

      // Start marker
      const start = coords[0];
      const end = coords[coords.length - 1];
      L.circleMarker(start, {
        radius: 6,
        color: "#22C55E",
        fillColor: "#22C55E",
        fillOpacity: 1,
        weight: 2,
      }).addTo(map);
      L.circleMarker(end, {
        radius: 6,
        color: "#EF4444",
        fillColor: "#EF4444",
        fillOpacity: 1,
        weight: 2,
      }).addTo(map);

      map.fitBounds(line.getBounds(), { padding: [20, 20] });
    };

    init();

    return () => {
      map?.remove();
    };
  }, [polyline]);

  return (
    <div
      ref={ref}
      style={{ height }}
      className="w-full rounded-xl overflow-hidden border border-[#27272A]"
    />
  );
}
