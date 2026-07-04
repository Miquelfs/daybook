import Link from "next/link";
import { moneyApi, fmtAmount } from "@/lib/money-api";
import { SpendingPatternsChart } from "@/components/money/SpendingPatternsChart";
import { BudgetVarianceChart } from "@/components/money/BudgetVarianceChart";
import { format } from "date-fns";

interface Props {
  searchParams: Promise<{ month?: string }>;
}

export default async function OverviewPage({ searchParams }: Props) {
  const { month: monthParam } = await searchParams;
  const today = new Date();
  const month = monthParam ?? format(today, "yyyy-MM");

  const overview = await moneyApi.monthOverview(month).catch(() => null);

  const [year, mon] = month.split("-");
  const monthLabel = format(new Date(parseInt(year), parseInt(mon) - 1, 1), "MMMM yyyy");

  return (
    <main className="max-w-2xl mx-auto px-4 pb-20 pt-8">
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <Link href="/money" className="text-xs text-[#71717A] hover:text-[#A1A1AA] transition-colors uppercase tracking-widest">
            ← Finance
          </Link>
          <Link href="/money/insights" className="text-xs text-[#F59E0B] hover:text-[#FCD34D] transition-colors uppercase tracking-widest">
            Insights →
          </Link>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{monthLabel}</h1>
        {overview && (
          <p className="text-xs text-[#52525B] mt-0.5">
            Day {overview.days_elapsed} of {overview.days_in_month}
          </p>
        )}
      </div>

      {!overview ? (
        <div className="border border-dashed border-[#27272A] rounded-lg px-4 py-8 text-center">
          <p className="text-sm text-[#52525B]">No data for this month.</p>
        </div>
      ) : (
        <>
          {/* Key numbers */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-4">
              <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Daily burn</p>
              <p className="text-2xl font-semibold text-[#FAFAFA] tabular-nums">
                {fmtAmount(overview.daily_burn_rate)}
              </p>
              <p className="text-xs text-[#52525B] mt-1">per day so far</p>
            </div>
            <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-4">
              <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Projected</p>
              <p className={`text-2xl font-semibold tabular-nums ${
                overview.projected_month_end > overview.total_budget ? "text-[#EF4444]" : "text-[#FAFAFA]"
              }`}>
                {fmtAmount(overview.projected_month_end)}
              </p>
              <p className="text-xs text-[#52525B] mt-1">by month end</p>
            </div>
            <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-4">
              <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Spent</p>
              <p className="text-2xl font-semibold text-[#FAFAFA] tabular-nums">
                {fmtAmount(overview.total_spent)}
              </p>
              <p className="text-xs text-[#52525B] mt-1">of {fmtAmount(overview.total_budget)} budget</p>
            </div>
            <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-4">
              <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Proj. savings</p>
              <p className={`text-2xl font-semibold tabular-nums ${
                overview.projected_savings < 0 ? "text-[#EF4444]" :
                overview.projected_savings < 1300 ? "text-[#F59E0B]" : "text-[#22C55E]"
              }`}>
                {overview.projected_savings >= 0 ? "" : "−"}{fmtAmount(Math.abs(overview.projected_savings))}
              </p>
              <p className="text-xs text-[#52525B] mt-1">goal: €1,300</p>
            </div>
          </div>

          {/* Alerts */}
          {overview.alerts.length > 0 && (
            <section className="mb-8">
              <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Alerts</h2>
              <div className="flex flex-col gap-2">
                {overview.alerts.map((alert) => (
                  <Link
                    key={alert.category}
                    href={`/money/category/${encodeURIComponent(alert.category)}?month=${month}`}
                    className="flex items-center justify-between bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3 hover:border-[#3F3F46] transition-colors"
                  >
                    <div>
                      <p className={`text-sm font-medium ${
                        alert.status === "Over Budget" ? "text-[#EF4444]" : "text-[#F59E0B]"
                      }`}>
                        {alert.status === "Over Budget" ? "🔴" : "🟡"} {alert.category}
                      </p>
                      <p className="text-xs text-[#52525B] mt-0.5">
                        {fmtAmount(alert.spent)} spent · {alert.velocity.toFixed(2)}× pace
                      </p>
                    </div>
                    <span className="text-xs text-[#3F3F46]">→</span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {overview.alerts.length === 0 && (
            <div className="mb-8 bg-[#0D0D0F] border border-[#22C55E]/30 rounded-xl px-4 py-3">
              <p className="text-sm text-[#22C55E]">✓ All categories on track</p>
            </div>
          )}

          {/* Budget variance */}
          <section className="mb-8">
            <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-4">Budget usage</h2>
            <BudgetVarianceChart month={month} />
          </section>

          {/* Spending patterns */}
          <section className="mb-8">
            <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-4">Spending patterns this month</h2>
            <SpendingPatternsChart />
          </section>

          {/* Category breakdown */}
          <section>
            <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-4">By category</h2>
            <div className="flex flex-col gap-3">
              {overview.categories.map((cat) => {
                const pct = cat.budget > 0 ? Math.min((cat.spent / cat.budget) * 100, 100) : 0;
                const color = cat.status === "Over Budget" ? "bg-[#EF4444]" :
                              cat.status === "Over Pace" ? "bg-[#F59E0B]" : "bg-[#3B82F6]";
                return (
                  <Link
                    key={cat.category}
                    href={`/money/category/${encodeURIComponent(cat.category)}?month=${month}`}
                    className="flex flex-col gap-1 group"
                  >
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-[#D4D4D8] group-hover:text-[#FAFAFA] transition-colors">{cat.category}</span>
                      <div className="flex items-center gap-2 tabular-nums text-xs">
                        <span className={cat.status === "Over Budget" ? "text-[#EF4444]" : "text-[#A1A1AA]"}>
                          {fmtAmount(cat.spent)}
                        </span>
                        {cat.budget > 0 && (
                          <span className="text-[#3F3F46]">/ {fmtAmount(cat.budget)}</span>
                        )}
                      </div>
                    </div>
                    {cat.budget > 0 && (
                      <div className="h-1.5 rounded-full bg-[#18181B]">
                        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(pct, 2)}%` }} />
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
