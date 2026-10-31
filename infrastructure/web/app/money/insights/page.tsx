import Link from "next/link";
import { format } from "date-fns";
import { moneyApi, fmtAmount, type MonthOverview } from "@/lib/money-api";
import { VelocityGauge } from "@/components/money/VelocityGauge";
import { WaterfallChart } from "@/components/money/WaterfallChart";
import { EfficiencyTable } from "@/components/money/EfficiencyTable";
import { MonthHeatGrid } from "@/components/money/MonthHeatGrid";
import { SpendingPatternsChart } from "@/components/money/SpendingPatternsChart";
import { AnomalyReport } from "@/components/money/AnomalyReport";
import { AINarrative } from "@/components/AINarrative";
import { MonthSwitcher, Section, StatTile } from "@/components/money/ui";

interface Props {
  searchParams: Promise<{ month?: string }>;
}

// Insights = this month, explained: where you'll land, what needs attention,
// where the money went and when. Long-term views live on Trends.
export default async function InsightsPage({ searchParams }: Props) {
  const { month: monthParam } = await searchParams;
  const month = monthParam ?? format(new Date(), "yyyy-MM");

  const [year, mon] = month.split("-").map((v) => parseInt(v));
  const monthStart = `${month}-01`;
  const monthEnd = format(new Date(year, mon, 0), "yyyy-MM-dd");
  const monthLabel = format(new Date(year, mon - 1, 1), "MMMM yyyy");

  const [overview, waterfall, efficiency, dailyTotals, meta] = await Promise.all([
    moneyApi.monthOverview(month).catch(() => null),
    moneyApi.waterfall(month).catch(() => null),
    moneyApi.efficiency(12).catch(() => null),
    moneyApi.dailyTotals(monthStart, monthEnd).catch(() => null),
    moneyApi.meta().catch(() => null),
  ]);
  const goal = meta?.savings_goal ?? 0;

  return (
    <main className="max-w-2xl mx-auto px-4 pb-20 pt-6">
      <MonthSwitcher
        basePath="/money/insights"
        month={month}
        subtitle={overview ? `Day ${overview.days_elapsed} of ${overview.days_in_month}` : undefined}
      />

      {!overview ? (
        <div className="border border-dashed border-[#27272A] rounded-xl px-4 py-8 text-center">
          <p className="text-sm text-[#52525B]">No data for this month.</p>
        </div>
      ) : (
        <>
          <Landing ov={overview} goal={goal} />

          <Section title="Needs attention" hint="Categories ahead of their budget pace, and spending that's out of the ordinary.">
            <Alerts ov={overview} month={month} />
            <div className="mt-3">
              <AnomalyReport month={month} />
            </div>
          </Section>
        </>
      )}

      {waterfall && waterfall.categories.length > 0 && (
        <Section title="Where the money went" hint="Income, minus each category, down to what's left.">
          <WaterfallChart data={waterfall} />
        </Section>
      )}

      <Section title="When you spent" hint={`Day by day and by weekday, ${monthLabel}.`}>
        {dailyTotals && dailyTotals.length > 0 && (
          <div className="mb-6">
            <MonthHeatGrid days={dailyTotals} month={monthLabel} />
          </div>
        )}
        <SpendingPatternsChart month={month} />
      </Section>

      {efficiency && (
        <Section title="Recoverable savings" hint="Where the last 12 months ran above a typical month.">
          <EfficiencyTable data={efficiency} />
        </Section>
      )}

      <AINarrative
        topic="money"
        days={7}
        label="AI read on this week"
        blurb="A plain-English read on this week's spending: what's on track, what to watch, and one practical action."
        cta="Analyse my spending"
      />
    </main>
  );
}

// One projection everywhere: income the month will end with (the salary from the
// roster estimate if it hasn't landed yet) minus spending with fixed bills spread
// over the month, so rent on the 1st doesn't read as overspending.
function Landing({ ov, goal }: { ov: MonthOverview; goal: number }) {
  const savings = ov.projected_savings_adjusted;
  const tone = savings < 0 ? "bad" : goal && savings < goal ? "warn" : "good";
  const verdict =
    savings < 0 ? "Heading for a negative month"
    : goal && savings < goal ? `${fmtAmount(goal - savings)} short of your ${fmtAmount(goal)} goal`
    : goal ? `On track for your ${fmtAmount(goal)} goal` : "Projected savings";
  const incomeNote =
    ov.income_source === "roster"
      ? ov.salary_received ? "salary in" : `incl. ${fmtAmount(ov.expected_salary ?? 0)} salary · roster`
      : ov.income_source === "average" ? "3-month average" : "received";
  return (
    <Section title="Where you'll land">
      <div className="bg-[#0D0D0F] border border-[#27272A] rounded-2xl px-5 py-5 mb-3">
        <p className="text-[11px] text-[#52525B] uppercase tracking-widest mb-1">Projected savings</p>
        <p className={`text-4xl font-semibold tabular-nums ${
          tone === "bad" ? "text-[#EF4444]" : tone === "warn" ? "text-[#F59E0B]" : "text-[#22C55E]"
        }`}>
          {savings < 0 ? "−" : "+"}{fmtAmount(savings)}
        </p>
        <p className="text-sm text-[#A1A1AA] mt-1">
          {verdict}{" "}
          <Link href="/money/budget" className="text-xs text-[#71717A] hover:text-[#A1A1AA] underline underline-offset-2">
            {goal ? "change goal" : "set a goal"}
          </Link>
        </p>
        <div className="mt-4 pt-4 border-t border-[#18181B]">
          <VelocityGauge overview={ov} bare />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <StatTile label="Income" value={fmtAmount(ov.projected_income)} sub={incomeNote} tone="good" />
        <StatTile
          label="Spending"
          value={fmtAmount(ov.projected_month_end_adjusted)}
          sub={`${fmtAmount(ov.total_spent)} so far`}
          tone={ov.projected_month_end_adjusted > ov.total_budget ? "bad" : "plain"}
        />
        <StatTile label="Budget" value={fmtAmount(ov.total_budget)} sub={`${fmtAmount(ov.daily_burn_rate)}/day so far`} />
      </div>
    </Section>
  );
}

function Alerts({ ov, month }: { ov: MonthOverview; month: string }) {
  if (ov.alerts.length === 0) {
    return (
      <div className="bg-[#0D0D0F] border border-[#22C55E]/30 rounded-xl px-4 py-3">
        <p className="text-sm text-[#22C55E]">✓ Every category is within its budget pace</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {ov.alerts.map((a) => {
        const over = a.status === "Over Budget";
        return (
          <Link
            key={a.category}
            href={`/money/category/${encodeURIComponent(a.category)}?month=${month}`}
            className="flex items-center justify-between bg-[#0D0D0F] border border-[#27272A] rounded-2xl px-4 py-3 hover:border-[#3F3F46] transition-colors"
          >
            <div>
              <p className={`text-sm font-medium ${over ? "text-[#EF4444]" : "text-[#F59E0B]"}`}>
                {over ? "Over budget" : "Over pace"} · {a.category}
              </p>
              <p className="text-xs text-[#52525B] mt-0.5">
                {fmtAmount(a.spent)} spent · {a.velocity.toFixed(1)}× the pace its budget allows
              </p>
            </div>
            <span className="text-xs text-[#3F3F46]">→</span>
          </Link>
        );
      })}
    </div>
  );
}
