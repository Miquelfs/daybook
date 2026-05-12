import Link from "next/link";
import { moneyApi, fmtAmount } from "@/lib/money-api";
import { TransactionList } from "@/components/money/TransactionList";
import { CATEGORY_EMOJI } from "@/components/money/CategoryPills";
import { format } from "date-fns";

interface Props {
  params: Promise<{ cat: string }>;
  searchParams: Promise<{ month?: string }>;
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { cat } = await params;
  const category = decodeURIComponent(cat);
  const { month: monthParam } = await searchParams;
  const today = new Date();
  const month = monthParam ?? format(today, "yyyy-MM");

  const summary = await moneyApi.monthSummary(month).catch(() => null);
  const catData = summary?.categories.find((c) => c.category === category) ?? null;

  const [year, mon] = month.split("-");
  const monthLabel = format(new Date(parseInt(year), parseInt(mon) - 1, 1), "MMMM yyyy");
  const start = `${month}-01`;
  const end = `${month}-${new Date(parseInt(year), parseInt(mon), 0).getDate().toString().padStart(2, "0")}`;

  const emoji = CATEGORY_EMOJI[category] ?? "💳";

  return (
    <main className="max-w-2xl mx-auto px-4 pb-20 pt-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <Link
            href={`/money?month=${month}`}
            className="text-xs text-[#71717A] hover:text-[#A1A1AA] transition-colors uppercase tracking-widest"
          >
            ← Finance
          </Link>
          <span className="text-xs text-[#52525B] uppercase tracking-widest">{monthLabel}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-3xl">{emoji}</span>
          <h1 className="text-2xl font-semibold tracking-tight">{category}</h1>
        </div>
      </div>

      {/* Budget summary */}
      {catData ? (
        <>
          <div className="grid grid-cols-3 gap-3 mb-6">
            <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3">
              <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Spent</p>
              <p className="text-xl font-semibold text-[#FAFAFA] tabular-nums">
                {fmtAmount(catData.spent)}
              </p>
            </div>
            <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3">
              <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Budget</p>
              <p className="text-xl font-semibold text-[#FAFAFA] tabular-nums">
                {catData.budget > 0 ? fmtAmount(catData.budget) : "—"}
              </p>
            </div>
            <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3">
              <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Left</p>
              <p
                className={`text-xl font-semibold tabular-nums ${
                  catData.remaining < 0 ? "text-[#EF4444]" : "text-[#FAFAFA]"
                }`}
              >
                {catData.budget > 0 ? fmtAmount(catData.remaining) : "—"}
              </p>
            </div>
          </div>

          {/* Progress bar */}
          {catData.budget > 0 && (
            <div className="mb-8">
              <div className="flex justify-between text-xs text-[#52525B] mb-1.5">
                <span>
                  {Math.round((catData.spent / catData.budget) * 100)}% used
                </span>
                <span
                  className={
                    catData.velocity > 1.2
                      ? "text-[#EF4444]"
                      : catData.velocity > 1.0
                      ? "text-[#F59E0B]"
                      : "text-[#22C55E]"
                  }
                >
                  {catData.velocity > 1.2
                    ? "Over pace"
                    : catData.velocity > 1.0
                    ? "Slightly fast"
                    : "On track"}
                </span>
              </div>
              <div className="h-2 rounded-full bg-[#18181B]">
                <div
                  className={`h-full rounded-full ${
                    catData.spent > catData.budget
                      ? "bg-[#EF4444]"
                      : catData.velocity > 1.0
                      ? "bg-[#F59E0B]"
                      : "bg-[#3B82F6]"
                  }`}
                  style={{
                    width: `${Math.min((catData.spent / catData.budget) * 100, 100)}%`,
                  }}
                />
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="border border-dashed border-[#27272A] rounded-lg px-4 py-6 text-center mb-8">
          <p className="text-sm text-[#52525B]">No spending in {category} this month</p>
        </div>
      )}

      {/* Transactions */}
      <section>
        <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-3">
          Transactions
        </h2>
        <TransactionList start={start} end={end} category={category} limit={100} showDate={true} />
      </section>
    </main>
  );
}
