import Link from "next/link";
import { moneyApi, fmtAmount } from "@/lib/money-api";
import { SyncNotionButton } from "@/components/money/SyncNotionButton";

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

  const { months, savings_streak: streak, avg_monthly_spent, avg_monthly_income, avg_savings_rate } = data;
  const maxSpent = Math.max(...months.map((m) => m.total_spent), 1);

  return (
    <main className="max-w-2xl mx-auto px-4 pb-12 pt-8">
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <Link href="/money" className="text-xs text-[#71717A] hover:text-[#A1A1AA] uppercase tracking-widest inline-block">
            ← Finance
          </Link>
          <SyncNotionButton />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Trends</h1>
        <p className="text-sm text-[#71717A] mt-0.5">Last {months.length} months</p>
      </div>

      {/* Streak + averages */}
      <div className="grid grid-cols-3 gap-3 mb-8">
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3">
          <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Streak</p>
          <p className="text-xl font-semibold text-[#FAFAFA] tabular-nums">
            {streak.current_streak}
            <span className="text-sm text-[#71717A] ml-1">mo</span>
          </p>
          <p className="text-xs text-[#52525B] mt-0.5">Best: {streak.best_streak} mo</p>
        </div>
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3">
          <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Avg spent</p>
          <p className="text-xl font-semibold text-[#FAFAFA] tabular-nums">{fmtAmount(avg_monthly_spent)}</p>
          <p className="text-xs text-[#52525B] mt-0.5">/month</p>
        </div>
        <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3">
          <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Avg save</p>
          <p className={`text-xl font-semibold tabular-nums ${avg_savings_rate >= 0 ? "text-[#22C55E]" : "text-[#EF4444]"}`}>
            {Math.round(avg_savings_rate * 100)}%
          </p>
          <p className="text-xs text-[#52525B] mt-0.5">of income</p>
        </div>
      </div>

      {/* Month bars */}
      <section className="mb-8">
        <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-4">Month by month</h2>
        <div className="flex flex-col gap-3">
          {[...months].reverse().map((m) => {
            const pct = Math.round((m.total_spent / maxSpent) * 100);
            const savingsPct = m.total_income > 0
              ? Math.round(m.savings_rate * 100)
              : 0;
            const label = new Date(m.month + "-15").toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
            return (
              <div key={m.month} className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${m.on_budget ? "bg-[#22C55E]" : "bg-[#EF4444]"}`}
                    />
                    <span className="text-[#A1A1AA] w-10">{label}</span>
                  </div>
                  <div className="flex items-center gap-3 text-[#52525B] tabular-nums">
                    <span>{fmtAmount(m.total_spent)}</span>
                    <span className={savingsPct >= 0 ? "text-[#22C55E]" : "text-[#EF4444]"}>
                      {savingsPct >= 0 ? "+" : ""}{savingsPct}%
                    </span>
                  </div>
                </div>
                <div className="h-1.5 rounded-full bg-[#18181B]">
                  <div
                    className={`h-full rounded-full ${m.on_budget ? "bg-[#3B82F6]" : "bg-[#EF4444]"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* On-budget table */}
      <section>
        <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-3">
          On-budget {Math.round(streak.success_rate * 100)}% of months
        </h2>
        <div className="flex flex-col gap-0.5">
          {[...months].reverse().map((m) => {
            const label = new Date(m.month + "-15").toLocaleDateString("en-GB", { month: "long", year: "numeric" });
            return (
              <div key={m.month} className="flex items-center gap-3 py-2 border-b border-[#18181B]">
                <span className={`text-sm w-1.5 h-1.5 rounded-full shrink-0 ${m.on_budget ? "bg-[#22C55E]" : "bg-[#EF4444]"}`} />
                <span className="text-sm text-[#A1A1AA] flex-1">{label}</span>
                <span className="text-xs tabular-nums text-[#52525B]">{fmtAmount(m.total_spent)}</span>
                <span className={`text-xs tabular-nums w-14 text-right ${m.savings >= 0 ? "text-[#22C55E]" : "text-[#EF4444]"}`}>
                  {m.savings >= 0 ? "+" : ""}{fmtAmount(Math.abs(m.savings))}
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
