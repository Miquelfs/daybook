import Link from "next/link";
import { moneyApi, fmtAmount } from "@/lib/money-api";
import { MonthBudgetBar } from "@/components/money/MonthBudgetBar";
import { CATEGORY_EMOJI } from "@/components/money/CategoryPills";
import { format } from "date-fns";

interface Props {
  searchParams: Promise<{ month?: string }>;
}

export default async function MoneyPage({ searchParams }: Props) {
  const { month: monthParam } = await searchParams;
  const today = new Date();
  const month = monthParam ?? format(today, "yyyy-MM");

  const [summary, recent] = await Promise.all([
    moneyApi.monthSummary(month).catch(() => null),
    moneyApi.transactions({ limit: 30 }).catch(() => []),
  ]);

  const [year, mon] = month.split("-");
  const monthLabel = format(new Date(parseInt(year), parseInt(mon) - 1, 1), "MMMM yyyy");
  const pctTime = summary
    ? Math.round((summary.days_elapsed / summary.days_in_month) * 100)
    : 0;

  return (
    <main className="max-w-2xl mx-auto px-4 pb-20 pt-8">
      {/* Header */}
      <div className="mb-8">
        <Link
          href="/"
          className="text-xs text-[#71717A] hover:text-[#A1A1AA] transition-colors uppercase tracking-widest mb-2 inline-block"
        >
          ← Today
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{monthLabel}</h1>
        {summary && (
          <p className="text-sm text-[#71717A] mt-0.5">
            Day {summary.days_elapsed} of {summary.days_in_month} ({pctTime}% through the month)
          </p>
        )}
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
          <div className="grid grid-cols-3 gap-3 mb-8">
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
              <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Remaining</p>
              <p
                className={`text-xl font-semibold tabular-nums ${
                  summary.total_spent > summary.total_budget
                    ? "text-[#EF4444]"
                    : "text-[#FAFAFA]"
                }`}
              >
                {fmtAmount(summary.total_budget - summary.total_spent)}
              </p>
            </div>
          </div>

          {/* Velocity indicator */}
          <div className="flex items-center gap-3 mb-6">
            <div className="flex-1 h-2 rounded-full bg-[#18181B]">
              <div
                className="h-full rounded-full bg-[#3B82F6]"
                style={{ width: `${pctTime}%` }}
              />
            </div>
            <span className="text-xs text-[#52525B] tabular-nums shrink-0">
              {pctTime}% time
            </span>
            <div className="flex-1 h-2 rounded-full bg-[#18181B]">
              <div
                className={`h-full rounded-full ${
                  summary.velocity > 1.2 ? "bg-[#EF4444]" :
                  summary.velocity > 1.0 ? "bg-[#F59E0B]" : "bg-[#22C55E]"
                }`}
                style={{
                  width: `${Math.min(
                    Math.round((summary.total_spent / summary.total_budget) * 100),
                    100
                  )}%`,
                }}
              />
            </div>
            <span className="text-xs text-[#52525B] tabular-nums shrink-0">
              {Math.round((summary.total_spent / summary.total_budget) * 100)}% budget
            </span>
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
      {recent.length > 0 && (
        <section>
          <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Recent</h2>
          <div className="flex flex-col gap-0.5">
            {recent.map((t) => {
              const emoji = CATEGORY_EMOJI[t.category ?? ""] ?? "💳";
              const isExp = t.transaction_type === "Expense";
              return (
                <div key={t.id} className="flex items-center gap-3 py-2">
                  <span className="text-base w-6 text-center shrink-0">{emoji}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[#D4D4D8] truncate">{t.name}</p>
                    <p className="text-xs text-[#52525B]">{t.date}</p>
                  </div>
                  <span
                    className={`text-sm tabular-nums shrink-0 ${
                      isExp ? "text-[#A1A1AA]" : "text-[#22C55E]"
                    }`}
                  >
                    {isExp ? "-" : "+"}
                    {fmtAmount(t.amount)}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}
