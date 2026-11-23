"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Car, Bike, Plus } from "lucide-react";
import { fmtAmount } from "@/lib/money-api";
import { vehiclesApi, KIND_LABEL, type InboxLeg, type VehicleOverview } from "@/lib/statements-api";
import { ActionButton, Block, Empty, Panel, Skeleton, Stat, Stats } from "@/components/ui/kit";
import { VehicleForm } from "@/components/vehicles/VehicleForm";
import { AreaPlan } from "@/components/plan/AreaPlan";

const km = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("en-GB"));
const time = (iso: string) => format(parseISO(iso), "HH:mm");

function dueLine(o: VehicleOverview) {
  const r = o.next_reminder;
  if (!r || !r.date) return null;
  const days = r.days_left ?? 0;
  const when = days < 0 ? `${-days}d overdue` : days === 0 ? "today" : days <= 60 ? `in ${days}d` : format(parseISO(r.date), "MMM yyyy");
  const kmPart = r.by === "km" && r.km_left != null ? ` · ${km(Math.max(0, r.km_left))} km to go` : "";
  return <p className={`text-xs mt-3 ${days < 0 ? "text-rose-400" : "text-[#71717A]"}`}>Next: {r.title} {when}{kmPart}</p>;
}

// A drive the GPS saw that no tag settles — no Scooter ride / Car drive tag that day, or both.
function InboxRow({ leg, vehicles, onDone }: { leg: InboxLeg; vehicles: VehicleOverview[]; onDone: () => void }) {
  const pick = useMutation({
    mutationFn: (vid: number) => vehiclesApi.pickLeg(leg.date, leg.start, vid),
    onSuccess: onDone,
  });
  const place = leg.start_place && leg.end_place && leg.start_place !== leg.end_place
    ? `${leg.start_place} → ${leg.end_place}` : leg.start_place ?? "—";
  return (
    <div className="px-4 py-2.5">
      <div className="flex items-center gap-3">
        <Link href={`/day/${leg.date}`} className="text-xs text-[#71717A] hover:text-[#FAFAFA] w-24 shrink-0 tabular-nums">
          {format(parseISO(leg.date), "EEE d MMM")} {time(leg.start)}
        </Link>
        <p className="text-sm flex-1 min-w-0 truncate">{place}</p>
        <span className="text-sm tabular-nums shrink-0">{leg.km.toFixed(1)} km</span>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2 pl-[6.75rem]">
        {vehicles.map(({ vehicle: v }) => (
          <button key={v.id} disabled={pick.isPending} onClick={() => pick.mutate(v.id)}
                  className="text-xs px-2.5 py-1 rounded-full border border-[#27272A] text-[#A1A1AA] hover:border-[#F59E0B] hover:text-[#F59E0B] disabled:opacity-50">
            {v.name}
          </button>
        ))}
        <button disabled={pick.isPending} onClick={() => pick.mutate(0)}
                className="text-xs px-2.5 py-1 rounded-full border border-[#27272A] text-[#52525B] hover:text-[#A1A1AA] disabled:opacity-50">
          Not mine
        </button>
      </div>
    </div>
  );
}

export default function VehiclesPage() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ["vehicles"], queryFn: () => vehiclesApi.list() });
  const { data: inbox = [] } = useQuery({ queryKey: ["vehicles", "inbox"], queryFn: () => vehiclesApi.inbox() });
  const create = useMutation({
    mutationFn: vehiclesApi.create,
    onSuccess: () => { setAdding(false); qc.invalidateQueries({ queryKey: ["vehicles"] }); },
  });
  const active = (data ?? []).filter((o) => !o.vehicle.sold_on);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["vehicles"] }); qc.invalidateQueries({ queryKey: ["area-plan", "vehicles"] }); };

  return (
    <main className="max-w-2xl mx-auto px-4 pb-24 space-y-8">
      <Block title="Your vehicles" note="Kilometres from the odometer, costs from your Transportation expenses, routes from the GPS."
             action={!adding && <ActionButton icon={Plus} onClick={() => setAdding(true)}>Add</ActionButton>}>
        {adding && (
          <Panel className="p-4 mb-3">
            <VehicleForm onSave={(v) => create.mutate(v)} saving={create.isPending}
                         error={create.error ? (create.error as Error).message : null} />
          </Panel>
        )}
        {isLoading ? <Skeleton h={120} /> : !data?.length ? (
          !adding && <Empty>No vehicles yet — add the car and the scooter.</Empty>
        ) : (
          <div className="space-y-3">
            {data.map((o) => {
              const v = o.vehicle;
              const Icon = v.kind === "car" ? Car : Bike;
              return (
                <Link key={v.id} href={`/money/vehicles/${v.id}`} className="block hover:opacity-90 transition-opacity">
                  <Panel className="p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Icon size={15} className="text-[#71717A]" />
                      <p className="text-sm font-medium flex-1 truncate">{v.name}</p>
                      <span className="text-xs text-[#52525B]">
                        {[v.make_model, v.plate].filter(Boolean).join(" · ") || KIND_LABEL[v.kind]}
                        {v.sold_on && " · sold"}
                      </span>
                    </div>
                    <Stats cols={4}>
                      <Stat label="Odometer" value={km(o.odometer)} unit="km"
                            sub={o.reading_age_days != null ? `${o.reading_age_days}d ago` : "no reading"} />
                      <Stat label="Km · 12 mo" value={km(o.km_period || o.gps.km_period)}
                            sub={`${o.days_used_period} day${o.days_used_period === 1 ? "" : "s"} used`} />
                      <Stat label="Cost · 12 mo" value={fmtAmount(o.cost_period)} sub={`${fmtAmount(o.per_month)}/mo`} />
                      <Stat label="€ / km" value={o.per_km_period != null ? `€${o.per_km_period.toFixed(2)}` : "—"} />
                    </Stats>
                    {dueLine(o)}
                  </Panel>
                </Link>
              );
            })}
          </div>
        )}
      </Block>

      {inbox.length > 0 && active.length > 0 && (
        <Block title={`Who drove this? · ${inbox.length}`}
               note="Drives the GPS saw on days with no Scooter ride / Car drive tag (last 30 days), or with both. Picking a vehicle on an untagged day tags the day too.">
          <Panel className="divide-y divide-[#18181B]">
            {inbox.map((l) => <InboxRow key={`${l.date}-${l.start}`} leg={l} vehicles={active} onDone={refresh} />)}
          </Panel>
        </Block>
      )}

      <AreaPlan area="vehicles" />
    </main>
  );
}
