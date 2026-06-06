import Link from "next/link";
import { moneyApi, fmtAmount } from "@/lib/money-api";

export default async function PortfolioPage() {
  const portfolio = await moneyApi.portfolio().catch(() => null);

  const TYPE_LABEL: Record<string, string> = {
    Investment: "Invest",
    "Crypto Investment": "Crypto",
    Checking: "Cash",
    Savings: "Savings",
    Unknown: "—",
  };

  const TYPE_COLOR: Record<string, string> = {
    Investment: "text-[#22C55E] bg-[#22C55E]/10",
    "Crypto Investment": "text-[#F59E0B] bg-[#F59E0B]/10",
    Checking: "text-[#3B82F6] bg-[#3B82F6]/10",
    Savings: "text-[#06B6D4] bg-[#06B6D4]/10",
    Unknown: "text-[#52525B] bg-[#18181B]",
  };

  return (
    <main className="max-w-2xl mx-auto px-4 pb-20 pt-8">
      <div className="mb-8">
        <Link href="/money" className="text-xs text-[#71717A] hover:text-[#A1A1AA] transition-colors uppercase tracking-widest mb-2 inline-block">
          ← Finance
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Portfolio</h1>
        <p className="text-xs text-[#52525B] mt-0.5">Net worth from account balances</p>
      </div>

      {!portfolio || portfolio.accounts.length === 0 ? (
        <div className="border border-dashed border-[#27272A] rounded-lg px-4 py-8 text-center">
          <p className="text-sm text-[#52525B]">No account data.</p>
          <p className="text-xs text-[#3F3F46] mt-1">Add Account Setup transactions in Notion to track balances.</p>
        </div>
      ) : (
        <>
          {/* Net worth headline */}
          <div className="bg-[#0D0D0F] border border-[#27272A] rounded-2xl px-6 py-6 mb-6 text-center">
            <p className="text-xs text-[#52525B] uppercase tracking-widest mb-2">Net worth</p>
            <p className="text-4xl font-bold text-[#FAFAFA] tabular-nums">
              {fmtAmount(portfolio.total_net_worth)}
            </p>
          </div>

          {/* Split cards */}
          <div className="grid grid-cols-2 gap-3 mb-8">
            <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-4">
              <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Investments</p>
              <p className="text-xl font-semibold text-[#22C55E] tabular-nums">
                {fmtAmount(portfolio.total_investments)}
              </p>
              <p className="text-xs text-[#52525B] mt-1">{portfolio.investment_pct}% of total</p>
            </div>
            <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-4">
              <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Liquid</p>
              <p className="text-xl font-semibold text-[#3B82F6] tabular-nums">
                {fmtAmount(portfolio.total_liquid)}
              </p>
              <p className="text-xs text-[#52525B] mt-1">{portfolio.liquid_pct}% of total</p>
            </div>
          </div>

          {/* Allocation bar */}
          <div className="mb-8">
            <div className="h-3 rounded-full bg-[#18181B] overflow-hidden flex">
              <div
                className="h-full bg-[#22C55E] transition-all"
                style={{ width: `${portfolio.investment_pct}%` }}
              />
              <div
                className="h-full bg-[#3B82F6] transition-all"
                style={{ width: `${portfolio.liquid_pct}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-[#52525B] mt-1.5">
              <span className="text-[#22C55E]">Investments {portfolio.investment_pct}%</span>
              <span className="text-[#3B82F6]">Liquid {portfolio.liquid_pct}%</span>
            </div>
          </div>

          {/* Account list */}
          <section>
            <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-4">Accounts</h2>
            <div className="flex flex-col divide-y divide-[#18181B]">
              {portfolio.accounts.map((acc) => {
                const totalAbs = Math.abs(portfolio.total_net_worth) || 1;
                const pct = Math.round((Math.abs(acc.balance) / totalAbs) * 100);
                return (
                  <div key={acc.name} className="flex items-center gap-3 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[#D4D4D8] truncate">{acc.name}</p>
                      <div className="mt-1 h-1 rounded-full bg-[#18181B] w-24">
                        <div
                          className={`h-full rounded-full ${
                            acc.account_type === "Investment" || acc.account_type === "Crypto Investment"
                              ? "bg-[#22C55E]"
                              : "bg-[#3B82F6]"
                          }`}
                          style={{ width: `${Math.min(pct * 3, 100)}%` }}
                        />
                      </div>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${TYPE_COLOR[acc.account_type] ?? TYPE_COLOR.Unknown}`}>
                      {TYPE_LABEL[acc.account_type] ?? "—"}
                    </span>
                    <span className={`text-sm tabular-nums font-medium shrink-0 ${
                      acc.balance < 0 ? "text-[#EF4444]" : "text-[#FAFAFA]"
                    }`}>
                      {acc.balance < 0 ? "-" : ""}{fmtAmount(Math.abs(acc.balance))}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
