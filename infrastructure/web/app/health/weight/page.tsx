"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { HealthTabs } from "@/components/health/HealthTabs";
import { WeightSection } from "@/components/health/WeightSection";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type WeightEffect = {
  kg: number; height_m: number | null; bmi: number | null; bmi25_kg: number | null; goal_kg: number | null;
  vo2_at_goal?: number; fitness_age_at_goal?: number;
};
type FitnessAgeNow = { precise: number; vo2max: number; weight: WeightEffect | null };

/** How weight moves fitness age: barely through BMI, mostly because VO₂max is per kilogram. */
function WeightAndFitnessAge() {
  const { data } = useQuery<{ now: FitnessAgeNow | null }>({
    queryKey: ["fitness-age"],
    queryFn: () => fetch(`${BASE}/health/fitness-age`).then((r) => r.json()),
    staleTime: 600_000,
  });
  const n = data?.now;
  const w = n?.weight;
  if (!n || !w) return null;
  const gain = w.fitness_age_at_goal != null ? Math.round((n.precise - w.fitness_age_at_goal) * 10) / 10 : null;
  return (
    <section className="mb-8">
      <p className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Weight &amp; fitness age</p>
      <div className="bg-[#0D0D0F] border border-[#27272A] rounded-2xl p-5 space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div>
            <p className="text-[10px] text-[#52525B] uppercase tracking-widest">BMI</p>
            <p className="text-lg font-semibold tabular-nums">{w.bmi ?? "—"}</p>
            <p className="text-xs text-[#71717A]">
              {w.bmi25_kg ? (w.kg < w.bmi25_kg ? `no penalty below ${w.bmi25_kg} kg` : `adds years above ${w.bmi25_kg} kg`) : ""}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-[#52525B] uppercase tracking-widest">VO₂max now</p>
            <p className="text-lg font-semibold tabular-nums">{n.vo2max}</p>
            <p className="text-xs text-[#71717A]">ml/kg/min at {w.kg} kg</p>
          </div>
          {w.vo2_at_goal != null && (
            <div>
              <p className="text-[10px] text-[#52525B] uppercase tracking-widest">At {w.goal_kg} kg</p>
              <p className="text-lg font-semibold tabular-nums text-[#4ADE80]">{w.vo2_at_goal}</p>
              <p className="text-xs text-[#71717A]">
                fitness age {n.precise} → {w.fitness_age_at_goal}{gain ? ` (−${gain} y)` : ""}
              </p>
            </div>
          )}
        </div>
        <p className="text-xs text-[#71717A] leading-relaxed">
          Weight counts twice. Lightly through BMI — only above 25, and it misreads muscle. Mostly through VO₂max, which is
          measured per kilogram: the same engine carrying less body reads higher, and VO₂max sets the base of your fitness
          age. Garmin computes it with your profile weight, so update it in Garmin Connect when the trend moves.
        </p>
      </div>
    </section>
  );
}

export default function WeightPage() {
  return (
    <main className="max-w-2xl mx-auto px-4 pb-20">
      <div className="pt-8 pb-6">
        <Link href="/health" className="text-xs text-[#71717A] hover:text-[#A1A1AA] uppercase tracking-widest inline-block mb-2">
          ← Health
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Weight</h1>
        <p className="text-sm text-[#71717A] mt-1">Weigh-ins, trend, the goal line and what it does for fitness age</p>
        <HealthTabs active="/health/weight" />
      </div>

      <WeightSection />
      <WeightAndFitnessAge />
    </main>
  );
}
