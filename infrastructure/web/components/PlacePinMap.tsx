"use client";

import { useEffect, useRef } from "react";

// Small single-pin Leaflet map for a place's coordinates.
// Same raw-leaflet dynamic-import pattern as LocationMap (no react-leaflet).
export function PlacePinMap({ lat, lng, label }: { lat: number; lng: number; label: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<ReturnType<typeof Object> | null>(null);

  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((L) => {
      if (cancelled || !containerRef.current) return;
      const node = containerRef.current as HTMLDivElement & { _leaflet_id?: number };
      if (node._leaflet_id != null) {
        try { delete node._leaflet_id; } catch { /* noop */ }
      }
      const map = L.map(node, {
        center: [lat, lng],
        zoom: 14,
        zoomControl: false,
        attributionControl: false,
        scrollWheelZoom: false,
        dragging: false,
      });
      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        maxZoom: 19,
      }).addTo(map);
      L.circleMarker([lat, lng], {
        radius: 8,
        color: "#F59E0B",
        weight: 2,
        fillColor: "#F59E0B",
        fillOpacity: 0.5,
      }).addTo(map).bindTooltip(label);
      mapRef.current = map;
    });
    return () => {
      cancelled = true;
      const m = mapRef.current as { remove?: () => void } | null;
      if (m?.remove) m.remove();
      mapRef.current = null;
    };
  }, [lat, lng, label]);

  return (
    <div
      ref={containerRef}
      className="h-40 rounded-xl border border-[#27272A] overflow-hidden relative isolate"
      style={{ position: "relative" }}
    />
  );
}
