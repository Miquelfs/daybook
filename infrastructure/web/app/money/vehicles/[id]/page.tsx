"use client";

import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Bar, BarChart, CartesianGrid, Line, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Check, Coins, Gauge, Pencil, RefreshCw, Trash2, X } from "lucide-react";
import { moneyApi, fmtAmount } from "@/lib/money-api";
import { vehiclesApi } from "@/lib/statements-api";
import { Block, Empty, Hero, Panel, Pill, Skeleton, Stat, Stats, TabBar } from "@/components/ui/kit";
import { VehicleForm } from "@/components/vehicles/VehicleForm";
import { RemindersBlock } from "@/components/vehicles/RemindersBlock";

const VehicleRoutesMap = dynamic(() => import("@/components/vehicles/VehicleRoutesMap").then((m) => m.VehicleRoutesMap), {
  ssr: false, loading: () => <Skeleton h={256} />,
});

const km = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("en-GB"));
const today = () => format(new Date(), "yyyy-MM-dd");
const input = "bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-1.5 text-base sm:text-sm text-[#FAFAFA] placeholder:text-[#3F3F46] outline-none focus:border-[#52525B] min-w-0";
const save = "inline-flex items-center gap-1 text-xs bg-[#F59E0B]/10 border border-[#F59E0B]/30 text-[#F59E0B] hover:bg-[#F59E0B]/20 rounded-lg px-3 py-1.5 disabled:opacity-50";
const tick = { fontSize: 10, fill: "var(--viz-axis)" };

type LogTab = "km" | "cost";

