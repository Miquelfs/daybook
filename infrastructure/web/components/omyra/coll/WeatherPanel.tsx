"use client";

import { useState } from "react";
import { CloudRain, RefreshCw, Wind } from "lucide-react";
import { Block, Panel, Stat, Stats } from "@/components/ui/kit";
import type { CollWeather } from "@/lib/coll-api";
import { ago, field, fmtDate, fmtDur, quiet } from "./parts";

/** Wind along the route (head up in amber, tail down in grey), temperature as a line, rain as marks. */
function WeatherStrip({ w, km }: { w: CollWeather; km: number }) {
  const pts = w.points ?? [];
  if (pts.length < 2) return null;
  const W = 1000, H = 90, mid = 46;
  const x = (k: number) => (k / (km || 1)) * W;
  const maxHead = Math.max(15, ...pts.map((p) => Math.abs(p.head_kmh)));
  const temps = pts.map((p) => p.temp).filter((t): t is number => t != null);
  const tLo = Math.min(...temps), tHi = Math.max(...temps);
  const ty = (t: number) => 8 + (1 - (t - tLo) / (tHi - tLo || 1)) * 30;
  const step = x(pts[1].km) - x(pts[0].km);
  const temp = pts.filter((p) => p.temp != null)
    .map((p, i) => `${i ? "L" : "M"}${x(p.km).toFixed(1)},${ty(p.temp!).toFixed(1)}`).join("");
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block w-full" style={{ height: H }}>
        <line x1={0} x2={W} y1={mid + 22} y2={mid + 22} stroke="var(--viz-grid)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {pts.map((p, i) => {
          const h = (Math.abs(p.head_kmh) / maxHead) * 20;
          const head = p.head_kmh > 0;
          return (
            <rect key={i} x={x(p.km)} width={Math.max(1, step - 0.5)}
                  y={head ? mid + 22 - h : mid + 22} height={h}
                  fill={head ? "#F59E0B" : "var(--viz-axis)"} opacity={head ? 0.7 : 0.4} />
          );
        })}
        {pts.map((p, i) => ((p.rain_pct ?? 0) >= 50 || (p.rain_mm ?? 0) >= 0.5) && (
          <rect key={`r${i}`} x={x(p.km)} width={Math.max(1, step - 0.5)} y={H - 4} height={4} fill="var(--viz-calm)" />
        ))}
        <path d={temp} fill="none" stroke="var(--viz-alt)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-[10px] text-[#52525B] mt-1 tabular-nums">
        <span>{pts[0].eta} · {tLo === tHi ? `${tLo}°` : `${tLo}–${tHi}°`}</span>
        <span>line: temperature · bars: headwind ▲ amber, tailwind ▼ grey · blue: rain likely</span>
        <span>{w.finish_at}</span>
      </div>
    </div>
  );
}

