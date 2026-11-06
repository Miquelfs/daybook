"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bike, ChevronRight, Cpu, Route as RouteIcon } from "lucide-react";
import { Hero, Skeleton, TabBar } from "@/components/ui/kit";
import { GradeProfile } from "@/components/training/StageProfile";
import { collApi, COLL_KEYS, type CollCourse, type CollDevice } from "@/lib/coll-api";
import { RouteDetail } from "@/components/omyra/coll/RouteDetail";
import { RoutesView } from "@/components/omyra/coll/RoutesView";
import { RidesView } from "@/components/omyra/coll/RidesView";
import { DeviceView } from "@/components/omyra/coll/DeviceView";
import { ago, daysTo, fmtDur, routeState, StateTag, whenText } from "@/components/omyra/coll/parts";

type View = "routes" | "rides" | "device";
const VIEWS = [
  { key: "routes", label: "Routes", icon: RouteIcon },
  { key: "rides", label: "Rides", icon: Bike },
  { key: "device", label: "Coll", icon: Cpu },
] as const;

function SyncBadge({ device }: { device: CollDevice | null | undefined }) {
  return (
    <div className="text-right">
      <p className="inline-flex items-center gap-1.5 text-xs text-[#A1A1AA]">
        <span className={`w-1.5 h-1.5 rounded-full ${device?.seen_at ? "bg-[#22C55E]" : "bg-[#3F3F46]"}`} />
        {device?.seen_at ? `Synced ${ago(device.seen_at)}` : "Not synced yet"}
      </p>
      {device?.battery_pct != null && <p className="text-[11px] text-[#71717A] mt-0.5 tabular-nums">Battery {device.battery_pct}%</p>}
    </div>
  );
}

/** Coll — the bike computer. Routes go out (GPX → converted → on Coll), rides come back. */
export function CollTab() {
  const qc = useQueryClient();
  const building = (q: { state: { data?: CollCourse[] } }) =>
    q.state.data?.some((c) => c.status === "pending" || c.status === "building") ? 5000 : false;
  const { data: courses } = useQuery({ queryKey: COLL_KEYS.courses, queryFn: collApi.courses, refetchInterval: building });
  const { data: settings } = useQuery({ queryKey: COLL_KEYS.settings, queryFn: collApi.settings });
  const { data: lines } = useQuery({ queryKey: COLL_KEYS.map, queryFn: collApi.mapLines });
  const { data: rides } = useQuery({ queryKey: COLL_KEYS.rides, queryFn: collApi.rides });
  const { data: device } = useQuery({ queryKey: COLL_KEYS.device, queryFn: collApi.device });
  const [view, setView] = useState<View>("routes");
  const [open, setOpen] = useState<number | null>(null);

  // /omyra?tab=coll&course=7 (a ride's "Route" chip) opens that route
  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get("course"));
    if (id) setOpen(id);
  }, []);

  const refresh = () => qc.invalidateQueries({ queryKey: ["coll"] });
  const openRoute = (id: number | null) => {
    setOpen(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("course", String(id)); else url.searchParams.delete("course");
    window.history.replaceState(null, "", url.toString());
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (!courses || !settings) return <Skeleton h={420} />;

  const current = open != null ? courses.find((c) => c.id === open) : null;
  if (current) {
    return <RouteDetail course={current} settings={settings} onBack={() => openRoute(null)} onChange={refresh} />;
  }

  const dateOf = (c: CollCourse) => c.brief?.date ?? c.session_date;
  const next = courses
    .filter((c) => dateOf(c) && daysTo(dateOf(c)!) >= 0)
    .sort((a, b) => dateOf(a)!.localeCompare(dateOf(b)!))[0];
  const onColl = courses.filter((c) => c.on_coll === "yes").length;

  return (
    <div className="space-y-6">
      {next?.brief ? (
        <button onClick={() => openRoute(next.id)} className="block w-full text-left group">
          <Hero eyebrow={`Next ride · ${whenText(next.brief.date!)}`} value={Math.round(next.brief.km)} unit="km"
                sub={<>
                  <span className="text-[#FAFAFA] font-medium">{next.name}</span>
                  {` · +${next.brief.climb_m.toLocaleString("en-GB")} m · ≈ ${fmtDur(next.brief.est_minutes)}`}
                  {next.brief.carry?.carbs_g ? ` · ${next.brief.carry.carbs_g} g carbs to carry` : ""}
                </>}
                right={<SyncBadge device={device} />}>
            {next.brief.profile.length > 2 && <div className="mt-4"><GradeProfile profile={next.brief.profile} compact height={40} /></div>}
            <div className="mt-3 flex items-center justify-between">
              <StateTag step={routeState(next)} />
              <span className="inline-flex items-center gap-0.5 text-xs text-[#71717A] group-hover:text-[#A1A1AA]">
                Open route<ChevronRight size={13} />
              </span>
            </div>
          </Hero>
        </button>
      ) : (
        <Hero eyebrow="On Coll" value={onColl} unit={onColl === 1 ? "route" : "routes"}
              sub="Nothing dated coming up — import a route or give a ride in the plan a GPX."
              right={<SyncBadge device={device} />} />
      )}

      <TabBar tabs={VIEWS} value={view} onChange={setView} />

      <div className="pt-2">
        {view === "routes" && <RoutesView courses={courses} lines={lines ?? []} onOpen={openRoute} onChange={refresh} />}
        {view === "rides" && <RidesView rides={rides ?? []} onOpenRoute={openRoute} onChange={refresh} />}
        {view === "device" && <DeviceView device={device ?? null} settings={settings} />}
      </div>
    </div>
  );
}
