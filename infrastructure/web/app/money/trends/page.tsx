import { moneyApi, fmtAmount } from "@/lib/money-api";
import { SyncNotionButton } from "@/components/money/SyncNotionButton";
import { CategoryTrendsChart } from "@/components/money/CategoryTrendsChart";
import { MonthlyChart } from "@/components/money/MonthlyChart";
import { ForecastCard } from "@/components/money/ForecastCard";
import { CategoryStatsTable } from "@/components/money/CategoryStatsTable";
import { SavingsChart } from "@/components/money/SavingsChart";
import { MonthlyAnomalies } from "@/components/money/MonthlyAnomalies";
import { SeasonalChart } from "@/components/money/SeasonalChart";
import { Section, StatTile } from "@/components/money/ui";

// Trends = over time: savings, income vs spending, categories, unusual months and
// seasons. Anything about the current month lives on Insights.
export default async function TrendsPage() {
  const [data, monthlyAnomalies, seasonal, meta] = await Promise.all([
    moneyApi.trends(24).catch(() => null),
    moneyApi.monthlyAnomalies(24).catch(() => null),
    moneyApi.seasonal().catch(() => null),
    moneyApi.meta().catch(() => null),
  ]);

  const header = (
    <div className="flex items-start justify-between gap-3 mb-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Trends</h1>
        <p className="text-xs text-[#52525B] mt-0.5">
          {data ? `Last ${data.months.length} months` : "Your money over time"}
        </p>
      </div>
      <div className="flex items-center gap-3 pt-1">
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
  );

  if (!data) {
    return (
      <main className="max-w-2xl mx-auto px-4 pb-12 pt-6">
        {header}
        <p className="text-sm text-[#52525B] text-center">Could not load trends data.</p>
      </main>
    );
  }

  const { months, savings_streak: streak } = data;
  const avgSavings = months.length ? months.reduce((s, m) => s + m.savings, 0) / months.length : 0;
  const goal = meta?.savings_goal ?? 0;

  return (
    <main className="max-w-2xl mx-auto px-4 pb-20 pt-6">
      {header}

      <Section
        title="Savings"
        hint={goal ? `A month counts as a win when you save at least ${fmtAmount(goal)}.` : undefined}
      >
        <div className="grid grid-cols-3 gap-3 mb-4">
          <StatTile
            label="Streak"
            value={`${streak.current_streak} mo`}
            sub={`best ${streak.best_streak} mo`}
            tone={streak.current_streak > 0 ? "good" : "plain"}
          />
          <StatTile label="Goal hit" value={`${Math.round(streak.success_rate * 100)}%`} sub="of months" />
          <StatTile
            label="Avg saved"
            value={`${avgSavings < 0 ? "−" : ""}${fmtAmount(avgSavings)}`}
            sub={`${Math.round(data.avg_savings_rate * 100)}% of income`}
            tone={avgSavings < 0 ? "bad" : goal && avgSavings < goal ? "warn" : "good"}
          />
        </div>
        <SavingsChart />
      </Section>

      <Section title="Income vs spending" hint="Month by month, with next month's forecast.">
        <div className="space-y-4">
          <MonthlyChart />
          <ForecastCard />
        </div>
      </Section>

      <Section title="Categories over time">
        <CategoryTrendsChart />
      </Section>

      {monthlyAnomalies && (
        <Section title="Unusual months" hint="Months that ran well above or below your normal.">
          <MonthlyAnomalies data={monthlyAnomalies} />
        </Section>
      )}

      {seasonal && (
        <Section title="Seasonal pattern" hint="Your average spend for each calendar month.">
          <SeasonalChart data={seasonal} />
        </Section>
      )}

      <Section title="Category totals" hint="All time." className="">
        <CategoryStatsTable />
      </Section>
    </main>
  );
}
