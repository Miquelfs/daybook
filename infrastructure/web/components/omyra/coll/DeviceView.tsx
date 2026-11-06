"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Block, Panel, Stat, Stats } from "@/components/ui/kit";
import { collApi, COLL_KEYS, type CollDevice, type CollSettings } from "@/lib/coll-api";
import { ago, field, FuelChips, Group, Select } from "./parts";
import { ScreensEditor } from "./ScreensEditor";
import { FirmwarePanel, SyncLog } from "./DeviceDebug";

const FLASH_KB = 12 * 1024;          // the files area of the XIAO's 16 MB flash

function Meter({ pct, warn = false }: { pct: number; warn?: boolean }) {
  return (
    <div className="h-1.5 rounded-full bg-[#27272A] overflow-hidden">
      <div className={`h-full rounded-full ${warn ? "bg-[#EF4444]/40" : "bg-[#3F3F46]"}`} style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
    </div>
  );
}

/** Coll itself: its last sync, battery and storage, and what Daybook gives it to ride with. */
export function DeviceView({ device, settings: s }: { device: CollDevice | null; settings: CollSettings }) {
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);

  async function put(body: Parameters<typeof collApi.putSettings>[0]) {
    setErr(null);
    try {
      qc.setQueryData(COLL_KEYS.settings, await collApi.putSettings(body));
      qc.invalidateQueries({ queryKey: ["coll"] });
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  const [screensErr, setScreensErr] = useState<string | null>(null);
  async function putScreens(screens: string | null) {
    setScreensErr(null);
    try {
      qc.setQueryData(COLL_KEYS.settings, await collApi.putSettings({ screens }));
    } catch (e) {
      setScreensErr((e as Error).message);
    }
  }

  const usedPct = device?.free_kb != null ? (1 - device.free_kb / FLASH_KB) * 100 : null;
  const zones = s.hr_zones;
  const lo = zones ? Math.round(zones[0] * 0.75) : 0;

  return (
    <div className="space-y-8">
      <Block title="The device">
        <Panel className="p-4 space-y-4">
          <div className="flex items-center gap-2 text-sm">
            <span className={`w-2 h-2 rounded-full ${device?.seen_at ? "bg-[#22C55E]" : "bg-[#3F3F46]"}`} />
            <span className="font-medium">{device?.seen_at ? `Synced ${ago(device.seen_at)}` : "Hasn't synced yet"}</span>
            {device?.firmware && <span className="text-xs text-[#71717A]">· firmware {device.firmware}</span>}
          </div>
          {device?.seen_at ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-[10px] text-[#52525B] uppercase tracking-widest mb-1.5">Battery</p>
                <p className="text-lg font-semibold tabular-nums mb-1.5">{device.battery_pct != null ? `${device.battery_pct}%` : "—"}</p>
                {device.battery_pct != null && <Meter pct={device.battery_pct} warn={device.battery_pct < 20} />}
              </div>
              <div>
                <p className="text-[10px] text-[#52525B] uppercase tracking-widest mb-1.5">Storage</p>
                <p className="text-lg font-semibold tabular-nums mb-1.5">
                  {device.free_kb != null ? <>{(device.free_kb / 1024).toFixed(1)}<span className="text-xs font-normal text-[#71717A] ml-1">MB free</span></> : "—"}
                </p>
                {usedPct != null && <Meter pct={usedPct} warn={usedPct > 85} />}
              </div>
              <div>
                <p className="text-[10px] text-[#52525B] uppercase tracking-widest mb-1.5">On board</p>
                <p className="text-lg font-semibold tabular-nums">{device.have.length}<span className="text-xs font-normal text-[#71717A] ml-1">routes</span></p>
                <p className="text-xs text-[#71717A]">{device.rides_waiting ? `${device.rides_waiting} ride(s) still to upload` : "every ride uploaded"}</p>
              </div>
            </div>
          ) : (
            <p className="text-xs text-[#71717A]">
              Coll syncs on its own when it&apos;s home on Wi-Fi. Until the hardware is here, <code className="text-[#A1A1AA]">make coll-device</code> on
              the Mac plays its part against the Pi.
            </p>
          )}
          <p className={`text-xs ${s.token_configured ? "text-[#52525B]" : "text-rose-400"}`}>
            {s.token_configured ? "Device token set on the Pi — Coll can sync." : "No COLL_TOKEN in the Pi's .env: Coll can't sync yet."}
          </p>
        </Panel>
      </Block>

      <Block title="Sync log" note="Every request Coll makes, grouped by sync — open one to see each step.">
        <SyncLog />
      </Block>

      <Block title="Ride screens" note="The pages Coll shows while riding, in order (PAGE cycles them). Map, Climb and Fuel only appear when the ride has a route or a plan.">
        <ScreensEditor s={s} onSave={putScreens} />
        {screensErr && <p className="text-xs text-rose-400 mt-2">{screensErr}</p>}
      </Block>

      <Block title="Firmware">
        <FirmwarePanel running={device?.firmware ?? null} />
      </Block>

      <Block title="Rider" note="From Daybook — weight, age, ride zones, timezone. Changes reach Coll at its next sync.">
        <Panel className="p-4 space-y-4">
          <Stats cols={3}>
            <Stat label="Weight" value={s.profile.weight_kg ?? "—"} unit="kg" />
            <Stat label="Age" value={s.profile.age ?? "—"} sub={s.profile.sex ?? undefined} />
            <Stat label="Max HR" value={s.max_hr ?? "—"} unit="bpm" />
          </Stats>
          {zones && (
            <Group title="Heart-rate zones">
              <div className="flex gap-0.5 h-7 rounded-lg overflow-hidden">
                {zones.map((top, i) => {
                  const from = i ? zones[i - 1] : lo;
                  return (
                    <div key={i} className={`flex items-center justify-center text-[10px] font-medium ${
                      i === 1 ? "bg-[#F59E0B]/15 text-[#F59E0B]" : "bg-[#18181B] text-[#A1A1AA]"}`}
                         style={{ flex: Math.max(1, top - from) }}>
                      Z{i + 1}
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-0.5 mt-1">
                {zones.map((top, i) => (
                  <span key={i} className="text-[10px] text-[#71717A] tabular-nums text-right"
                        style={{ flex: Math.max(1, top - (i ? zones[i - 1] : lo)) }}>{top}</span>
                ))}
              </div>
              <p className="text-xs text-[#52525B] mt-1">Top of each zone, bpm · Z2 is where long days live · {s.timezone}</p>
            </Group>
          )}
        </Panel>
      </Block>

      <Block title="Fuel" note="Each route's reminders follow its session (length, zone, gut training before the race, sweat rate) with the carb product below.">
        <Panel className="p-4 space-y-4">
          <Group title="Carb product">
            <Select value={s.fuel_product?.id ?? ""} onChange={(v) => put({ fuel_product_id: v ? Number(v) : null })}>
              {s.products.map((p) => (
                <option key={p.id} value={p.id}>{p.name} · {p.carbs_g} g{p.caffeine_mg ? ` · ${p.caffeine_mg} mg caffeine` : ""}</option>
              ))}
            </Select>
            <p className="text-xs text-[#52525B] mt-1">From your <Link href="/omyra?tab=fuel" className="underline hover:text-[#A1A1AA]">Fuel</Link> products.</p>
          </Group>
          <Group title="Rides without a route">
            <div className="mb-2"><FuelChips plan={s.fuel_plan} /></div>
            <input className={field} placeholder="e.g. Drink:20,Gel:40:25" defaultValue={s.fuel_plan ?? ""} key={`d${s.fuel_plan}`}
                   onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                   onBlur={(e) => e.target.value.trim() !== (s.fuel_plan ?? "") && put({ fuel_plan: e.target.value })} />
          </Group>
          {err && <p className="text-xs text-rose-400">{err}</p>}
        </Panel>
      </Block>
    </div>
  );
}
