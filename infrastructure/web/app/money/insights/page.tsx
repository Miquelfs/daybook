import Link from "next/link";
import { format } from "date-fns";
import { moneyApi, fmtAmount } from "@/lib/money-api";
import { VelocityGauge } from "@/components/money/VelocityGauge";
import { WaterfallChart } from "@/components/money/WaterfallChart";
import { SeasonalChart } from "@/components/money/SeasonalChart";
import { EfficiencyTable } from "@/components/money/EfficiencyTable";
import { MonthlyAnomalies } from "@/components/money/MonthlyAnomalies";
import { MonthHeatGrid } from "@/components/money/MonthHeatGrid";
import { MonthlyChart } from "@/components/money/MonthlyChart";
import { ForecastCard } from "@/components/money/ForecastCard";
import { AINarrative } from "@/components/AINarrative";

interface Props {
  searchParams: Promise<{ month?: string }>;
}

export default async function InsightsPage({ searchParams }: Props) {
  const { month: monthParam } = await searchParams;
  const today = new Date();
  const month = monthParam ?? format(today, "yyyy-MM");

  const [year, mon] = month.split("-").map((v) => parseInt(v));
  const monthStart = `${month}-01`;
  const monthEnd = format(new Date(year, mon, 0), "yyyy-MM-dd");
  const monthLabel = format(new Date(year, mon - 1, 1), "MMMM yyyy");

  const [overview, waterfall, efficiency, monthlyAnomalies, seasonal, trends, dailyTotals] =
    await Promise.all([
      moneyApi.monthOverview(month).catch(() => null),
      moneyApi.waterfall(month).catch(() => null),
      moneyApi.efficiency(12).catch(() => null),
      moneyApi.monthlyAnomalies(24).catch(() => null),
      moneyApi.seasonal().catch(() => null),
      moneyApi.trends(12).catch(() => null),
      moneyApi.dailyTotals(monthStart, monthEnd).catch(() => null),
    ]);

  const streak = trends?.savings_streak;
  const last12 = trends?.months.slice(-12) ?? [];

  return (
    <main className="max-w-2xl mx-auto px-4 pb-20 pt-8">
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <Link href="/money" className="text-xs text-[#71717A] hover:text-[#A1A1AA] transition-colors uppercase tracking-widest">
            ← Finance
          </Link>
          <Link href={`/money/overview?month=${month}`} className="text-xs text-[#F59E0B] hover:text-[#FCD34D] transition-colors uppercase tracking-widest">
            Overview →
          </Link>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Insights</h1>
        <p className="text-xs text-[#52525B] mt-0.5">{monthLabel}</p>
      </div>

      <div className="mb-8">
        <AINarrative
          topic="money"
          days={7}
          label="AI Recommendations"
          blurb="Get a plain-English read on this week's spending — what's on track, what to watch, and one practical action."
          cta="Analyse my spending"
        />
      </div>

      {/* 1 · This month at a glance */}
      {overview && (
        <section className="mb-8">
          <VelocityGauge overview={overview} />
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3">
              <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Proj. month end</p>
              <p className="text-lg font-semibold text-[#FAFAFA] tabular-nums">
                {fmtAmount(overview.projected_month_end_adjusted)}
              </p>
              <p className="text-[10px] text-[#3F3F46]">fixed bills amortised</p>
            </div>
            <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3">
              <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Proj. savings</p>
              <p className={`text-lg font-semibold tabular-nums ${
                overview.projected_savings_adjusted < 0 ? "text-[#EF4444]" :
                overview.projected_savings_adjusted < 1300 ? "text-[#F59E0B]" : "text-[#22C55E]"
              }`}>
                {overview.projected_savings_adjusted < 0 ? "−" : ""}{fmtAmount(Math.abs(overview.projected_savings_adjusted))}
              </p>
              <p className="text-[10px] text-[#3F3F46]">goal: €1,300</p>
            </div>
          </div>
        </section>
      )}

      {/* 2 · Savings streak */}
      {streak && (
        <section className="mb-8">
          <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Savings streak</p>
              <p className="text-3xl font-semibold text-[#FAFAFA] tabular-nums">
                {streak.current_streak}
                <span className="text-sm text-[#52525B] font-normal ml-1.5">
                  mo · best {streak.best_streak}
                </span>
              </p>
            </div>
            <div className="flex gap-1" title="last 12 months: green = savings goal hit">
              {last12.map((m) => (
                <span
                  key={m.month}
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: m.on_budget ? "#22C55E" : "#3F3F46" }}
                  title={`${m.month}: ${m.on_budget ? "goal hit" : "missed"} (${fmtAmount(m.savings)})`}
                />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* 3 · Cash-flow waterfall */}
      {waterfall && waterfall.categories.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Where the money went</h2>
          <WaterfallChart data={waterfall} />
        </section>
      )}

      {/* 4 · Month-level anomalies */}
      {monthlyAnomalies && (
        <section className="mb-8">
          <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Unusual months</h2>
          <MonthlyAnomalies data={monthlyAnomalies} />
        </section>
      )}

      {/* 5 · Seasonal pattern */}
      {seasonal && (
        <section className="mb-8">
          <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Seasonal pattern</h2>
          <SeasonalChart data={seasonal} />
        </section>
      )}

      {/* 6 · Behavioural pattern (this month) */}
      {dailyTotals && dailyTotals.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Daily rhythm</h2>
          <MonthHeatGrid days={dailyTotals} month={monthLabel} />
        </section>
      )}

      {/* 7 · Efficiency & recoverable savings */}
      {efficiency && (
        <section className="mb-8">
          <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Recoverable savings</h2>
          <EfficiencyTable data={efficiency} />
        </section>
      )}

      {/* 8 · History & forecast */}
      <section className="mb-8">
        <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-3">History & forecast</h2>
        <div className="space-y-4">
          <MonthlyChart />
          <ForecastCard />
        </div>
      </section>
    </main>
  );
}
