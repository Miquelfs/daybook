import Link from "next/link";
import { moneyApi, fmtAmount } from "@/lib/money-api";
import { MonthBudgetBar } from "@/components/money/MonthBudgetBar";
import { TransactionList } from "@/components/money/TransactionList";
import { MoneyFab } from "@/components/money/MoneyFab";
import { format, addMonths, subMonths } from "date-fns";

interface Props {
  searchParams: Promise<{ month?: string }>;
}

export default async function MoneyPage({ searchParams }: Props) {
  const { month: monthParam } = await searchParams;
  const today = new Date();
  const month = monthParam ?? format(today, "yyyy-MM");

  const summary = await moneyApi.monthSummary(month).catch(() => null);

  const [year, mon] = month.split("-");
  const monthDate = new Date(parseInt(year), parseInt(mon) - 1, 1);
  const monthLabel = format(monthDate, "MMMM yyyy");
  const prevMonth = format(subMonths(monthDate, 1), "yyyy-MM");
  const nextMonth = format(addMonths(monthDate, 1), "yyyy-MM");
  const isCurrentMonth = month === format(today, "yyyy-MM");

  const pctTime = summary
    ? Math.round((summary.days_elapsed / summary.days_in_month) * 100)
    : 0;
  const pctBudget = summary && summary.total_budget > 0
    ? Math.round((summary.total_spent / summary.total_budget) * 100)
    : 0;

  return (
    <main className="max-w-2xl mx-auto px-4 pb-28 pt-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <Link href="/" className="text-xs text-[#71717A] hover:text-[#A1A1AA] transition-colors uppercase tracking-widest">
            ← Today
          </Link>
          <Link href="/money/trends" className="text-xs text-[#F59E0B] hover:text-[#FCD34D] transition-colors uppercase tracking-widest">
            Trends →
          </Link>
        </div>

        {/* Month navigation */}
        <div className="flex items-center justify-between">
          <Link
            href={`/money?month=${prevMonth}`}
            className="text-[#52525B] hover:text-[#A1A1AA] transition-colors px-2 py-1"
          >
            ‹
          </Link>
          <div className="text-center">
            <h1 className="text-xl font-semibold tracking-tight">{monthLabel}</h1>
            {summary && (
              <p className="text-xs text-[#52525B] mt-0.5">
                Day {summary.days_elapsed} of {summary.days_in_month}
              </p>
            )}
          </div>
          <Link
            href={`/money?month=${nextMonth}`}
            className={`transition-colors px-2 py-1 ${
              isCurrentMonth
                ? "text-[#27272A] cursor-not-allowed pointer-events-none"
                : "text-[#52525B] hover:text-[#A1A1AA]"
            }`}
          >
            ›
          </Link>
        </div>
      </div>

      {!summary ? (
        <div className="border border-dashed border-[#27272A] rounded-lg px-4 py-8 text-center">
          <p className="text-sm text-[#52525B]">No finance data yet.</p>
          <p className="text-xs text-[#3F3F46] mt-1">
            Run{" "}
            <code className="bg-[#18181B] px-1 rounded">
              make sync-notion
            </code>{" "}
            to import your Notion history.
          </p>
        </div>
      ) : (
        <>
          {/* Overview cards */}
          <div className="grid grid-cols-3 gap-3 mb-6">
            <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3">
              <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Spent</p>
              <p className="text-xl font-semibold text-[#FAFAFA] tabular-nums">
                {fmtAmount(summary.total_spent)}
              </p>
            </div>
            <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3">
              <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Budget</p>
              <p className="text-xl font-semibold text-[#FAFAFA] tabular-nums">
                {fmtAmount(summary.total_budget)}
              </p>
            </div>
            <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3">
              <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Left</p>
              <p
                className={`text-xl font-semibold tabular-nums ${
                  summary.total_spent > summary.total_budget
                    ? "text-[#EF4444]"
                    : "text-[#22C55E]"
                }`}
              >
                {fmtAmount(summary.total_budget - summary.total_spent)}
              </p>
            </div>
          </div>

          {/* Velocity bar: time vs budget */}
          <div className="mb-8 bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-4">
            <div className="flex items-center justify-between text-xs text-[#52525B] mb-3">
              <span>Month progress</span>
              <span className={
                summary.velocity > 1.2 ? "text-[#EF4444]" :
                summary.velocity > 1.0 ? "text-[#F59E0B]" : "text-[#22C55E]"
              }>
                {summary.velocity > 1.2 ? "Over pace" :
                 summary.velocity > 1.0 ? "Slightly fast" : "On track"}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <div className="flex justify-between text-xs text-[#3F3F46] mb-1">
                  <span>Time</span>
                  <span>{pctTime}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-[#18181B]">
                  <div className="h-full rounded-full bg-[#3B82F6]" style={{ width: `${pctTime}%` }} />
                </div>
              </div>
              <div className="flex-1">
                <div className="flex justify-between text-xs text-[#3F3F46] mb-1">
                  <span>Budget</span>
                  <span>{pctBudget}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-[#18181B]">
                  <div
                    className={`h-full rounded-full ${
                      summary.velocity > 1.2 ? "bg-[#EF4444]" :
                      summary.velocity > 1.0 ? "bg-[#F59E0B]" : "bg-[#22C55E]"
                    }`}
                    style={{ width: `${Math.min(pctBudget, 100)}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Category budget bars */}
          <section className="mb-8">
            <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-4">By category</h2>
            <div className="flex flex-col gap-4">
              {summary.categories.map((cat) => (
                <MonthBudgetBar key={cat.category} item={cat} />
              ))}
            </div>
          </section>
        </>
      )}

      {/* Recent transactions */}
      <section>
        <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Recent transactions</h2>
        <TransactionList limit={50} showDate={true} />
      </section>

      {/* FAB */}
      <MoneyFab />
    </main>
  );
}
