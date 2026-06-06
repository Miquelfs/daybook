import Link from "next/link";
import { moneyApi, fmtAmount } from "@/lib/money-api";
import { SyncNotionButton } from "@/components/money/SyncNotionButton";
import { CategoryTrendsChart } from "@/components/money/CategoryTrendsChart";
import { MonthlyChart } from "@/components/money/MonthlyChart";
import { ForecastCard } from "@/components/money/ForecastCard";
import { SpendingPatternsChart } from "@/components/money/SpendingPatternsChart";
import { CategoryStatsTable } from "@/components/money/CategoryStatsTable";
import { AnomalyReport } from "@/components/money/AnomalyReport";
import { SavingsChart } from "@/components/money/SavingsChart";

export default async function TrendsPage() {
  const data = await moneyApi.trends(24).catch(() => null);

  if (!data) {
    return (
      <main className="max-w-2xl mx-auto px-4 pb-12 pt-8">
        <Link href="/money" className="text-xs text-[#71717A] hover:text-[#A1A1AA] uppercase tracking-widest mb-2 inline-block">
          ← Finance
        </Link>
        <p className="text-sm text-[#52525B] mt-8 text-center">Could not load trends data.</p>
      </main>
    );
  }

  const { months, savings_streak: streak } = data;

  return (
    <main className="max-w-2xl mx-auto px-4 pb-20 pt-8">
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <Link href="/money" className="text-xs text-[#71717A] hover:text-[#A1A1AA] uppercase tracking-widest inline-block">
            ← Finance
          </Link>
          <div className="flex items-center gap-3">
            <a
              href="/api/money/export"
              download="transactions.csv"
              className="text-xs text-[#52525B] hover:text-[#A1A1AA] uppercase tracking-widest transition-colors"
            >
              ↓ CSV
            </a>
            <SyncNotionButton />
          </div>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Trends</h1>
        <p className="text-sm text-[#71717A] mt-0.5">Last {months.length} months</p>
      </div>

      {/* Anomaly detection — most actionable, shown first */}
      <section className="mb-8">
        <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-4">Anomalies this month</h2>
        <AnomalyReport />
      </section>

      {/* Savings streak */}
      <div className="grid grid-cols-3 gap-3 mb-8">
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3">
          <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Streak</p>
          <p className="text-xl font-semibold text-[#FAFAFA] tabular-nums">
            {streak.current_streak}<span className="text-sm text-[#71717A] ml-1">mo</span>
          </p>
          <p className="text-xs text-[#52525B] mt-0.5">Best: {streak.best_streak} mo</p>
        </div>
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3">
          <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">On budget</p>
          <p className="text-xl font-semibold text-[#FAFAFA] tabular-nums">
            {Math.round(streak.success_rate * 100)}%
          </p>
          <p className="text-xs text-[#52525B] mt-0.5">of months</p>
        </div>
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3">
          <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Total months</p>
          <p className="text-xl font-semibold text-[#FAFAFA] tabular-nums">{months.length}</p>
          <p className="text-xs text-[#52525B] mt-0.5">tracked</p>
        </div>
      </div>

      {/* Savings bar + savings rate + rolling averages */}
      <section className="mb-8">
        <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-4">Savings analysis</h2>
        <SavingsChart />
      </section>

      {/* Forecast next month */}
      <section className="mb-8">
        <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-4">Next month forecast</h2>
        <ForecastCard />
      </section>

      {/* Income vs expenses bar chart */}
      <section className="mb-8">
        <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-4">Income vs expenses</h2>
        <MonthlyChart />
      </section>

      {/* Spending patterns by day */}
      <section className="mb-8">
        <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-4">Spending patterns</h2>
        <SpendingPatternsChart />
      </section>

      {/* Category spending over time */}
      <section className="mb-8">
        <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-4">By category over time</h2>
        <CategoryTrendsChart />
      </section>

      {/* Category lifetime stats */}
      <section className="mb-8">
        <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-4">Category totals (all time)</h2>
        <CategoryStatsTable />
      </section>

      {/* On-budget history */}
      <section>
        <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Month history</h2>
        <div className="flex flex-col gap-0.5">
          {months.map((m) => {
            const label = new Date(m.month + "-15").toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
            return (
              <div key={m.month} className="flex items-center gap-3 py-2 border-b border-[#18181B]">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${m.on_budget ? "bg-[#22C55E]" : "bg-[#EF4444]"}`} />
                <span className="text-sm text-[#A1A1AA] flex-1">{label}</span>
                <span className="text-xs tabular-nums text-[#52525B]">{fmtAmount(m.total_spent)}</span>
                <span className={`text-xs tabular-nums w-16 text-right ${m.savings >= 0 ? "text-[#22C55E]" : "text-[#EF4444]"}`}>
                  {m.savings >= 0 ? "+" : "−"}{fmtAmount(Math.abs(m.savings))}
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
