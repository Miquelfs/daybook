"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { StoryDay } from "@/lib/travel-api";

export interface StoryMapHandle {
  /** Zoom to one day's path and moments (null → the whole trip). */
  focusDay: (date: string | null) => void;
}

const ROUTE = "#71717A";
const ACCENT = "#F59E0B";

/** The box around the trip on the ground: 2nd–98th percentile of the track (so the flight from
 *  home doesn't shrink the destination to a dot) plus every moment. Same rule as the exported book. */
function groundBounds(points: [number, number][], keep: [number, number][]): [[number, number], [number, number]] | null {
  if (!points.length && !keep.length) return null;
  let box: [number, number, number, number] = [90, -90, 180, -180];
  if (points.length) {
    const lats = points.map((p) => p[0]).sort((a, b) => a - b);
    const lngs = points.map((p) => p[1]).sort((a, b) => a - b);
    const cut = (v: number[], q: number) => v[Math.min(v.length - 1, Math.max(0, Math.floor(q * (v.length - 1))))];
    box = [cut(lats, 0.02), cut(lats, 0.98), cut(lngs, 0.02), cut(lngs, 0.98)];
  }
  for (const [la, ln] of keep) box = [Math.min(box[0], la), Math.max(box[1], la), Math.min(box[2], ln), Math.max(box[3], ln)];
  return [[box[0], box[2]], [box[1], box[3]]];
}

/**
 * The trip on one map: every day's path, the moments numbered in order. Tap a number to jump to
 * that moment in the story below.
 */
export const StoryMap = forwardRef<StoryMapHandle, { days: StoryDay[]; onMoment?: (id: number) => void; className?: string }>(
  function StoryMap({ days, onMoment, className = "h-72" }, ref) {
    const box = useRef<HTMLDivElement>(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map = useRef<any>(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lines = useRef<Map<string, any>>(new Map());
    const onMomentRef = useRef(onMoment);
    onMomentRef.current = onMoment;

    const fit = (only: string | null) => {
      const m = map.current;
      if (!m) return;
      const sel = only ? days.filter((d) => d.date === only) : days;
      const b = groundBounds(sel.flatMap((d) => d.route),
        sel.flatMap((d) => d.moments.filter((x) => x.lat != null).map((x) => [x.lat!, x.lng!] as [number, number])));
      if (b) m.fitBounds(b, { padding: [24, 24], maxZoom: 15 });
      lines.current.forEach((line, date) => line.setStyle(
        only && date === only ? { color: ACCENT, opacity: 0.95, weight: 4 } : { color: ROUTE, opacity: only ? 0.35 : 0.8, weight: 3 }));
    };

    useImperativeHandle(ref, () => ({ focusDay: (d) => fit(d) }));

    useEffect(() => {
      if (!box.current) return;
      let gone = false;
      import("leaflet").then((L) => {
        if (gone || !box.current) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const node = box.current as any;
        if (node._leaflet_id != null) { try { delete node._leaflet_id; } catch { /* noop */ } }
        const m = L.map(box.current, { zoomControl: false, attributionControl: false, scrollWheelZoom: false });
        map.current = m;
        L.control.zoom({ position: "bottomright" }).addTo(m);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(m);
        lines.current = new Map();
        for (const d of days) {
          if (d.route.length < 2) continue;
          const line = L.polyline(d.route, { color: ROUTE, weight: 3, opacity: 0.8, lineJoin: "round" }).addTo(m);
          line.bindTooltip(`Day ${d.index}`, { sticky: true });
          lines.current.set(d.date, line);
        }
        for (const d of days) {
          for (const x of d.moments) {
            if (x.lat == null || x.lng == null) continue;
            const icon = L.divIcon({
              className: "",
              html: `<div style="width:22px;height:22px;border-radius:11px;background:${ACCENT};color:#000;border:2px solid #fff;font:600 10px/18px system-ui;text-align:center">${x.n ?? ""}</div>`,
              iconSize: [22, 22], iconAnchor: [11, 11],
            });
            const mk = L.marker([x.lat, x.lng], { icon, title: x.title ?? x.place ?? "" }).addTo(m);
            mk.on("click", () => onMomentRef.current?.(x.id));
          }
        }
        const b = groundBounds(days.flatMap((d) => d.route),
          days.flatMap((d) => d.moments.filter((x) => x.lat != null).map((x) => [x.lat!, x.lng!] as [number, number])));
        if (b) m.fitBounds(b, { padding: [24, 24], maxZoom: 14 });
        else m.setView([20, 0], 2);
      });
      return () => {
        gone = true;
        map.current?.remove();
        map.current = null;
      };
    }, [days]);

    return <div ref={box} className={`${className} rounded-2xl border border-[#27272A] overflow-hidden relative isolate z-0`} />;
  });
