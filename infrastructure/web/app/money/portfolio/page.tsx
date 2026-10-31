import Link from "next/link";
import { format, parseISO } from "date-fns";
import { moneyApi, fmtAmount, type Holding, type AllocationSlice, type Mover, type AccountBalance, type RealizedTrade } from "@/lib/money-api";
import { AddHoldingDrawer } from "@/components/money/AddHoldingDrawer";
import { AccountsManager } from "@/components/money/AccountsManager";
import { PortfolioHistoryChart } from "@/components/money/PortfolioHistoryChart";
import { RecurringPlansSection } from "@/components/money/RecurringPlansSection";
import { HoldingsTable } from "@/components/money/HoldingsTable";
import { accountBadgeClass } from "@/components/money/account-colors";

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
    <main className="max-w-2xl mx-auto px-4 pb-24 pt-6">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs text-[#52525B]">
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
          <AccountsManager />
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
          {/* Worth and how it's growing first; then what makes it up; then activity. */}
          <NetWorthHeader ov={overview!} />
          <PortfolioHistoryChart data={history} />
          <InvestedSection ov={overview!} />
          <MoversStrip ov={overview!} />
          <HoldingsTable holdings={holdings} liquidAccounts={liquidNames} />
          {overview!.liquid_accounts.length > 0 && (
            <LiquidStrip accounts={overview!.liquid_accounts} />
          )}
          <AllocationSection ov={overview!} />
          <RecurringPlansSection plans={plans} holdings={holdings} liquidAccounts={liquidNames} />
          <RealizedSection trades={realized} totalAllTime={overview!.realized_pnl_total_eur} totalYtd={overview!.realized_pnl_ytd_eur} />
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
  return (
    <div className="bg-[#0D0D0F] border border-[#27272A] rounded-2xl px-6 py-6 mb-4">
      <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Total worth</p>
      <p className="text-4xl font-semibold tracking-tight text-[#FAFAFA] tabular-nums">{fmtAmount(ov.total_net_worth_eur)}</p>
      <div className="flex items-center gap-4 mt-2 text-xs text-[#71717A]">
        <span>
          Investments <span className="text-[#D4D4D8] tabular-nums">{fmtAmount(ov.total_value_eur)}</span>
        </span>
        <span>
          Cash <span className="text-[#D4D4D8] tabular-nums">{fmtAmount(ov.total_liquid_eur)}</span>
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-[#18181B]">
        <PnlCell label="Today" eur={ov.day_change_eur} pct={ov.day_change_pct} />
        <PnlCell
          label={ov.ytd_since && ov.ytd_since.slice(5) !== "01-01" ? `Since ${format(parseISO(ov.ytd_since), "d MMM")}` : "This year"}
          eur={ov.ytd_pnl_eur}
          pct={ov.ytd_pnl_pct}
        />
        <PnlCell label="All time" eur={ov.total_pnl_eur} pct={ov.total_pnl_pct} />
      </div>
    </div>
  );
}

// What you put in vs what it grew into. Growth excludes new money: buying more
// raises "put in", not "growth" (domains/money/invested.py).
function InvestedSection({ ov }: { ov: NonNullable<Awaited<ReturnType<typeof moneyApi.portfolioOverview>>> }) {
  const putIn = ov.invested_eur;
  if (!putIn) return null;
  const growth = ov.total_value_eur - putIn;
  const totalGain = growth + (ov.realized_pnl_total_eur ?? 0);
  const grownShare = ov.total_value_eur > 0 ? Math.max(0, Math.min(1, putIn / ov.total_value_eur)) : 1;
  return (
    <section className="mb-6">
      <h2 className="text-xs text-[#71717A] uppercase tracking-widest mb-3">Money in vs growth</h2>
      <div className="bg-[#0D0D0F] border border-[#27272A] rounded-2xl px-5 py-4">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <p className="text-[10px] text-[#52525B] uppercase tracking-widest">You put in</p>
            <p className="text-lg font-semibold tabular-nums text-[#FAFAFA]">{fmtAmount(putIn)}</p>
          </div>
          <div>
            <p className="text-[10px] text-[#52525B] uppercase tracking-widest">It&apos;s worth</p>
            <p className="text-lg font-semibold tabular-nums text-[#FAFAFA]">{fmtAmount(ov.total_value_eur)}</p>
          </div>
          <div>
            <p className="text-[10px] text-[#52525B] uppercase tracking-widest">Growth</p>
            <p className={`text-lg font-semibold tabular-nums ${growth >= 0 ? "text-[#22C55E]" : "text-[#EF4444]"}`}>{signed(growth)}</p>
            <p className="text-xs text-[#52525B] tabular-nums">{growth >= 0 ? "+" : "−"}{Math.abs((growth / putIn) * 100).toFixed(1)}%</p>
          </div>
        </div>
        {/* One bar: the part you put in, and the part the market added on top */}
        <div className="flex h-2 rounded-full overflow-hidden mt-4 bg-[#18181B]" aria-hidden>
          <span className="bg-[#71717A]" style={{ width: `${grownShare * 100}%` }} />
          {growth > 0 && <span className="bg-[#22C55E] ml-[2px]" style={{ width: `${(1 - grownShare) * 100}%` }} />}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs text-[#71717A]">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[#71717A]" />Put in</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[#22C55E]" />Growth</span>
          {ov.contributed_ytd_eur !== 0 && (
            <span className="tabular-nums">
              Added {ov.ytd_since && ov.ytd_since.slice(5) !== "01-01" ? `since ${format(parseISO(ov.ytd_since), "d MMM")}` : "this year"}: {signed(ov.contributed_ytd_eur)}
            </span>
          )}
          {ov.realized_pnl_total_eur ? (
            <span className="tabular-nums">Sold for a gain: {signed(ov.realized_pnl_total_eur)} · total gain {signed(totalGain)}</span>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function signed(eur: number): string {
  return `${eur >= 0 ? "+" : "−"}${fmtAmount(eur)}`;
}

function PnlCell({ label, eur, pct }: { label: string; eur: number; pct: number }) {
  const color = eur >= 0 ? "text-[#22C55E]" : "text-[#EF4444]";
  return (
    <div>
      <p className="text-[10px] text-[#52525B] uppercase tracking-widest">{label}</p>
      <p className={`text-sm font-semibold tabular-nums ${color}`}>{signed(eur)}</p>
      <p className={`text-xs tabular-nums ${color} opacity-70`}>{pct >= 0 ? "+" : "−"}{Math.abs(pct).toFixed(2)}%</p>
    </div>
  );
}

// Validated for colour-blind separation on both themes; no red/green, which mean gain/loss here.
const CLASS_COLORS = ["#3B82F6", "#D97706", "#8B5CF6", "#0891B2", "#EC4899"];

function AllocationSection({ ov }: { ov: NonNullable<Awaited<ReturnType<typeof moneyApi.portfolioOverview>>> }) {
  return (
    <section className="mb-6">
      <h2 className="text-xs text-[#71717A] uppercase tracking-widest mb-3">Allocation</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <AllocationCard title="Asset class" slices={ov.allocation_by_class} />
        <AllocationCard title="Account" slices={ov.allocation_by_account} />
        <AllocationCard title="Currency" slices={ov.allocation_by_currency} />
      </div>
    </section>
  );
}

const OTHER_COLOR = "#52525B";

// Up to 5 named slices, the rest folded into a gray "Other", so a colour never
// stands for two things and the legend lists every slice the donut draws.
function foldSlices(slices: AllocationSlice[]): (AllocationSlice & { color: string })[] {
  const head = slices.slice(0, 5).map((s, i) => ({ ...s, color: CLASS_COLORS[i] }));
  const tail = slices.slice(5);
  if (tail.length === 0) return head;
  const other = tail.reduce((acc, s) => ({ ...acc, value_eur: acc.value_eur + s.value_eur, pct: acc.pct + s.pct }), {
    ...tail[0], label: `Other (${tail.length})`, value_eur: 0, pct: 0,
  });
  return [...head, { ...other, color: OTHER_COLOR }];
}

function AllocationCard({ title, slices: raw }: { title: string; slices: AllocationSlice[] }) {
  if (raw.length === 0) return null;
  const slices = foldSlices(raw);
  return (
    <div className="bg-[#0D0D0F] border border-[#27272A] rounded-2xl p-4">
      <p className="text-[10px] text-[#52525B] uppercase tracking-widest mb-3">{title}</p>
      <div className="flex items-center gap-3 mb-3">
        <Donut slices={slices} />
        <ul className="flex-1 space-y-1.5 min-w-0">
          {slices.map((s) => (
            <li key={s.label} className="flex items-center gap-2 text-xs" title={`${s.label}: ${fmtAmount(s.value_eur)}`}>
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
              <span className="text-[#D4D4D8] truncate">{s.label}</span>
              <span className="text-[#71717A] tabular-nums ml-auto">{s.pct.toFixed(1)}%</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Donut({ slices }: { slices: (AllocationSlice & { color: string })[] }) {
  const size = 72;
  const r = 30;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#18181B" strokeWidth="10" />
      {slices.map((s) => {
        const len = (s.pct / 100) * c;
        const dash = `${len} ${c - len}`;
        const rot = (offset / c) * 360;
        offset += len;
        return (
          <circle
            key={s.label}
            cx={size / 2} cy={size / 2} r={r}
            fill="none"
            stroke={s.color}
            strokeWidth="10"
            strokeDasharray={dash}
            transform={`rotate(${rot - 90} ${size / 2} ${size / 2})`}
          />
        );
      })}
    </svg>
  );
}

// Daily moves are noise for long-term holdings — one quiet line, not a section.
function MoversStrip({ ov }: { ov: NonNullable<Awaited<ReturnType<typeof moneyApi.portfolioOverview>>> }) {
  const movers: (Mover & { up: boolean })[] = [
    ...ov.top_movers_up.slice(0, 3).map((m) => ({ ...m, up: true })),
    ...ov.top_movers_down.slice(0, 3).map((m) => ({ ...m, up: false })),
  ];
  if (movers.length === 0) return null;
  return (
    <div className="flex items-center gap-2 mb-6 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <span className="text-[10px] text-[#52525B] uppercase tracking-widest shrink-0">Today</span>
      {movers.map((m) => (
        <Link
          key={m.holding_id}
          href={`/money/portfolio/holding/${encodeURIComponent(m.holding_id)}`}
          className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-[#27272A] text-xs hover:border-[#3F3F46]"
        >
          <span className="text-[#D4D4D8] max-w-[120px] truncate">{m.name}</span>
          <span className={`tabular-nums ${m.up ? "text-[#22C55E]" : "text-[#EF4444]"}`}>
            {m.day_change_pct >= 0 ? "+" : "−"}{Math.abs(m.day_change_pct).toFixed(1)}%
          </span>
        </Link>
      ))}
    </div>
  );
}

function RealizedSection({ trades, totalAllTime, totalYtd }: { trades: RealizedTrade[]; totalAllTime: number; totalYtd: number }) {
  if (trades.length === 0) return null;
  const totalPos = totalAllTime >= 0;
  return (
    <section className="mb-6">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-xs text-[#71717A] uppercase tracking-widest">Realized gains</h2>
        <span className="text-xs tabular-nums">
          <span className={totalPos ? "text-[#22C55E]" : "text-[#EF4444]"}>
            {totalPos ? "+" : ""}{fmtAmount(totalAllTime)}
          </span>
          <span className="text-[#52525B]"> all time · {totalYtd >= 0 ? "+" : ""}{fmtAmount(totalYtd)} YTD</span>
        </span>
      </div>
      <div className="bg-[#0D0D0F] border border-[#27272A] rounded-2xl divide-y divide-[#18181B]">
        {trades.slice(0, 15).map(t => {
          const pos = (t.realized_pnl_eur ?? 0) >= 0;
          const pct = t.cost_basis_sold_eur ? (t.proceeds_eur / t.cost_basis_sold_eur - 1) * 100 : null;
          return (
            <div key={t.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-[#D4D4D8] truncate">
                  {t.name}
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
        <h2 className="text-xs text-[#71717A] uppercase tracking-widest">Cash &amp; liquid</h2>
        <span className="text-xs text-[#71717A] tabular-nums">{fmtAmount(total)}</span>
      </div>
      <div className="bg-[#0D0D0F] border border-[#27272A] rounded-2xl divide-y divide-[#18181B]">
        {accounts.map(a => (
          <Link
            key={a.name}
            href={`/money/account/${encodeURIComponent(a.name)}`}
            className="flex items-center gap-3 px-4 py-2.5 hover:bg-[#131316] transition-colors"
          >
            <span className="flex-1 min-w-0">
              <span className={`text-xs px-2 py-0.5 rounded-full truncate inline-block max-w-full ${accountBadgeClass(a.name).bg} ${accountBadgeClass(a.name).text}`}>
                {a.name}
              </span>
            </span>
            <span className="text-[10px] text-[#52525B] uppercase">{a.account_type === "Unknown" ? "" : a.account_type}</span>
            <span className={`text-sm tabular-nums ${a.balance < 0 ? "text-[#EF4444]" : "text-[#FAFAFA]"}`}>
              {a.balance < 0 ? "-" : ""}{fmtAmount(Math.abs(a.balance))}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
