"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import {
  moneyApi, fmtAmount, GROCERY_GROUPS, type GroceryProduct, type GroceryStores, type GrocerySummary, type GroceryWindow,
} from "@/lib/money-api";
import { groupStyle } from "./grocery-groups";

const WINDOWS: { key: GroceryWindow; label: string }[] = [
  { key: "ticket", label: "Last ticket" },
  { key: "week", label: "Last week" },
  { key: "month", label: "This month" },
  { key: "3m", label: "3 months" },
  { key: "12m", label: "12 months" },
];

const AVOID = "#EC4899";
const REST = "#3F3F46";
const card = "bg-[#0D0D0F] border border-[#27272A] rounded-xl";
const h2 = "text-xs text-[#71717A] uppercase tracking-widest mb-3";

export function GroceriesDashboard() {
  const [win, setWin] = useState<GroceryWindow>("3m");

  const { data: summary, isLoading } = useQuery({
    queryKey: ["groceries", "summary", win],
    queryFn: () => moneyApi.grocerySummary(win),
    placeholderData: (prev) => prev, // keep the page up while switching windows
  });
  const { data: stores } = useQuery({
    queryKey: ["groceries", "stores", win],
    queryFn: () => moneyApi.groceryStores(win),
    placeholderData: (prev) => prev,
  });
  const { data: products = [] } = useQuery({
    queryKey: ["groceries", "products"],
    queryFn: () => moneyApi.groceryProducts(),
  });

  if (isLoading) return <p className="text-sm text-[#52525B] py-8 text-center">Loading…</p>;

  if (!products.length) {
    return (
      <div className="border border-dashed border-[#27272A] rounded-xl px-5 py-8 text-center">
        <p className="text-sm text-[#A1A1AA]">No tickets yet.</p>
        <p className="text-xs text-[#52525B] mt-2 leading-relaxed">
          Add a Groceries expense and attach the Mercadona PDF or El Corte Inglés screenshots — or tap the 🧾
          on an existing one in the transaction list. Each ticket&apos;s lines show up here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap gap-1.5">
        {WINDOWS.map((w) => (
          <button
            key={w.key}
            type="button"
            onClick={() => setWin(w.key)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              win === w.key
                ? "bg-[#F59E0B]/15 border-[#F59E0B]/50 text-[#F59E0B]"
                : "border-[#27272A] text-[#71717A] hover:text-[#A1A1AA]"
            }`}
          >
            {w.label}
          </button>
        ))}
      </div>

      {summary && summary.receipts > 0 ? (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="On tickets" value={fmtAmount(summary.total)} />
            {win === "ticket" ? (
              <Stat label="Ticket" value={format(parseISO(summary.start), "d MMM")} />
            ) : (
              <Stat label="Tickets" value={String(summary.receipts)} />
            )}
            <Stat label="To avoid" value={`${Math.round(summary.avoid_share * 100)}%`} accent={summary.avoid_share > 0} />
          </div>
          <ByType summary={summary} />
          <Avoid summary={summary} />
          {stores && stores.stores.length > 0 && <Stores data={stores} />}
        </>
      ) : (
        <p className="text-sm text-[#52525B]">No tickets in this period.</p>
      )}

      <Prices products={products} />
    </div>
  );
}

function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`${card} px-4 py-3`}>
      <p className="text-xs text-[#52525B] uppercase tracking-widest mb-1">{label}</p>
      <p className={`text-xl font-semibold tabular-nums ${accent ? "text-[#EC4899]" : "text-[#FAFAFA]"}`}>{value}</p>
    </div>
  );
}

// Spend per product type. Every bar is labelled, so one neutral fill is enough.
function ByType({ summary }: { summary: GrocerySummary }) {
  const max = Math.max(...summary.groups.map((g) => g.amount), 0.01);
  return (
    <section>
      <h2 className={h2}>Spend by type</h2>
      <div className="flex flex-col gap-2.5">
        {summary.groups.map((g) => (
          <div key={g.group} title={`${g.group}: ${fmtAmount(g.amount)} · ${Math.round(g.share * 100)}%`}>
            <div className="flex items-baseline justify-between text-sm mb-1">
              <span className="text-[#D4D4D8]">
                <span className="mr-1.5">{groupStyle(g.group).emoji}</span>
                {g.group}
              </span>
              <span className="tabular-nums text-[#A1A1AA]">
                {fmtAmount(g.amount)} <span className="text-[#52525B] text-xs">· {Math.round(g.share * 100)}%</span>
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-[#18181B]">
              <div
                className="h-full rounded-full"
                style={{ width: `${(g.amount / max) * 100}%`, background: g.group === "Sweets & snacks" ? AVOID : "#A1A1AA" }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Avoid({ summary }: { summary: GrocerySummary }) {
  const maxMonth = Math.max(...summary.months.map((m) => m.total), 0.01);
  return (
    <section>
      <h2 className={h2}>To avoid</h2>
      <p className="text-sm text-[#A1A1AA] mb-4">
        {summary.avoid_total > 0 ? (
          <>
            <span className="text-[#FAFAFA] tabular-nums">{fmtAmount(summary.avoid_total)}</span> of{" "}
            <span className="tabular-nums">{fmtAmount(summary.total)}</span> went on sweets, snacks and sugary
            products.
          </>
        ) : (
          "Nothing on the avoid list in this period. 👌"
        )}
      </p>

      {summary.months.length > 1 && (
        <div className="mb-4">
          <div className="flex items-end gap-2 h-20">
            {summary.months.map((m) => (
              <div
                key={m.month}
                className="flex-1 flex flex-col justify-end h-full"
                title={`${format(parseISO(`${m.month}-01`), "MMM yyyy")}: ${fmtAmount(m.total)} · avoid ${fmtAmount(m.avoid)}`}
              >
                <div className="flex flex-col gap-[2px]" style={{ height: `${(m.total / maxMonth) * 100}%` }}>
                  <div className="rounded-t-[4px]" style={{ flex: m.total - m.avoid, background: REST }} />
                  {m.avoid > 0 && <div style={{ flex: m.avoid, background: AVOID, minHeight: 2 }} />}
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-1">
            {summary.months.map((m) => (
              <span key={m.month} className="flex-1 text-center text-[10px] text-[#52525B]">
                {format(parseISO(`${m.month}-01`), "MMM")}
              </span>
            ))}
          </div>
          <div className="flex gap-4 mt-2 text-[11px] text-[#71717A]">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: AVOID }} />Avoid</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: REST }} />Everything else</span>
          </div>
        </div>
      )}

      {summary.avoid_items.length > 0 && (
        <div className={`${card} px-4 py-1 divide-y divide-[#18181B]`}>
          {summary.avoid_items.map((a) => (
            <div key={a.product} className="flex items-center gap-2 py-2">
              <span className="w-5 text-center">{groupStyle(a.group).emoji}</span>
              <span className="flex-1 min-w-0 truncate text-sm text-[#D4D4D8]">{a.display}</span>
              <span className="text-xs text-[#52525B] tabular-nums">{a.times}×</span>
              <span className="text-sm text-[#A1A1AA] tabular-nums w-16 text-right">{fmtAmount(a.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const perBasis = (basis: "kg" | "unit") => (basis === "kg" ? "/kg" : "/u");

// Supermarkets side by side: where the money goes, the same products' prices,
// and each basket re-priced at the other store.
function Stores({ data }: { data: GroceryStores }) {
  const [showAll, setShowAll] = useState(false);
  const several = data.stores.length > 1;
  const matches = showAll ? data.matches : data.matches.slice(0, 8);
  return (
    <section>
      <h2 className={h2}>Supermarkets</h2>
      <div className={`${card} px-4 py-1 divide-y divide-[#18181B]`}>
        {data.stores.map((st) => (
          <div key={st.store} className="py-3" title={`${st.store}: ${fmtAmount(st.spend)} · ${Math.round(st.share * 100)}%`}>
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-[#E4E4E7] font-medium">{st.store}</span>
              <span className="tabular-nums text-[#A1A1AA]">
                {fmtAmount(st.spend)} {several && <span className="text-[#52525B] text-xs">· {Math.round(st.share * 100)}%</span>}
              </span>
            </div>
            {several && (
              <div className="h-1.5 rounded-full bg-[#18181B] mt-1.5">
                <div className="h-full rounded-full bg-[#A1A1AA]" style={{ width: `${st.share * 100}%` }} />
              </div>
            )}
            <p className="text-[11px] text-[#71717A] mt-1.5 tabular-nums">
              {st.receipts} {st.receipts === 1 ? "ticket" : "tickets"} · {fmtAmount(st.avg_ticket)} avg
              · {Math.round(st.avoid_share * 100)}% to avoid
              · mostly {st.top_groups.map((g) => g.group.toLowerCase()).join(", ")}
              · last {format(parseISO(st.last_date), "d MMM")}
            </p>
          </div>
        ))}
      </div>

      {data.elsewhere.filter((e) => e.items > 0).map((e) => (
        <p key={`${e.store}-${e.other}`} className="text-sm text-[#A1A1AA] mt-3">
          The {e.items} {e.items === 1 ? "item" : "items"} from {e.store} that {e.other} also sells would have cost{" "}
          <span className="text-[#FAFAFA] tabular-nums">{fmtAmount(e.would_pay)}</span> there instead of{" "}
          <span className="tabular-nums">{fmtAmount(e.paid)}</span>
          {Math.abs(e.diff) >= 0.05 && (
            <> — <span className="text-[#FAFAFA]">{fmtAmount(Math.abs(e.diff))} {e.diff < 0 ? "cheaper" : "dearer"}</span> at {e.other}</>
          )}.
        </p>
      ))}

      {several && (
        <div className="mt-4">
          <p className="text-xs text-[#71717A] mb-2">Same product, different store — latest prices</p>
          {data.matches.length === 0 ? (
            <p className="text-sm text-[#52525B]">
              No product bought at more than one store yet{data.unlabelled > 0 ? ` (${data.unlabelled} products are still being named — overnight)` : ""}.
            </p>
          ) : (
            <div className={`${card} px-4 py-1 divide-y divide-[#18181B]`}>
              {matches.map((m) => (
                <div key={m.generic} className="py-2.5">
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm text-[#D4D4D8] first-letter:uppercase">{m.generic}</span>
                    <span className="text-[11px] text-[#71717A] tabular-nums">{m.spread_pct > 0 ? `+${m.spread_pct}% spread` : "same price"}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                    {m.offers.map((o, i) => (
                      <span key={o.store} className="text-xs tabular-nums" title={`${o.display} · ${o.date}`}>
                        <span className={i === 0 ? "text-[#FAFAFA]" : "text-[#71717A]"}>{o.store}</span>{" "}
                        <span className={i === 0 ? "text-[#FAFAFA]" : "text-[#A1A1AA]"}>{fmtAmount(o.price)}{perBasis(m.basis)}</span>
                        {i === 0 && <span className="text-[10px] text-[#4ADE80] ml-1">cheapest</span>}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {data.matches.length > 8 && (
            <button type="button" onClick={() => setShowAll((v) => !v)} className="text-xs text-[#71717A] hover:text-[#FAFAFA] mt-2">
              {showAll ? "Show fewer" : `All ${data.matches.length} products`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function Prices({ products }: { products: GroceryProduct[] }) {
  const [showAll, setShowAll] = useState(false);
  const repeat = products.filter((p) => p.times > 1);
  const shown = showAll || repeat.length === 0 ? products : repeat;
  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs text-[#71717A] uppercase tracking-widest">Prices</h2>
        {repeat.length > 0 && repeat.length < products.length && (
          <button type="button" onClick={() => setShowAll((v) => !v)} className="text-xs text-[#71717A] hover:text-[#A1A1AA]">
            {showAll ? "Bought more than once" : `All ${products.length} products`}
          </button>
        )}
      </div>
      <div className={`${card} px-4 py-1 divide-y divide-[#18181B]`}>
        {shown.map((p) => <ProductRow key={p.product} p={p} />)}
      </div>
      <p className="text-[11px] text-[#3F3F46] mt-2 leading-relaxed">
        Loose produce is compared per kg. Pre-packed meat and veg are priced per pack, so their pack weight moves the
        price too. Tap a product to change its type or whether it&apos;s one to avoid.
      </p>
    </section>
  );
}

function ProductRow({ p }: { p: GroceryProduct }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const unit = p.per_kg ? "/kg" : "";

  const patch = useMutation({
    mutationFn: (body: { group?: string; avoid?: boolean; reset?: boolean }) =>
      moneyApi.patchGroceryProduct({ product: p.product, ...body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["groceries"] });
      qc.invalidateQueries({ queryKey: ["money", "receipt"] });
    },
  });

  const up = p.change_pct > 0;
  return (
    <div className="py-2">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2 text-left">
        <span className="w-5 text-center shrink-0">{groupStyle(p.group).emoji}</span>
        <span className="flex-1 min-w-0 truncate text-sm text-[#D4D4D8]">
          {p.display}
          {p.avoid && <span className="ml-1.5 text-[10px] text-[#EC4899] uppercase tracking-wider">avoid</span>}
        </span>
        {p.history.length > 1 && <Sparkline p={p} />}
        <span className="text-sm tabular-nums text-[#A1A1AA] w-20 text-right shrink-0">
          {fmtAmount(p.last_price)}{unit}
        </span>
        <span className={`text-xs tabular-nums w-14 text-right shrink-0 ${
          p.change_pct === 0 ? "text-[#3F3F46]" : up ? "text-[#EF4444]" : "text-[#22C55E]"
        }`}>
          {p.change_pct === 0 ? `${p.times}×` : `${up ? "↑" : "↓"}${Math.abs(p.change_pct)}%`}
        </span>
      </button>

      {open && (
        <div className="pl-7 pt-2 pb-1 flex flex-col gap-3">
          <table className="text-xs tabular-nums text-[#A1A1AA]">
            <tbody>
              {[...p.history].reverse().map((h, i) => (
                <tr key={i}>
                  <td className="pr-4 py-0.5 text-[#52525B]">{format(parseISO(h.date), "d MMM yyyy")}</td>
                  <td className="text-right">{fmtAmount(h.price)}{unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={p.group}
              onChange={(e) => patch.mutate({ group: e.target.value })}
              className="bg-[#18181B] border border-[#27272A] rounded-lg px-2 py-1.5 text-xs text-[#D4D4D8]"
            >
              {GROCERY_GROUPS.map((g) => <option key={g} value={g}>{groupStyle(g).emoji} {g}</option>)}
            </select>
            <button
              type="button"
              onClick={() => patch.mutate({ avoid: !p.avoid })}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                p.avoid ? "border-[#EC4899]/50 text-[#EC4899] bg-[#EC4899]/10" : "border-[#27272A] text-[#71717A]"
              }`}
            >
              {p.avoid ? "On avoid list" : "Mark to avoid"}
            </button>
            <button type="button" onClick={() => patch.mutate({ reset: true })} className="text-xs text-[#52525B] hover:text-[#A1A1AA]">
              Reset
            </button>
            {patch.error && <span className="text-xs text-[#EF4444]">{patch.error.message}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// Price over time for one product; a point per purchase, each with its own tooltip.
function Sparkline({ p }: { p: GroceryProduct }) {
  const W = 56, H = 18, pad = 3;
  const prices = p.history.map((h) => h.price);
  const lo = Math.min(...prices), hi = Math.max(...prices);
  const x = (i: number) => pad + (i / (prices.length - 1)) * (W - 2 * pad);
  const y = (v: number) => (hi === lo ? H / 2 : pad + (1 - (v - lo) / (hi - lo)) * (H - 2 * pad));
  return (
    <svg width={W} height={H} className="shrink-0" aria-label={`Price history of ${p.display}`}>
      <polyline
        points={prices.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
        fill="none"
        stroke="#71717A"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {p.history.map((h, i) => (
        <circle key={i} cx={x(i)} cy={y(h.price)} r={i === prices.length - 1 ? 2.5 : 1.5} fill="#A1A1AA">
          <title>{`${format(parseISO(h.date), "d MMM")}: €${h.price.toFixed(2)}`}</title>
        </circle>
      ))}
    </svg>
  );
}
