"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Car, Bike, Plus } from "lucide-react";
import { fmtAmount } from "@/lib/money-api";
import { vehiclesApi, KIND_LABEL } from "@/lib/statements-api";
import { ActionButton, Block, Empty, Panel, Skeleton, Stat, Stats } from "@/components/ui/kit";
import { VehicleForm } from "@/components/vehicles/VehicleForm";

const km = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("en-GB"));

export default function VehiclesPage() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ["vehicles"], queryFn: () => vehiclesApi.list() });
  const create = useMutation({
    mutationFn: vehiclesApi.create,
    onSuccess: () => { setAdding(false); qc.invalidateQueries({ queryKey: ["vehicles"] }); },
  });

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
                            sub={o.km_period ? "odometer" : o.gps.km_period ? "GPS" : undefined} />
                      <Stat label="Cost · 12 mo" value={fmtAmount(o.cost_period)} sub={`${fmtAmount(o.per_month)}/mo`} />
                      <Stat label="€ / km" value={o.per_km_period != null ? `€${o.per_km_period.toFixed(2)}` : "—"} />
                    </Stats>
                  </Panel>
                </Link>
              );
            })}
          </div>
        )}
      </Block>
    </main>
  );
}