export default function VehiclePage() {
  const id = Number(useParams().id);
  const router = useRouter();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [logTab, setLogTab] = useState<LogTab>("km");
  const [picked, setPicked] = useState<string | null>(null);

  const { data: s, isLoading } = useQuery({ queryKey: ["vehicles", id], queryFn: () => vehiclesApi.get(id) });
  const { data: odo = [] } = useQuery({ queryKey: ["vehicles", id, "odo"], queryFn: () => vehiclesApi.odometer(id) });
  const { data: costs = [] } = useQuery({ queryKey: ["vehicles", id, "costs"], queryFn: () => vehiclesApi.costs(id) });
  const { data: days = [] } = useQuery({ queryKey: ["vehicles", id, "days"], queryFn: () => vehiclesApi.days(id, 200) });
  const { data: routes = [] } = useQuery({ queryKey: ["vehicles", id, "routes"], queryFn: () => vehiclesApi.routes(id, 12) });
  const { data: meta } = useQuery({ queryKey: ["money", "meta"], queryFn: () => moneyApi.meta() });

  const refreshAll = () => { qc.invalidateQueries({ queryKey: ["vehicles"] }); qc.invalidateQueries({ queryKey: ["money"] }); };

  // log forms
  const [odoDate, setOdoDate] = useState(today());
  const [odoKm, setOdoKm] = useState("");
  const [cDate, setCDate] = useState(today());
  const [cName, setCName] = useState("");
  const [cAmount, setCAmount] = useState("");
  const [cSub, setCSub] = useState("");
  const [cKm, setCKm] = useState("");
  const [cAccount, setCAccount] = useState("");

  const addOdo = useMutation({
    mutationFn: () => vehiclesApi.addOdometer(id, { date: odoDate, km: Number(odoKm.replace(",", ".")) }),
    onSuccess: () => { setOdoKm(""); refreshAll(); },
  });
  const addCost = useMutation({
    mutationFn: () => vehiclesApi.addCost(id, {
      date: cDate, name: cName.trim(), amount: Number(cAmount.replace(",", ".")), subcategory: cSub.trim() || undefined,
      account: cAccount || meta?.defaults.account || undefined,
      odometer_km: cKm.trim() ? Number(cKm.replace(",", ".")) : undefined,
    }),
    onSuccess: () => { setCName(""); setCAmount(""); setCKm(""); refreshAll(); },
  });
  const delOdo = useMutation({ mutationFn: (rid: number) => vehiclesApi.deleteOdometer(id, rid), onSuccess: refreshAll });
  const patch = useMutation({
    mutationFn: (b: Parameters<typeof vehiclesApi.patch>[1]) => vehiclesApi.patch(id, b),
    onSuccess: () => { setEditing(false); refreshAll(); },
  });
  const remove = useMutation({
    mutationFn: () => vehiclesApi.remove(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["vehicles"] }); router.push("/money/vehicles"); },
  });
  const recompute = useMutation({ mutationFn: () => vehiclesApi.refresh(), onSuccess: refreshAll });

  if (isLoading || !s) return <main className="max-w-2xl mx-auto px-4"><Skeleton h={200} /></main>;
  const v = s.vehicle;
  const kmPeriod = s.km_period || s.gps.km_period;
  const subsOffered = [...new Set([...v.subcategories, ...s.by_subcategory.map((b) => b.subcategory)])].filter((x) => x !== "Other");

  return (
    <main className="max-w-2xl mx-auto px-4 pb-24 space-y-8">
      <div>
        <Link href="/money/vehicles" className="text-xs text-[#71717A] hover:text-[#A1A1AA] uppercase tracking-widest inline-block mb-2">← Vehicles</Link>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">{v.name}</h1>
            <p className="text-sm text-[#71717A] mt-0.5">
              {[v.make_model, v.plate, v.year, v.sold_on ? `sold ${format(parseISO(v.sold_on), "MMM yyyy")}` : null].filter(Boolean).join(" · ") || "—"}
            </p>
          </div>
          <button onClick={() => setEditing(!editing)} className="text-[#71717A] hover:text-[#FAFAFA] mt-1" title="Edit">
            {editing ? <X size={16} /> : <Pencil size={15} />}
          </button>
        </div>
      </div>

      {editing && (
        <Panel className="p-4 space-y-4">
          <VehicleForm initial={v} onSave={(b) => patch.mutate(b)} saving={patch.isPending}
                       error={patch.error ? (patch.error as Error).message : null} />
          <button className="inline-flex items-center gap-1 text-xs text-rose-400 hover:text-rose-300"
                  onClick={() => { if (confirm(`Remove ${v.name}? Its expenses stay in Money.`)) remove.mutate(); }}>
            <Trash2 size={12} />Remove vehicle
          </button>
        </Panel>
      )}

      <Hero
        eyebrow="Cost per km · last 12 months"
        value={s.per_km_period != null ? `€${s.per_km_period.toFixed(2)}` : "—"}
        sub={s.per_km_period != null
          ? `${fmtAmount(s.cost_period)} over ${km(s.km_period)} km`
          : s.odometer == null ? "Log an odometer reading to start counting kilometres" : "Log a second reading to count kilometres"}
      />

      <Stats cols={4}>
        <Stat label="Odometer" value={km(s.odometer)} unit="km"
              sub={s.last_reading ? format(parseISO(s.last_reading.date), "d MMM yyyy") : undefined} />
        <Stat label="Km · 12 mo" value={km(kmPeriod)} sub={s.km_period ? `GPS saw ${km(s.gps.km_period)}` : s.gps.km_period ? "from GPS" : undefined} />
        <Stat label="Cost · 12 mo" value={fmtAmount(s.cost_period)} sub={`${fmtAmount(s.per_month)} a month`} />
        <Stat label="All time" value={fmtAmount(s.cost_total)}
              sub={s.per_km != null ? `€${s.per_km.toFixed(2)}/km over ${km(s.km_total)} km` : undefined} />
      </Stats>

      <Block title="Log">
        <Panel className="p-4 space-y-3">
          <TabBar<LogTab> tabs={[{ key: "km", label: "Odometer", icon: Gauge }, { key: "cost", label: "Cost", icon: Coins }]}
                          value={logTab} onChange={setLogTab} />
          {logTab === "km" ? (
            <form className="flex flex-wrap gap-2 items-center" onSubmit={(e) => { e.preventDefault(); addOdo.mutate(); }}>
              <input type="date" className={input} value={odoDate} onChange={(e) => setOdoDate(e.target.value)} />
              <input className={`${input} flex-1 basis-28`} inputMode="decimal" placeholder={s.odometer ? `> ${km(s.odometer)} km` : "km on the dial"}
                     value={odoKm} onChange={(e) => setOdoKm(e.target.value)} />
              <button className={save} disabled={!odoKm.trim() || addOdo.isPending}><Check size={13} />Save</button>
              {addOdo.error && <p className="w-full text-xs text-rose-400">{(addOdo.error as Error).message}</p>}
            </form>
          ) : (
            <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); addCost.mutate(); }}>
              <div className="flex flex-wrap gap-2">
                <input type="date" className={input} value={cDate} onChange={(e) => setCDate(e.target.value)} />
                <input className={`${input} flex-1 basis-36`} placeholder="Repsol, ITV, insurance…" value={cName} onChange={(e) => setCName(e.target.value)} />
                <input className={`${input} w-24`} inputMode="decimal" placeholder="€" value={cAmount} onChange={(e) => setCAmount(e.target.value)} />
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                {subsOffered.map((x) => <Pill key={x} on={cSub === x} onClick={() => setCSub(cSub === x ? "" : x)}>{x}</Pill>)}
                <input className={`${input} basis-28`} placeholder="Subcategory" value={cSub} onChange={(e) => setCSub(e.target.value)} />
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                <select className={input} value={cAccount || meta?.defaults.account || ""} onChange={(e) => setCAccount(e.target.value)}>
                  {(meta?.accounts ?? []).map((a) => <option key={a}>{a}</option>)}
                </select>
                <input className={`${input} flex-1 basis-28`} inputMode="decimal" placeholder="Odometer (optional)" value={cKm} onChange={(e) => setCKm(e.target.value)} />
                <button className={save} disabled={!cName.trim() || !(Number(cAmount.replace(",", ".")) > 0) || addCost.isPending}>
                  <Check size={13} />Save
                </button>
              </div>
              <p className="text-xs text-[#52525B]">Saved as a Transportation expense in Money, tied to {v.name}.</p>
              {addCost.error && <p className="text-xs text-rose-400">{(addCost.error as Error).message}</p>}
              {addCost.data?.odometer_error && <p className="text-xs text-rose-400">Cost saved; odometer not: {addCost.data.odometer_error}</p>}
            </form>
          )}
        </Panel>
      </Block>

      <RemindersBlock vehicle={v} accounts={meta?.accounts ?? []} defaultAccount={meta?.defaults.account} />

      <Block title="Kilometres a month"
             note={`Odometer km between two readings go to the days you used it (${s.days_used} so far), weighted by what the GPS saw that day; the line is the GPS alone.`}>
        <Panel className="p-3">
          <ResponsiveContainer width="100%" height={160}>
            <ComposedChart data={s.series} margin={{ top: 6, right: 4, left: -24, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
              <XAxis dataKey="month" tick={tick} tickFormatter={(m) => format(parseISO(`${m}-01`), "MMM")} axisLine={false} tickLine={false} />
              <YAxis tick={tick} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: "var(--viz-grid)" }} contentStyle={{ background: "#18181B", border: "1px solid #27272A", fontSize: 12 }}
                       formatter={(val, n) => [`${Math.round(Number(val))} km`, n === "km" ? "Odometer" : "GPS"]}
                       labelFormatter={(m) => format(parseISO(`${m}-01`), "MMMM yyyy")} />
              <Bar dataKey="km" fill="var(--viz-alt)" radius={[3, 3, 0, 0]} />
              <Line dataKey="gps_km" stroke="#F59E0B" strokeWidth={1.5} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </Panel>
      </Block>

      <Block title="Cost a month">
        <Panel className="p-3">
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={s.series} margin={{ top: 6, right: 4, left: -24, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
              <XAxis dataKey="month" tick={tick} tickFormatter={(m) => format(parseISO(`${m}-01`), "MMM")} axisLine={false} tickLine={false} />
              <YAxis tick={tick} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: "var(--viz-grid)" }} contentStyle={{ background: "#18181B", border: "1px solid #27272A", fontSize: 12 }}
                       formatter={(val) => [fmtAmount(Number(val)), "Cost"]} labelFormatter={(m) => format(parseISO(`${m}-01`), "MMMM yyyy")} />
              <Bar dataKey="cost" fill="var(--viz-i4)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </Block>

      {s.by_subcategory.length > 0 && (
        <Block title="Where the money goes" note="All time">
          <Panel className="divide-y divide-[#18181B]">
            {s.by_subcategory.map((b) => (
              <div key={b.subcategory} className="px-4 py-2.5 flex items-center gap-3">
                <p className="text-sm flex-1">{b.subcategory}</p>
                <span className="text-xs text-[#52525B]">{b.count}×</span>
                <span className="text-sm tabular-nums">{fmtAmount(b.amount)}</span>
              </div>
            ))}
          </Panel>
        </Block>
      )}

      <Block title={`Routes · ${s.gps.days} day${s.gps.days === 1 ? "" : "s"}`}
             note={v.day_tag ? `Days tagged ${v.day_tag === "motorcycle" ? "Scooter ride" : v.day_tag === "car_drive" ? "Car drive" : v.day_tag}, and drives you gave it under Vehicles → Who drove this?`
               : "Pick a day tag (edit), or give it drives under Vehicles → Who drove this?"}
             action={(
               <button onClick={() => recompute.mutate()} disabled={recompute.isPending} title="Read the GPS again"
                       className="text-[#71717A] hover:text-[#FAFAFA] disabled:opacity-50">
                 <RefreshCw size={13} className={recompute.isPending ? "animate-spin" : ""} />
               </button>
             )}>
        {routes.length > 0 && <div className="mb-3"><VehicleRoutesMap routes={routes} highlight={picked} /></div>}
        {days.length === 0 ? <Empty>No tagged days with GPS yet.</Empty> : (
          <Panel className="divide-y divide-[#18181B] max-h-96 overflow-y-auto">
            {days.map((d) => (
              <div key={d.date} onClick={() => setPicked(picked === d.date ? null : d.date)}
                   className={`px-4 py-2.5 flex items-center gap-3 cursor-pointer ${picked === d.date ? "bg-[#F59E0B]/10" : "hover:bg-[#18181B]"}`}>
                <Link href={`/day/${d.date}`} onClick={(e) => e.stopPropagation()}
                      className="text-xs text-[#71717A] hover:text-[#FAFAFA] w-20 shrink-0 tabular-nums">
                  {format(parseISO(d.date), "d MMM yy")}
                </Link>
                <p className="text-sm flex-1 min-w-0 truncate">
                  {d.picked && <span className="text-[#52525B]">picked · </span>}
                  {d.legs === 0 ? <span className="text-[#52525B]">no GPS that day</span>
                    : d.start_place && d.end_place && d.start_place !== d.end_place ? `${d.start_place} → ${d.end_place}` : d.start_place ?? "—"}
                </p>
                <span className="text-xs text-[#52525B] shrink-0">{d.minutes ? `${d.minutes} min` : ""}</span>
                <span className="text-sm tabular-nums shrink-0 w-16 text-right">{d.km ? `${d.km.toFixed(1)} km` : ""}</span>
              </div>
            ))}
          </Panel>
        )}
      </Block>

      <Block title="Costs">
        {costs.length === 0 ? <Empty>No costs yet — log one above, or pick its subcategories (edit).</Empty> : (
          <Panel className="divide-y divide-[#18181B]">
            {costs.slice(0, 40).map((c) => (
              <div key={c.id} className="px-4 py-2.5 flex items-center gap-3">
                <Link href={`/day/${c.date}`} className="text-xs text-[#71717A] hover:text-[#FAFAFA] w-20 shrink-0 tabular-nums">
                  {format(parseISO(c.date), "d MMM yy")}
                </Link>
                <p className="text-sm flex-1 min-w-0 truncate">{c.name}</p>
                <span className="text-xs text-[#52525B] shrink-0">{c.subcategory}</span>
                <span className="text-sm tabular-nums shrink-0">{fmtAmount(c.amount)}</span>
              </div>
            ))}
          </Panel>
        )}
      </Block>

      <Block title="Odometer readings">
        {odo.length === 0 ? <Empty>None yet.</Empty> : (
          <Panel className="divide-y divide-[#18181B]">
            {odo.map((r) => (
              <div key={r.id} className="px-4 py-2.5 flex items-center gap-3">
                <span className="text-xs text-[#71717A] w-20 shrink-0 tabular-nums">{format(parseISO(r.date), "d MMM yy")}</span>
                <p className="text-sm flex-1 tabular-nums">{km(r.km)} km</p>
                <span className="text-xs text-[#52525B] truncate">{r.note}</span>
                <button className="text-[#52525B] hover:text-rose-400" onClick={() => { if (confirm("Delete this reading?")) delOdo.mutate(r.id); }}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </Panel>
        )}
      </Block>
    </main>
  );
}
