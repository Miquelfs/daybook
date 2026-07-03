"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

type PriceEntry = {
  product: string;
  date: string;
  month: string;
  unit_price: number;
  total_price: number | null;
  qty: number | null;
  store: string;
};

type ProductHistory = {
  key: string;
  name: string;
  entries: PriceEntry[];
  min_price: number | null;
  max_price: number | null;
  latest_price: number | null;
  price_change_pct: number | null;
};

const MONTHS_OPTIONS = [3, 6, 12, 24];

const TOOLTIP_STYLE = {
  contentStyle: { background: "#09090B", border: "1px solid #27272A", borderRadius: 8, fontSize: 12 },
  labelStyle: { color: "#A1A1AA" },
  itemStyle: { color: "#FAFAFA" },
};

export default function PriceComparisonPage() {
  const [months, setMonths] = useState(12);
  const [selected, setSelected] = useState<ProductHistory | null>(null);

  const { data = [], isLoading } = useQuery<ProductHistory[]>({
    queryKey: ["price-comparison", months],
    queryFn: () => fetch(`/api/groceries/price-comparison?months=${months}`).then(r => r.json()),
  });

  const hasData = data.length > 0;

  return (
    <main className="max-w-2xl mx-auto px-4 pb-28 pt-8">
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <Link href="/money/groceries" className="text-xs text-[#71717A] hover:text-[#A1A1AA] transition-colors uppercase tracking-widest">
            ← Groceries
          </Link>
        </div>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Price History</h1>
            <p className="text-sm text-[#52525B] mt-1">How product prices have changed across receipts</p>
          </div>
          <div className="flex gap-1 bg-[#0D0D0F] border border-[#27272A] rounded-lg p-1">
            {MONTHS_OPTIONS.map(m => (
              <button
                key={m}
                onClick={() => setMonths(m)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  months === m ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"
                }`}
              >
                {m}M
              </button>
            ))}
          </div>
        </div>
      </div>

      {isLoading && (
        <div className="text-center py-16 text-[#52525B] text-sm">Loading…</div>
      )}

      {!isLoading && !hasData && (
        <div className="bg-[#18181B] rounded-xl border border-[#27272A] p-8 text-center">
          <p className="text-sm text-[#52525B]">No receipt data yet.</p>
          <p className="text-xs text-[#3F3F46] mt-2">Scan receipts in the iOS app to start tracking prices.</p>
        </div>
      )}

      {/* Product price chart — shown when one is selected */}
      {selected && (
        <div className="bg-[#18181B] rounded-xl border border-[#27272A] p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-[#E4E4E7] truncate">{selected.name}</p>
            <button onClick={() => setSelected(null)} className="text-xs text-[#52525B] hover:text-[#A1A1AA] ml-4 flex-shrink-0">✕</button>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={selected.entries.map(e => ({ date: e.date.slice(5), price: e.unit_price }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272A" />
              <XAxis dataKey="date" tick={{ fill: "#52525B", fontSize: 10 }} />
              <YAxis tick={{ fill: "#52525B", fontSize: 10 }} tickFormatter={v => `€${v}`} width={48} />
              <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => [`€${v.toFixed(2)}`, "Price"]} />
              <Line type="monotone" dataKey="price" stroke="#F59E0B" strokeWidth={2} dot={{ fill: "#F59E0B", r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
          <div className="flex gap-4 mt-3 text-xs text-[#52525B]">
            <span>Min: <span className="text-emerald-500">€{selected.min_price?.toFixed(2)}</span></span>
            <span>Max: <span className="text-red-400">€{selected.max_price?.toFixed(2)}</span></span>
            <span>Latest: <span className="text-[#E4E4E7]">€{selected.latest_price?.toFixed(2)}</span></span>
            {selected.price_change_pct != null && (
              <span>
                Change:{" "}
                <span className={selected.price_change_pct >= 0 ? "text-red-400" : "text-emerald-500"}>
                  {selected.price_change_pct >= 0 ? "+" : ""}{selected.price_change_pct}%
                </span>
              </span>
            )}
          </div>
        </div>
      )}

      {/* Product list — sorted by biggest price change */}
      {hasData && (
        <div className="space-y-2">
          <p className="text-xs text-[#F59E0B] uppercase tracking-[0.2em] mb-3">Products — tap for chart</p>
          {data.map(product => (
            <button
              key={product.key}
              onClick={() => setSelected(selected?.key === product.key ? null : product)}
              className={`w-full text-left bg-[#18181B] rounded-xl border px-4 py-3 flex items-center justify-between transition-colors ${
                selected?.key === product.key ? "border-[#F59E0B]" : "border-[#27272A] hover:border-[#3F3F46]"
              }`}
            >
              <div className="min-w-0">
                <p className="text-sm text-[#E4E4E7] truncate">{product.name}</p>
                <p className="text-xs text-[#52525B] mt-0.5">{product.entries.length} purchase{product.entries.length !== 1 ? "s" : ""}</p>
              </div>
              <div className="flex items-center gap-3 ml-3 flex-shrink-0">
                <span className="text-sm font-semibold text-[#A1A1AA]">
                  €{product.latest_price?.toFixed(2) ?? "—"}
                </span>
                {product.price_change_pct != null && Math.abs(product.price_change_pct) >= 1 && (
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    product.price_change_pct >= 0
                      ? "text-red-400 bg-red-400/10"
                      : "text-emerald-500 bg-emerald-500/10"
                  }`}>
                    {product.price_change_pct >= 0 ? "+" : ""}{product.price_change_pct}%
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </main>
  );
}
