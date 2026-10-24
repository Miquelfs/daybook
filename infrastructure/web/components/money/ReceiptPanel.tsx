"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Image as ImageIcon, Loader, Paperclip } from "lucide-react";
import { moneyApi, fmtAmount, receiptImageHrefs, receiptPdfHref, type Transaction } from "@/lib/money-api";
import { groupStyle, itemDetail } from "./grocery-groups";

// The supermarket ticket behind a grocery expense: attach Mercadona's PDF or
// screenshots of an emailed ticket (El Corte Inglés…), then see it line by line.
export function ReceiptPanel({ t }: { t: Transaction }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const { data: receipt, isLoading } = useQuery({
    queryKey: ["money", "receipt", t.id],
    queryFn: () => moneyApi.receipt(t.id),
    enabled: !!t.has_receipt,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["money"] });
    qc.invalidateQueries({ queryKey: ["groceries"] });
  };

  const attach = useMutation({
    mutationFn: (files: File[]) => moneyApi.attachReceipt(t.id, files),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: () => moneyApi.removeReceipt(t.id),
    onSuccess: () => { setConfirmRemove(false); invalidate(); },
  });

  const picker = (
    <input
      ref={fileRef}
      type="file"
      accept="application/pdf,.pdf,image/*"
      multiple
      className="hidden"
      onChange={(e) => {
        const files = Array.from(e.target.files ?? []);
        if (files.length) attach.mutate(files);
        e.target.value = "";
      }}
    />
  );

  const linkCls = "text-xs text-[#71717A] hover:text-[#FAFAFA] transition-colors";

  if (!t.has_receipt) {
    return (
      <div className="ml-9 mb-3 rounded-xl border border-dashed border-[#27272A] px-4 py-3">
        {picker}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={attach.isPending}
          className="flex items-center gap-2 text-sm text-[#D4D4D8] hover:text-[#FAFAFA] disabled:opacity-50"
        >
          {attach.isPending ? <Loader size={14} className="animate-spin" /> : <Paperclip size={14} />}
          {attach.isPending ? "Reading ticket…" : "Attach ticket — Mercadona PDF or screenshots"}
        </button>
        {!attach.isPending && (
          <p className="text-[11px] text-[#52525B] mt-1.5">
            El Corte Inglés: screenshot the emailed product list (all of it, down to TOTAL COMPRA) and pick every screenshot.
          </p>
        )}
        {attach.error && <p className="text-xs text-[#EF4444] mt-2">{attach.error.message}</p>}
      </div>
    );
  }

  if (isLoading || !receipt) {
    return <p className="ml-9 mb-3 text-xs text-[#52525B]">Loading ticket…</p>;
  }

  const when = receipt.purchased_at ? receipt.purchased_at.slice(11) : null;

  return (
    <div className="ml-9 mb-3 rounded-xl border border-[#27272A] bg-[#0D0D0F] px-4 py-3">
      {picker}
      <div className="flex items-center justify-between text-xs text-[#52525B] mb-2">
        <span>
          {receipt.store}{when ? ` · ${when}` : ""} · {receipt.items.length} items
        </span>
        <span className="tabular-nums text-[#A1A1AA]">{fmtAmount(receipt.total)}</span>
      </div>
      {!receipt.matches_transaction && (
        <p className="text-xs text-[#F59E0B] mb-2">
          Ticket total {fmtAmount(receipt.total)} ≠ this expense {fmtAmount(t.amount)} — wrong ticket?
        </p>
      )}

      <div className="flex flex-col divide-y divide-[#18181B]">
        {receipt.items.map((it) => {
          const { emoji } = groupStyle(it.group);
          const detail = itemDetail(it);
          return (
            <div key={it.line_no} className="flex items-center gap-2 py-1.5">
              <span className="text-sm w-5 text-center shrink-0" title={it.group}>{emoji}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-[#D4D4D8] truncate">
                  {it.display}
                  {it.avoid && <span className="ml-1.5 text-[10px] text-[#EC4899] uppercase tracking-wider">avoid</span>}
                </p>
                {detail && <p className="text-[11px] text-[#52525B] tabular-nums">{detail}</p>}
              </div>
              <span className="text-sm tabular-nums text-[#A1A1AA] shrink-0">{fmtAmount(it.amount)}</span>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3 pt-2 border-t border-[#18181B]">
        {receiptPdfHref(receipt) && (
          <a href={receiptPdfHref(receipt)!} target="_blank" rel="noreferrer" className={`${linkCls} flex items-center gap-1`}>
            <FileText size={12} /> PDF
          </a>
        )}
        {receiptImageHrefs(receipt).map((href, i, all) => (
          <a key={href} href={href} target="_blank" rel="noreferrer" className={`${linkCls} flex items-center gap-1`}>
            <ImageIcon size={12} /> {all.length > 1 ? `Screenshot ${i + 1}` : "Screenshot"}
          </a>
        ))}
        <button type="button" onClick={() => fileRef.current?.click()} disabled={attach.isPending} className={linkCls}>
          {attach.isPending ? "Reading…" : "Replace"}
        </button>
        {confirmRemove ? (
          <span className="flex items-center gap-2 text-xs">
            <button type="button" onClick={() => remove.mutate()} disabled={remove.isPending} className="text-[#EF4444]">
              Remove ticket
            </button>
            <button type="button" onClick={() => setConfirmRemove(false)} className="text-[#52525B]">Cancel</button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirmRemove(true)} className={linkCls}>Remove</button>
        )}
        <Link href="/money/groceries" className="ml-auto text-xs text-[#F59E0B] hover:text-[#FCD34D]">
          Basket insights →
        </Link>
      </div>
      {attach.error && <p className="text-xs text-[#EF4444] mt-2">{attach.error.message}</p>}
    </div>
  );
}
