import Link from "next/link";
import { moneyApi, fmtAmount, type Holding, type AllocationSlice, type Mover, type AccountBalance, type RealizedTrade } from "@/lib/money-api";
import { accountBadgeClass } from "@/components/money/account-colors";
import { AddHoldingDrawer } from "@/components/money/AddHoldingDrawer";
import { PortfolioHistoryChart } from "@/components/money/PortfolioHistoryChart";
import { RecurringPlansSection } from "@/components/money/RecurringPlansSection";
import { HoldingActions } from "@/components/money/HoldingActions";

export default async function PortfolioPage() {
  const [overview, holdings, history, plans, realized] = await Promise.all([
    moneyApi.portfolioOverview().catch(() => null),
    moneyApi.portfolioHoldings().catch(() => [] as Holding[]),
    moneyApi.portfolioHistory("1Y").catch(() => []),
    // include_inactive so paused plans stay visible (with a Resume button)
    moneyApi.listPlans(true).catch(() => []),
    moneyApi.realizedTrades().catch(() => [] as RealizedTrade[]),
  ]);

  const empty = !overview || overview.holdings_count === 0;
  const liquidNames = (overview?.liquid_accounts ?? []).map(a => a.name);

  return (
    <main className="max-w-3xl mx-auto px-4 pb-24 pt-8">
      <div className="mb-8 flex items-start justify-between gap-3">
        <div>
          <Link href="/money" className="text-xs text-[#71717A] hover:text-[#A1A1AA] transition-colors uppercase tracking-widest mb-2 inline-block">
            ← Finance
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">Portfolio</h1>
          <p className="text-xs text-[#52525B] mt-0.5">
            {overview ? `${overview.holdings_count} holdings · updated ${overview.as_of}` : "Investor dashboard"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/api/money/portfolio/export"
            download
            className="text-xs font-medium px-3 py-1.5 rounded-full bg-[#3B82F6]/10 text-[#3B82F6] hover:bg-[#3B82F6]/20 transition-colors"
          >
            ↓ CSV
          </a>
          <AddHoldingDrawer />
        </div>
      </div>

      {empty ? (
        <>
          <EmptyState liquid={overview?.liquid_accounts ?? []} />
          {plans.length > 0 && (
            <RecurringPlansSection plans={plans} holdings={holdings} liquidAccounts={liquidNames} />
          )}
        </>
      ) : (
        <>
          <NetWorthHeader ov={overview!} />
          <PortfolioHistoryChart data={history} />
          <AllocationSection ov={overview!} />
          <RecurringPlansSection plans={plans} holdings={holdings} liquidAccounts={liquidNames} />
          <MoversSection ov={overview!} />
          <HoldingsTable holdings={holdings} liquidAccounts={liquidNames} />
          <RealizedSection trades={realized} totalAllTime={overview!.realized_pnl_total_eur} totalYtd={overview!.realized_pnl_ytd_eur} />
          {overview!.liquid_accounts.length > 0 && (
            <LiquidStrip accounts={overview!.liquid_accounts} />
          )}
        </>
      )}
    </main>
  );
}

function EmptyState({ liquid }: { liquid: AccountBalance[] }) {
  return (
    <>
      <div className="border border-dashed border-[#27272A] rounded-2xl px-6 py-10 text-center">
        <p className="text-lg text-[#D4D4D8] mb-2">No holdings yet</p>
        <p className="text-sm text-[#71717A] max-w-sm mx-auto">
          Add your first investment position — a stock, ETF, or crypto. Prices refresh nightly from Yahoo Finance.
        </p>
        <p className="text-xs text-[#3F3F46] mt-4">Tap <span className="text-[#22C55E]">+ Add holding</span> above to start.</p>
      </div>

      {liquid.length > 0 && <LiquidStrip accounts={liquid} />}
    </>
  );
}

function NetWorthHeader({ ov }: { ov: NonNullable<Awaited<ReturnType<typeof moneyApi.portfolioOverview>>> }) {
  const dayPositive = ov.day_change_eur >= 0;
  const ytdPositive = ov.ytd_pnl_eur >= 0;
  const totalPositive = ov.total_pnl_eur >= 0;
  return (
    <div className="bg-[#0D0D0F] border border-[#27272A] rounded-2xl px-6 py-6 mb-4">
      <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Total worth</p>
      <p className="text-4xl font-bold text-[#FAFAFA] tabular-nums">{fmtAmount(ov.total_net_worth_eur)}</p>
      <div className="flex items-center gap-4 mt-2 text-xs text-[#71717A]">
        <span>
          Investments <span className="text-[#D4D4D8] tabular-nums">{fmtAmount(ov.total_value_eur)}</span>
        </span>
        <span>
          Cash <span className="text-[#D4D4D8] tabular-nums">{fmtAmount(ov.total_liquid_eur)}</span>
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-[#18181B]">
        <div>
          <p className="text-[10px] text-[#52525B] uppercase tracking-widest">Today</p>
          <p className={`text-sm font-semibold tabular-nums ${dayPositive ? "text-[#22C55E]" : "text-[#EF4444]"}`}>
            {dayPositive ? "+" : ""}{ov.day_change_eur.toFixed(2)}€
          </p>
          <p className={`text-xs tabular-nums ${dayPositive ? "text-[#22C55E]/70" : "text-[#EF4444]/70"}`}>
            {dayPositive ? "+" : ""}{ov.day_change_pct.toFixed(2)}%
          </p>
        </div>
        <div>
          <p className="text-[10px] text-[#52525B] uppercase tracking-widest">YTD</p>
          <p className={`text-sm font-semibold tabular-nums ${ytdPositive ? "text-[#22C55E]" : "text-[#EF4444]"}`}>
            {ytdPositive ? "+" : ""}{ov.ytd_pnl_eur.toFixed(2)}€
          </p>
          <p className={`text-xs tabular-nums ${ytdPositive ? "text-[#22C55E]/70" : "text-[#EF4444]/70"}`}>
            {ytdPositive ? "+" : ""}{ov.ytd_pnl_pct.toFixed(2)}%
          </p>
        </div>
        <div>
          <p className="text-[10px] text-[#52525B] uppercase tracking-widest">All-time</p>
          <p className={`text-sm font-semibold tabular-nums ${totalPositive ? "text-[#22C55E]" : "text-[#EF4444]"}`}>
            {totalPositive ? "+" : ""}{ov.total_pnl_eur.toFixed(2)}€
          </p>
          <p className={`text-xs tabular-nums ${totalPositive ? "text-[#22C55E]/70" : "text-[#EF4444]/70"}`}>
            {totalPositive ? "+" : ""}{ov.total_pnl_pct.toFixed(2)}%
          </p>
        </div>
      </div>
    </div>
  );
}

const CLASS_COLORS = [
  "#22C55E", "#3B82F6", "#F59E0B", "#8B5CF6", "#06B6D4", "#EC4899", "#EF4444",
];

function AllocationSection({ ov }: { ov: NonNullable<Awaited<ReturnType<typeof moneyApi.portfolioOverview>>> }) {
  return (
    <section className="mb-6">
      <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Allocation</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <AllocationCard title="Asset class" slices={ov.allocation_by_class} />
        <AllocationCard title="Account" slices={ov.allocation_by_account} />
        <AllocationCard title="Currency" slices={ov.allocation_by_currency} />
      </div>
    </section>
  );
}

function AllocationCard({ title, slices }: { title: string; slices: AllocationSlice[] }) {
  if (slices.length === 0) return null;
  return (
    <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4">
      <p className="text-[10px] text-[#52525B] uppercase tracking-widest mb-3">{title}</p>
      <div className="flex items-center gap-3 mb-3">
        <Donut slices={slices} />
        <ul className="flex-1 space-y-1.5 min-w-0">
          {slices.slice(0, 4).map((s, i) => (
            <li key={s.label} className="flex items-center gap-2 text-xs">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: CLASS_COLORS[i % CLASS_COLORS.length] }} />
              <span className="text-[#D4D4D8] truncate">{s.label}</span>
              <span className="text-[#71717A] tabular-nums ml-auto">{s.pct.toFixed(1)}%</span>
            </li>
          ))}
          {slices.length > 4 && (
            <li className="text-[10px] text-[#52525B]">+ {slices.length - 4} more</li>
          )}
        </ul>
      </div>
    </div>
  );
}

