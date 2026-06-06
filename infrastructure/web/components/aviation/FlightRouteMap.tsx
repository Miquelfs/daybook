"use client";

import { useEffect, useRef } from "react";
import type { RouteFrequency, AirportVisit } from "@/lib/api";

type CodeMode = "icao" | "iata";

// Map from ICAO → hex color for base airports (different operators get different colors)
type BaseColorMap = Record<string, string>;

interface Props {
  routes: RouteFrequency[];
  airports: AirportVisit[];
  height?: string;
  basesIcao?: string[];
  baseColors?: BaseColorMap;
  codeMode?: CodeMode;
}

const AIRPORT_COLOR = "#F59E0B";   // amber-500 (regular visited airports)

function routeColor(route: RouteFrequency): string {
  const op = (route.operator || "").toLowerCase();
  if (op.includes("norwegian") || route.source === "norwegian") return "#EF4444"; // red-500
  if (op.includes("ryanair") || route.source === "full_csv")    return "#3B82F6"; // blue-500
  if (route.source === "aerolink")                               return "#A78BFA"; // violet-400
  return "#71717A"; // zinc-500 for manual
}

export function FlightRouteMap({
  routes,
  airports,
  height = "400px",
  basesIcao = ["LIME", "GCTS", "LELL", "LEPA"],
  baseColors = {
    LEPA: "#EF4444",  // red — Norwegian base (PMI)
    LIME: "#3B82F6",  // blue — Ryanair base (BGY)
    GCTS: "#3B82F6",  // blue — Ryanair base (TFS)
    LELL: "#A78BFA",  // violet — training base (Sabadell)
  },
  codeMode = "icao",
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);

  const maxCount = Math.max(...routes.map(r => r.count), 1);

  useEffect(() => {
    if (!containerRef.current) return;
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }

    async function init() {
      const L = (await import("leaflet")).default;
      await import("leaflet/dist/leaflet.css");

      const map = L.map(containerRef.current!, {
        center: [48, 12],
        zoom: 4,
        zoomControl: true,
      });
      mapRef.current = map;

      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        attribution: "©OpenStreetMap ©CARTO",
        maxZoom: 18,
      }).addTo(map);

      // Draw routes — colored by operator
      for (const route of routes) {
        if (!route.dep_lat || !route.arr_lat) continue;
        const opacity = 0.25 + 0.55 * (Math.log(route.count + 1) / Math.log(maxCount + 1));
        const weight = 1 + Math.floor(route.count / 10);
        const color = routeColor(route);

        const depLabel = codeMode === "iata"
          ? (route.dep_iata || route.dep_icao)
          : route.dep_icao + (route.dep_iata ? ` / ${route.dep_iata}` : "");
        const arrLabel = codeMode === "iata"
          ? (route.arr_iata || route.arr_icao)
          : route.arr_icao + (route.arr_iata ? ` / ${route.arr_iata}` : "");

        const opLabel = route.operator || route.source || "";

        const line = L.polyline(
          [[route.dep_lat, route.dep_lon!], [route.arr_lat, route.arr_lon!]],
          { color, weight, opacity }
        ).addTo(map);

        line.bindTooltip(
          `<b>${depLabel} → ${arrLabel}</b><br>${route.count} sectors · ${route.total_block_hours.toFixed(1)}h` +
          (opLabel ? `<br><span style="color:#aaa">${opLabel}</span>` : ""),
          { sticky: true }
        );
      }

      // Draw airport dots
      const maxVisits = Math.max(...airports.map(a => a.visit_count), 1);
      const basesSet = new Set(basesIcao);

      for (const airport of airports) {
        if (!airport.latitude || !airport.longitude) continue;

        const isBase = basesSet.has(airport.icao);
        const r = isBase ? 10 : 4 + 10 * (airport.visit_count / maxVisits);
        const color = isBase ? (baseColors[airport.icao] ?? "#22C55E") : AIRPORT_COLOR;

        const circle = L.circleMarker([airport.latitude, airport.longitude], {
          radius: r,
          color,
          fillColor: color,
          fillOpacity: 0.9,
          weight: isBase ? 2 : 1,
        }).addTo(map);

        const icaoLabel = codeMode === "iata"
          ? (airport.iata || airport.icao)
          : airport.icao + (airport.iata ? ` / ${airport.iata}` : "");
        const basePrefix = isBase ? "★ BASE: " : "";

        circle.bindTooltip(
          `<b>${basePrefix}${icaoLabel}</b> ${airport.name || ""}<br>` +
          `${airport.city || ""}, ${airport.country || ""}<br>` +
          `${airport.visit_count} visits · first ${airport.first_visit} · last ${airport.last_visit}`,
          { sticky: true }
        );
      }
    }

    init();

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes, airports, codeMode, basesIcao, baseColors]);

  return (
    <div
      ref={containerRef}
      style={{ height, width: "100%" }}
      className="rounded-lg overflow-hidden"
    />
  );
}