/** The forecast along the route on its day, at the time you'll be at each km. */
export function WeatherPanel({ w, km, start, onStart, onRefresh }: {
  w: CollWeather | null; km: number; start: string | null;
  onStart: (v: string) => Promise<boolean>; onRefresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(false);
  if (!w) return null;
  const ok = w.status === "ok" || w.status === "stale";

  const startCtl = edit ? (
    <input className={`${field} w-24 py-1`} type="time" autoFocus defaultValue={start ?? w.start ?? "08:00"}
           onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
           onBlur={async (e) => { if (await onStart(e.target.value)) setEdit(false); }} />
  ) : (
    <button className={quiet} onClick={() => setEdit(true)}>Start {start ?? w.start ?? "08:00"}</button>
  );

  const note = !ok ? ({
    too_far: `The forecast reaches 16 days ahead — from ${w.available_from ? fmtDate(w.available_from) : "closer to the day"}.`,
    no_date: "Give the route a day (a planned session or a race) to see its weather.",
    past: "The day has passed.",
    unavailable: "No forecast right now — Open-Meteo didn't answer. It tries again next time.",
  } as Record<string, string>)[w.status] : undefined;

  return (
    <Block title="Weather on the day"
           action={<div className="flex items-center gap-4">
             {startCtl}
             {ok && (
               <button className={quiet} disabled={busy} title="Fetch the forecast again"
                       onClick={async () => { setBusy(true); try { await onRefresh(); } finally { setBusy(false); } }}>
                 <RefreshCw size={12} className={busy ? "animate-spin" : ""} />{w.fetched_at ? ago(w.fetched_at) : ""}
               </button>
             )}
           </div>}>
      {!ok ? <p className="text-xs text-[#52525B]">{note}</p> : (
        <Panel className="p-4 space-y-4">
          <Stats cols={4}>
            <Stat label="Temperature" value={w.temp_min === w.temp_max ? `${w.temp_min}` : `${w.temp_min}–${w.temp_max}`} unit="°C"
                  sub={w.summits?.length ? `coldest top ${Math.min(...w.summits.map((s) => s.temp ?? 99))}°` : undefined} />
            <Stat label="Rain" value={w.rain ? `km ${Math.round(w.rain.from_km)}` : "Dry"}
                  sub={w.rain ? `likely from ${w.rain.at} · ~${w.rain.wet_km} km wet` : "under 50 % all day"} />
            <Stat label="Wind" value={w.wind_min ? `${w.wind_min > 0 ? "+" : "−"}${fmtDur(Math.abs(w.wind_min))}` : "±0"}
                  sub={w.wind_min && w.wind_min > 0 ? "it costs you" : w.wind_min && w.wind_min < 0 ? "it gives you" : "barely matters"} />
            <Stat label="Finish" value={w.finish_at ?? "—"} sub={`riding ≈ ${fmtDur(w.riding_min ?? 0)} + stops`} />
          </Stats>
          <WeatherStrip w={w} km={km} />
          <div className="grid gap-4 md:grid-cols-2 text-xs">
            <div className="space-y-1">
              {(w.headwind ?? []).map((h, i) => (
                <p key={`h${i}`} className="text-[#A1A1AA]"><Wind size={12} className="inline mr-1.5 text-[#F59E0B]" />
                  Headwind km {h.from_km}–{h.to_km} · ~{h.kmh} km/h at the bars</p>
              ))}
              {(w.tailwind ?? []).map((h, i) => (
                <p key={`t${i}`} className="text-[#A1A1AA]"><Wind size={12} className="inline mr-1.5 text-[#52525B]" />
                  Tailwind km {h.from_km}–{h.to_km} · ~{h.kmh} km/h</p>
              ))}
              {w.rain && <p className="text-[#A1A1AA]"><CloudRain size={12} className="inline mr-1.5 text-[#52525B]" />
                Rain likely from km {Math.round(w.rain.from_km)} ({w.rain.at}){w.rain.pct != null ? `, ${w.rain.pct} %` : ""}</p>}
              {!!w.max_gust_kmh && w.max_gust_kmh >= 40 && <p className="text-rose-400">Gusts to {w.max_gust_kmh} km/h</p>}
              <p className="text-[#52525B]">Coll shows at the start: “{w.line}”</p>
            </div>
            {!!w.summits?.length && (
              <div className="divide-y divide-[#18181B]">
                {w.summits.map((s, i) => (
                  <div key={i} className="py-1.5 flex items-center gap-3 tabular-nums">
                    <span className="w-12 text-[#71717A]">km {Math.round(s.km)}</span>
                    <span className="flex-1 truncate text-[#D4D4D8]">{s.name ?? "Climb top"}</span>
                    <span className="text-[#71717A]">{s.eta}</span>
                    <span className="w-10 text-right font-medium">{s.temp ?? "—"}°</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {w.status === "stale" && <p className="text-xs text-[#52525B]">Last forecast kept — couldn't refresh it.</p>}
        </Panel>
      )}
    </Block>
  );
}