function Donut({ slices }: { slices: AllocationSlice[] }) {
  const size = 72;
  const r = 30;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#18181B" strokeWidth="10" />
      {slices.map((s, i) => {
        const len = (s.pct / 100) * c;
        const dash = `${len} ${c - len}`;
        const rot = (offset / c) * 360;
        offset += len;
        return (
          <circle
            key={s.label}
            cx={size / 2} cy={size / 2} r={r}
            fill="none"
            stroke={CLASS_COLORS[i % CLASS_COLORS.length]}
            strokeWidth="10"
            strokeDasharray={dash}
            transform={`rotate(${rot - 90} ${size / 2} ${size / 2})`}
          />
        );
      })}
    </svg>
  );
}

function MoversSection({ ov }: { ov: NonNullable<Awaited<ReturnType<typeof moneyApi.portfolioOverview>>> }) {
  if (ov.top_movers_up.length === 0 && ov.top_movers_down.length === 0) return null;
  return (
    <section className="mb-6">
      <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Today&apos;s movers</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <MoverList title="Winners" movers={ov.top_movers_up} positive />
        <MoverList title="Losers" movers={ov.top_movers_down} positive={false} />
      </div>
    </section>
  );
}

function MoverList({ title, movers, positive }: { title: string; movers: Mover[]; positive: boolean }) {
  const color = positive ? "text-[#22C55E]" : "text-[#EF4444]";
  return (
    <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl p-4">
      <p className="text-[10px] text-[#52525B] uppercase tracking-widest mb-2">{title}</p>
      {movers.length === 0 ? (
        <p className="text-xs text-[#3F3F46]">—</p>
      ) : (
        <ul className="space-y-1.5">
          {movers.map(m => (
            <li key={m.holding_id} className="flex items-center gap-2 text-xs">
              <Link href={`/money/portfolio/holding/${encodeURIComponent(m.holding_id)}`} className="text-[#D4D4D8] hover:text-[#FAFAFA] truncate flex-1">
                {m.ticker}
              </Link>
              <span className={`tabular-nums ${color}`}>
                {positive ? "+" : ""}{m.day_change_pct.toFixed(2)}%
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Market prices older than this many days get an "as of" warning — either the
// listing has no recent Yahoo data or the nightly sync is failing for it.
const STALE_DAYS = 3;

function staleLabel(h: Holding): string | null {
  if (h.pricing_mode === "manual") return null; // manual values age by design
  if (!h.price_as_of) return "no price";
  const ageDays = (Date.now() - new Date(h.price_as_of).getTime()) / 86_400_000;
  return ageDays > STALE_DAYS ? `as of ${h.price_as_of}` : null;
}

function HoldingsTable({ holdings, liquidAccounts }: { holdings: Holding[]; liquidAccounts: string[] }) {
  const sorted = [...holdings].sort((a, b) => (b.market_value_eur ?? 0) - (a.market_value_eur ?? 0));
  return (
    <section className="mb-6">
      <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Holdings</h2>
      <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl overflow-hidden">
        <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 px-4 py-2 text-[10px] text-[#52525B] uppercase tracking-widest border-b border-[#18181B]">
          <span>Name</span>
          <span className="text-right">Value</span>
          <span className="text-right">Today</span>
          <span className="text-right">P&amp;L</span>
          <span />
        </div>
        <div className="divide-y divide-[#18181B]">
          {sorted.map(h => {
            const dayPos = (h.day_change_pct ?? 0) >= 0;
            const pnlPos = (h.unrealized_pnl_pct ?? 0) >= 0;
            return (
              <div
                key={h.id}
                className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 px-4 py-3 items-center hover:bg-[#131316] transition-colors"
              >
                <Link href={`/money/portfolio/holding/${encodeURIComponent(h.id)}`} className="min-w-0">
                  <p className="text-sm text-[#FAFAFA] truncate">
                    {h.ticker}
                    {h.pricing_mode === "manual" && (
                      <span className="ml-1.5 text-[9px] text-[#71717A] uppercase tracking-widest border border-[#27272A] rounded px-1 py-0.5 align-middle">manual</span>
                    )}
                    {(() => {
                      const { bg, text } = accountBadgeClass(h.account);
                      return (
                        <span className={`ml-1.5 text-[9px] px-1.5 py-0.5 rounded-full align-middle ${bg} ${text}`}>
                          {h.account}
                        </span>
                      );
                    })()}
                  </p>
                  <p className="text-xs text-[#71717A] truncate">{h.name}</p>
                </Link>
                <span className="text-sm tabular-nums text-[#D4D4D8] text-right">
                  {h.market_value_eur !== null ? fmtAmount(h.market_value_eur) : "—"}
                  {staleLabel(h) && (
                    <span className="block text-[9px] text-[#F59E0B]/80 tabular-nums">{staleLabel(h)}</span>
                  )}
                </span>
                <span className={`text-xs tabular-nums text-right ${dayPos ? "text-[#22C55E]" : "text-[#EF4444]"}`}>
                  {h.day_change_pct !== null ? `${dayPos ? "+" : ""}${h.day_change_pct.toFixed(2)}%` : "—"}
                </span>
                <span className={`text-xs tabular-nums text-right ${pnlPos ? "text-[#22C55E]" : "text-[#EF4444]"}`}>
                  {h.unrealized_pnl_pct !== null ? `${pnlPos ? "+" : ""}${h.unrealized_pnl_pct.toFixed(1)}%` : "—"}
                </span>
                <HoldingActions holding={h} accounts={liquidAccounts} />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function RealizedSection({ trades, totalAllTime, totalYtd }: { trades: RealizedTrade[]; totalAllTime: number; totalYtd: number }) {
  if (trades.length === 0) return null;
  const totalPos = totalAllTime >= 0;
  return (
    <section className="mb-6">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-xs text-[#52525B] uppercase tracking-widest">Realized gains</h2>
        <span className="text-xs tabular-nums">
          <span className={totalPos ? "text-[#22C55E]" : "text-[#EF4444]"}>
            {totalPos ? "+" : ""}{fmtAmount(totalAllTime)}
          </span>
          <span className="text-[#52525B]"> all time · {totalYtd >= 0 ? "+" : ""}{fmtAmount(totalYtd)} YTD</span>
        </span>
      </div>
      <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl divide-y divide-[#18181B]">
        {trades.slice(0, 15).map(t => {
          const pos = (t.realized_pnl_eur ?? 0) >= 0;
          const pct = t.cost_basis_sold_eur ? (t.proceeds_eur / t.cost_basis_sold_eur - 1) * 100 : null;
          return (
            <div key={t.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-[#D4D4D8] truncate">
                  {t.ticker}
                  <span className="text-xs text-[#52525B]"> × {t.quantity.toLocaleString()}</span>
                </p>
                <p className="text-xs text-[#52525B] truncate">{t.date} · sold for {fmtAmount(t.proceeds_eur)}</p>
              </div>
              {t.realized_pnl_eur !== null ? (
                <div className="text-right shrink-0">
                  <p className={`text-sm tabular-nums ${pos ? "text-[#22C55E]" : "text-[#EF4444]"}`}>
                    {pos ? "+" : ""}{fmtAmount(t.realized_pnl_eur)}
                  </p>
                  {pct !== null && (
                    <p className={`text-xs tabular-nums ${pos ? "text-[#22C55E]/70" : "text-[#EF4444]/70"}`}>
                      {pos ? "+" : ""}{pct.toFixed(1)}%
                    </p>
                  )}
                </div>
              ) : (
                <span className="text-xs text-[#52525B]">cost unknown</span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function LiquidStrip({ accounts }: { accounts: AccountBalance[] }) {
  const total = accounts.reduce((s, a) => s + a.balance, 0);
  return (
    <section className="mt-6">
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-xs text-[#52525B] uppercase tracking-widest">Cash &amp; liquid</h2>
        <span className="text-xs text-[#71717A] tabular-nums">{fmtAmount(total)}</span>
      </div>
      <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl divide-y divide-[#18181B]">
        {accounts.map(a => (
          <Link
            key={a.name}
            href={`/money/account/${encodeURIComponent(a.name)}`}
            className="flex items-center gap-3 px-4 py-2.5 hover:bg-[#131316] transition-colors"
          >
            <span className="text-sm text-[#D4D4D8] flex-1 truncate">{a.name}</span>
            <span className="text-[10px] text-[#52525B] uppercase">{a.account_type}</span>
            <span className={`text-sm tabular-nums ${a.balance < 0 ? "text-[#EF4444]" : "text-[#FAFAFA]"}`}>
              {a.balance < 0 ? "-" : ""}{fmtAmount(Math.abs(a.balance))}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
