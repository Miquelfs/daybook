import Link from "next/link";
import { notFound } from "next/navigation";
import { moneyApi, fmtAmount } from "@/lib/money-api";
import { HoldingHistoryChart } from "@/components/money/HoldingHistoryChart";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function HoldingDetailPage({ params }: Props) {
  const { id } = await params;
  const [holdings, history] = await Promise.all([
    moneyApi.portfolioHoldings({ include_inactive: true }).catch(() => []),
    moneyApi.holdingHistory(id, "1Y").catch(() => []),
  ]);
  const h = holdings.find(x => x.id === id);
  if (!h) notFound();

  const dayPos = (h.day_change_pct ?? 0) >= 0;
  const pnlPos = (h.unrealized_pnl_pct ?? 0) >= 0;

  return (
    <main className="max-w-2xl mx-auto px-4 pb-24 pt-8">
      <Link href="/money/portfolio" className="text-xs text-[#71717A] hover:text-[#A1A1AA] uppercase tracking-widest mb-2 inline-block">
        ← Portfolio
      </Link>

      <div className="mb-6">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="text-2xl font-semibold tracking-tight">{h.name}</h1>
          <span className="text-xs text-[#71717A]">{h.currency}</span>
          {!h.is_active && <span className="text-[10px] uppercase tracking-widest text-[#EF4444] bg-[#EF4444]/10 px-2 py-0.5 rounded-full">Closed</span>}
        </div>
        <p className="text-xs text-[#52525B] mt-1">
          {h.account} · {h.asset_class.replace("_", " ")} · {h.quantity} units
        </p>
        {/* ISIN is the stable identifier — the ticker carries exchange
            suffixes (VWCE.DE, FEP3.MU) that mean nothing at a glance.
            Fall back to the ticker only when there's no ISIN to show. */}
        <p className="text-[10px] font-mono text-[#52525B] mt-1 uppercase tracking-widest">
          {h.isin ? `ISIN ${h.isin}` : `Ticker ${h.ticker}`}
        </p>
      </div>

      <div className="bg-[#0D0D0F] border border-[#27272A] rounded-2xl px-6 py-6 mb-4">
        <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">Market value</p>
        <p className="text-3xl font-bold text-[#FAFAFA] tabular-nums">
          {h.market_value_eur !== null ? fmtAmount(h.market_value_eur) : "No price yet"}
        </p>
        {h.current_price_eur !== null && (
          <p className="text-xs text-[#71717A] mt-1 tabular-nums">
            €{h.current_price_eur.toFixed(4)} × {h.quantity}
            {h.price_as_of && <span className="ml-2 text-[#52525B]">as of {h.price_as_of}</span>}
          </p>
        )}
        <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-[#18181B]">
          <KPI label="Today" value={h.day_change_pct !== null ? `${dayPos ? "+" : ""}${h.day_change_pct.toFixed(2)}%` : "—"} positive={dayPos} />
          <KPI label="YTD" value={h.ytd_change_pct !== null ? `${(h.ytd_change_pct >= 0 ? "+" : "")}${h.ytd_change_pct.toFixed(2)}%` : "—"} positive={(h.ytd_change_pct ?? 0) >= 0} />
          <KPI label="Unrealized P&L" value={h.unrealized_pnl_pct !== null ? `${pnlPos ? "+" : ""}${h.unrealized_pnl_pct.toFixed(2)}%` : "—"} positive={pnlPos} />
        </div>
      </div>

      <HoldingHistoryChart id={id} initial={history} />

      {h.cost_basis_eur !== null && (
        <section className="mb-6 bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3 grid grid-cols-2 gap-3">
          <div>
            <p className="text-[10px] text-[#52525B] uppercase tracking-widest">Cost basis</p>
            <p className="text-sm text-[#D4D4D8] tabular-nums">{fmtAmount(h.cost_basis_eur)}</p>
          </div>
          {h.unrealized_pnl_eur !== null && (
            <div>
              <p className="text-[10px] text-[#52525B] uppercase tracking-widest">Unrealized P&amp;L</p>
              <p className={`text-sm tabular-nums ${pnlPos ? "text-[#22C55E]" : "text-[#EF4444]"}`}>
                {pnlPos ? "+" : ""}{h.unrealized_pnl_eur.toFixed(2)}€
              </p>
            </div>
          )}
        </section>
      )}

      {h.first_bought_at && (
        <p className="text-xs text-[#52525B]">First bought: {h.first_bought_at}</p>
      )}
      {h.notes && (
        <p className="text-sm text-[#A1A1AA] mt-4 italic">{h.notes}</p>
      )}
    </main>
  );
}

function KPI({ label, value, positive }: { label: string; value: string; positive: boolean }) {
  return (
    <div>
      <p className="text-[10px] text-[#52525B] uppercase tracking-widest">{label}</p>
      <p className={`text-sm font-semibold tabular-nums ${positive ? "text-[#22C55E]" : "text-[#EF4444]"}`}>{value}</p>
    </div>
  );
}
