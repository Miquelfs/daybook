"use client";

import { useEffect, useRef } from "react";
import type { CollPackMap, CollTurn } from "@/lib/coll-api";
import { turnText } from "@/lib/coll-api";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface CollLine { id: number; name: string; polyline: string; synced: boolean }

const AMBER = "#F59E0B", ON = "#A1A1AA", OFF = "#52525B";

const WP: Record<string, { glyph: string; label: string }> = {
  feed: { glyph: "◆", label: "Feed" },
  summit: { glyph: "▲", label: "Top" },
  hazard: { glyph: "!", label: "Warning" },
  poi: { glyph: "•", label: "Waypoint" },
};

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/**
 * Coll's courses on a map. Overview: every built course (amber = the selected one, grey = on Coll,
 * dark = not on Coll); tap one to open it. Course: its line, each turn prompt (amber = KEEP, the ones to
 * check) and the waypoints from the pack; `focus` (a prompt's index) flies there and opens it.
 */
export function CollMap({ lines, selected, onSelect, pack, turns, focus, height = "300px" }: {
  lines: CollLine[];
  selected?: number | null;
  onSelect?: (id: number) => void;
  pack?: CollPackMap | null;
  turns?: CollTurn[];
  focus?: number | null;
  height?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const fitKey = useRef<string>("");

  // the map itself, once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      await import("leaflet/dist/leaflet.css");
      if (cancelled || !ref.current || mapRef.current) return;
      mapRef.current = L.map(ref.current, { zoomControl: true, attributionControl: false, scrollWheelZoom: false });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(mapRef.current);
      layerRef.current = L.layerGroup().addTo(mapRef.current);
      draw();
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function draw() {
    const map = mapRef.current, group = layerRef.current;
    if (!map || !group) return;
    const L = (await import("leaflet")).default;
    const poly = await import("polyline");
    group.clearLayers();
    markersRef.current = [];
    const bounds: [number, number][] = [];
    const ordered = [...lines].sort((a, b) => Number(a.id === selected) - Number(b.id === selected));   // selected on top
    for (const c of ordered) {
      const pts = (poly.decode(c.polyline) as number[][]).map((p) => [p[0], p[1]] as [number, number]);
      if (!pts.length) continue;
      const sel = c.id === selected;
      if (sel || selected == null) bounds.push(...pts);
      if (sel) L.polyline(pts, { color: "#000000", weight: 7, opacity: 0.35 }).addTo(group);
      const line = L.polyline(pts, {
        color: sel ? AMBER : c.synced ? ON : OFF, weight: sel ? 4 : 3, opacity: sel ? 1 : 0.85,
        dashArray: c.synced || sel ? undefined : "6 6",
      }).addTo(group);
      line.bindTooltip(esc(c.name), { sticky: true });
      if (onSelect) line.on("click", () => onSelect(c.id));
      if (sel) {
        L.circleMarker(pts[0], { radius: 5, color: "#FFFFFF", weight: 2, fillColor: "#22C55E", fillOpacity: 1 }).addTo(group);
        L.circleMarker(pts[pts.length - 1], { radius: 5, color: "#FFFFFF", weight: 2, fillColor: "#EF4444", fillOpacity: 1 }).addTo(group);
      }
    }
    if (pack) {
      pack.turns.forEach((p, i) => {
        const t = turns?.[i];
        const keep = t?.kind === 1;
        const m = L.circleMarker([p.lat, p.lon], {
          radius: keep ? 6 : 4, color: keep ? AMBER : "#FFFFFF", weight: 2,
          fillColor: keep ? AMBER : "#18181B", fillOpacity: 1,
        }).addTo(group);
        m.bindPopup(`<b>km ${(p.at / 1000).toFixed(1)}</b> · ${esc(t ? turnText(t) : "turn")}`);
        markersRef.current[i] = m;
      });
      for (const w of pack.waypoints) {
        const k = WP[w.kind] ?? WP.poi;
        L.marker([w.lat, w.lon], {
          icon: L.divIcon({
            className: "", iconSize: [18, 18], iconAnchor: [9, 9],
            html: `<div style="width:18px;height:18px;border-radius:9px;background:#0D0D0F;border:1.5px solid ${w.kind === "hazard" ? "#FB7185" : "#A1A1AA"};
                   color:${w.kind === "hazard" ? "#FB7185" : "#FAFAFA"};font:700 10px/15px system-ui;text-align:center">${k.glyph}</div>`,
          }),
        }).bindPopup(`<b>${k.label}</b> · ${esc(w.name || "")}`).addTo(group);
      }
    }
    const key = `${selected ?? "all"}:${lines.length}`;
    if (bounds.length && fitKey.current !== key) {          // refit only when what's shown changes
      fitKey.current = key;
      map.fitBounds(L.latLngBounds(bounds), { padding: [24, 24] });
    }
  }

  useEffect(() => { draw(); }, [lines, selected, pack, turns]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (focus == null || !pack?.turns[focus] || !mapRef.current) return;
    const p = pack.turns[focus];
    mapRef.current.setView([p.lat, p.lon], 16);
    markersRef.current[focus]?.openPopup();
    ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [focus, pack]);

  return <div ref={ref} style={{ height }} className="w-full rounded-xl overflow-hidden border border-[#27272A]" />;
}
