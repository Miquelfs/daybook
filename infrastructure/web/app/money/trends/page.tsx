import Link from "next/link";
import { moneyApi, fmtAmount } from "@/lib/money-api";
import { CategoryTrendsChart } from "@/components/money/CategoryTrendsChart";
import { MonthsExplorer } from "@/components/money/MonthsExplorer";
import { ForecastCard } from "@/components/money/ForecastCard";
import { CategoryStatsTable } from "@/components/money/CategoryStatsTable";
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
    <div className="flex items-center justify-between gap-3 mb-8">
      <p className="text-xs text-[#52525B]">
        {data ? `Your last ${data.months.length} months` : "Your money over time"}
      </p>
      <div className="flex items-center gap-3">
        <a
          href="/api/money/export"
          download="transactions.csv"
          className="text-xs text-[#52525B] hover:text-[#A1A1AA] uppercase tracking-widest transition-colors"
        >
          ↓ CSV
        </a>
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

  const { savings_streak: streak } = data;
  const goal = meta?.savings_goal ?? 0;

  return (
    <main className="max-w-2xl mx-auto px-4 pb-20 pt-6">
      {header}

      <Section
        title="Savings"
        hint={goal ? `A month counts as a win when you save at least ${fmtAmount(goal)}.` : undefined}
      >
        <div className="grid grid-cols-3 gap-3">
          <StatTile
            label="Streak"
            value={`${streak.current_streak} mo`}
            sub={`best ${streak.best_streak} mo`}
            tone={streak.current_streak > 0 ? "good" : "plain"}
          />
          <StatTile label="Goal hit" value={`${Math.round(streak.success_rate * 100)}%`} sub="of months" />
          <Link href="/money/budget" className="block">
            <StatTile label="Goal" value={fmtAmount(goal)} sub="per month · change" />
          </Link>
        </div>
      </Section>

      <Section title="Month by month" hint="Tap any month to see it in full.">
        <MonthsExplorer goal={goal} />
      </Section>

      <Section title="Next month" hint="Forecast from your roster pay and recent spending.">
        <ForecastCard />
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
