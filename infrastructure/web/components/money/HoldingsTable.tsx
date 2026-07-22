"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { fmtAmount, type Holding } from "@/lib/money-api";
import { accountBadgeClass, assetClassLabel } from "./account-colors";
import { HoldingActions } from "./HoldingActions";
import { useCollapsible } from "./useCollapsible";

// Market prices older than this many days get an "as of" warning — either the
// listing has no recent Yahoo data or the nightly sync is failing for it.
const STALE_DAYS = 3;

function staleLabel(h: Holding): string | null {
  if (h.pricing_mode === "manual") return null; // manual values age by design
  if (!h.price_as_of) return "no price";
  const ageDays = (Date.now() - new Date(h.price_as_of).getTime()) / 86_400_000;
  return ageDays > STALE_DAYS ? `as of ${h.price_as_of}` : null;
}

// Prefer the ISIN as the secondary identifier — tickers carry ugly exchange
// suffixes (VWCE.DE, FEP3.MU). Fall back to something readable when there's
// no ISIN (crypto pairs, manual assets have none).
function secondaryId(h: Holding): string {
  if (h.isin) return h.isin;
  if (h.pricing_mode === "manual") return assetClassLabel(h.asset_class);
  return h.ticker;
}

export function HoldingsTable({ holdings, liquidAccounts }: { holdings: Holding[]; liquidAccounts: string[] }) {
  const { open, toggle } = useCollapsible("portfolio-holdings");
  const [accountFilter, setAccountFilter] = useState("");
  const [classFilter, setClassFilter] = useState("");

  const uniqueAccounts = useMemo(
    () => Array.from(new Set(holdings.map((h) => h.account))).sort(),
    [holdings]
  );
  const uniqueClasses = useMemo(
    () => Array.from(new Set(holdings.map((h) => h.asset_class))).sort(),
    [holdings]
  );

  const sorted = [...holdings].sort((a, b) => (b.market_value_eur ?? 0) - (a.market_value_eur ?? 0));
  const filtered = sorted.filter(
    (h) => (!accountFilter || h.account === accountFilter) && (!classFilter || h.asset_class === classFilter)
  );
  const hasFilters = !!(accountFilter || classFilter);
  const selectCls = "bg-[#18181B] border border-[#27272A] rounded-lg px-2 py-1.5 text-xs text-[#D4D4D8] focus:outline-none focus:border-[#F59E0B]";

  if (holdings.length === 0) return null;

  return (
    <section className="mb-6">
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center justify-between mb-3 group"
      >
        <span className="text-xs text-[#52525B] uppercase tracking-widest group-hover:text-[#A1A1AA] transition-colors">
          Holdings {holdings.length > 0 && <span className="normal-case tracking-normal">({holdings.length})</span>}
        </span>
        <ChevronDown size={14} className={`text-[#52525B] transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>

      {open && (
        <>
          {(uniqueAccounts.length > 1 || uniqueClasses.length > 1) && (
            <div className="flex flex-wrap items-center gap-2 mb-3">
              {uniqueAccounts.length > 1 && (
                <select value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)} className={selectCls}>
                  <option value="">All accounts</option>
                  {uniqueAccounts.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              )}
              {uniqueClasses.length > 1 && (
                <select value={classFilter} onChange={(e) => setClassFilter(e.target.value)} className={selectCls}>
                  <option value="">All types</option>
                  {uniqueClasses.map((c) => <option key={c} value={c}>{assetClassLabel(c)}</option>)}
                </select>
              )}
              {hasFilters && (
                <button
                  onClick={() => { setAccountFilter(""); setClassFilter(""); }}
                  className="text-xs px-2 py-1.5 rounded-lg text-[#71717A] hover:text-[#FAFAFA] border border-[#27272A] transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
          )}

          <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl overflow-hidden">
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 px-4 py-2 text-[10px] text-[#52525B] uppercase tracking-widest border-b border-[#18181B]">
              <span>Name</span>
              <span className="text-right">Value</span>
              <span className="text-right">Today</span>
              <span className="text-right">P&amp;L</span>
              <span />
            </div>
            {filtered.length === 0 ? (
              <p className="text-sm text-[#52525B] py-4 text-center">No holdings match these filters</p>
            ) : (
              <div className="divide-y divide-[#18181B]">
                {filtered.map((h) => {
                  const dayPos = (h.day_change_pct ?? 0) >= 0;
                  const pnlPos = (h.unrealized_pnl_pct ?? 0) >= 0;
                  return (
                    <div
                      key={h.id}
                      className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 px-4 py-3 items-center hover:bg-[#131316] transition-colors"
                    >
                      <Link href={`/money/portfolio/holding/${encodeURIComponent(h.id)}`} className="min-w-0">
                        <p className="text-sm text-[#FAFAFA] truncate">
                          {h.name}
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
                        <p className="text-xs text-[#71717A] truncate font-mono">{secondaryId(h)}</p>
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
            )}
          </div>
        </>
      )}
    </section>
  );
}
