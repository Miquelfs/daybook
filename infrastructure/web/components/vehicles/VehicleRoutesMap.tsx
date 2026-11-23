"use client";

import { useEffect, useRef } from "react";
import type { VehicleRoute } from "@/lib/statements-api";

// Every leg of a vehicle's period on one map; the picked day drawn on top in amber.
// Raw leaflet via dynamic import, like PlacePinMap / LocationMap.
export function VehicleRoutesMap({ routes, highlight }: { routes: VehicleRoute[]; highlight?: string | null }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<{ remove: () => void } | null>(null);

  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((L) => {
      if (cancelled || !ref.current) return;
      const node = ref.current as HTMLDivElement & { _leaflet_id?: number };
      if (node._leaflet_id != null) { try { delete node._leaflet_id; } catch { /* noop */ } }
      const map = L.map(node, { zoomControl: false, attributionControl: false, scrollWheelZoom: false });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
      const dark = document.documentElement.dataset.theme !== "light";
      const pane = map.getPane("tilePane");
      if (pane && dark) pane.style.filter = "invert(1) hue-rotate(180deg) brightness(0.9) contrast(0.9)";

      const bounds = L.latLngBounds([]);
      const picked = routes.find((r) => r.date === highlight);
      for (const r of routes) {
        if (r === picked) continue;
        for (const leg of r.legs) {
          if (leg.length < 2) continue;
          L.polyline(leg, { color: dark ? "#A1A1AA" : "#52525B", weight: 2, opacity: picked ? 0.25 : 0.5 }).addTo(map);
          if (!picked) leg.forEach((p) => bounds.extend(p));
        }
      }
      if (picked) {
        for (const leg of picked.legs) {
          if (leg.length < 2) continue;
          L.polyline(leg, { color: "#F59E0B", weight: 4, opacity: 0.95 }).addTo(map);
          L.circleMarker(leg[0], { radius: 4, color: "#F59E0B", fillOpacity: 1 }).addTo(map);
          leg.forEach((p) => bounds.extend(p));
        }
      }
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [16, 16], maxZoom: 15 });
      else map.setView([39.57, 2.65], 10);
      mapRef.current = map;
    });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [routes, highlight]);

  return <div ref={ref} className="h-64 rounded-xl border border-[#27272A] overflow-hidden relative isolate" />;
}
