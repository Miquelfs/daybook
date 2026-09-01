"use client";

import { useEffect, useRef } from "react";
import type { RouteFrequency, AirportVisit } from "@/lib/api";

type CodeMode = "icao" | "iata";
export type MapStyle = "dark" | "light" | "satellite";

// Map from ICAO → hex color for base airports (different operators get different colors)
type BaseColorMap = Record<string, string>;

interface Props {
  routes: RouteFrequency[];
  airports: AirportVisit[];
  height?: string;
  basesIcao?: string[];
  baseColors?: BaseColorMap;
  codeMode?: CodeMode;
  mapStyle?: MapStyle;
  // When set, routes are coloured by matching `route.operator` (airline name)
  // against these keys (exact, then case-insensitive substring). Leaves the
  // pilot-logbook colour logic untouched when omitted.
  airlineColors?: BaseColorMap;
}

const OSM_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
// Applied to the tile pane only (leaves routes/markers untouched) to fake a
// dark basemap from the light OSM tiles.
const DARK_TILE_FILTER = "invert(1) hue-rotate(180deg) brightness(0.9) contrast(0.9)";

const TILE_LAYERS: Record<MapStyle, { url: string; attribution: string }> = {
  dark: {
    url: OSM_URL,
    attribution: "©OpenStreetMap",
  },
  light: {
    url: OSM_URL,
    attribution: "©OpenStreetMap",
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "©Esri ©Maxar",
  },
};

const AIRPORT_COLOR = "#F59E0B";   // amber-500 (regular visited airports)
const DEFAULT_ROUTE_COLOR = "#71717A"; // zinc-500

function routeColor(route: RouteFrequency): string {
  const op = (route.operator || "").toLowerCase();
  if (op.includes("norwegian") || route.source === "norwegian") return "#EF4444"; // red-500
  if (op.includes("ryanair") || route.source === "full_csv")    return "#3B82F6"; // blue-500
  if (route.source === "aerolink")                               return "#A78BFA"; // violet-400
  return DEFAULT_ROUTE_COLOR;
}

// Colour a route by airline name against a supplied map (exact key, then
// case-insensitive substring). Used by the passenger logbook.
function airlineRouteColor(route: RouteFrequency, colors: BaseColorMap): string {
  const op = (route.operator || "").trim();
  if (op in colors) return colors[op];
  const low = op.toLowerCase();
  for (const [name, color] of Object.entries(colors)) {
    if (low.includes(name.toLowerCase())) return color;
  }
  return DEFAULT_ROUTE_COLOR;
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
  mapStyle = "dark",
  airlineColors,
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

      const tiles = TILE_LAYERS[mapStyle] ?? TILE_LAYERS.dark;
      L.tileLayer(tiles.url, {
        attribution: tiles.attribution,
        maxZoom: 18,
      }).addTo(map);
      if (mapStyle === "dark") {
        const tilePane = map.getPane("tilePane");
        if (tilePane) tilePane.style.filter = DARK_TILE_FILTER;
      }

      // Draw routes — colored by operator
      for (const route of routes) {
        if (!route.dep_lat || !route.arr_lat) continue;
        const opacity = 0.25 + 0.55 * (Math.log(route.count + 1) / Math.log(maxCount + 1));
        const weight = 1 + Math.floor(route.count / 10);
        const color = airlineColors ? airlineRouteColor(route, airlineColors) : routeColor(route);

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
  }, [routes, airports, codeMode, basesIcao, baseColors, mapStyle, airlineColors]);

  return (
    <div
      ref={containerRef}
      style={{ height, width: "100%" }}
      className="rounded-lg overflow-hidden"
    />
  );
}
