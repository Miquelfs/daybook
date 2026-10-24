"use client";

import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X, Check, Loader, Paperclip } from "lucide-react";
import { moneyApi, type MoneyMeta, type MerchantSuggestion } from "@/lib/money-api";
import { CATEGORY_EMOJI, accountBadgeClass } from "./CategoryPills";
import { useVisualViewport, sheetViewportStyle } from "@/lib/useVisualViewport";

const INCOME_CATS = new Set(["Income", "OMYRA", "Finance"]);

interface Props {
  date: string;
  isOpen: boolean;
  onClose: () => void;
  meta: MoneyMeta;
  /** Preselect this account (e.g. adding from an account's page to reconcile it) */
  account?: string;
}

export function AddExpenseSheet({ date, isOpen, onClose, meta, account: presetAccount }: Props) {
  const qc = useQueryClient();

  const [sign, setSign] = useState<"+" | "-">("-");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState(meta.defaults.category || "Restaurant");
  const [customCategory, setCustomCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [merchant, setMerchant] = useState("");
  const [account, setAccount] = useState(presetAccount ?? (meta.defaults.account || ""));
  const [txDate, setTxDate] = useState(date);
  const [notes, setNotes] = useState("");
  // Supermarket ticket (Groceries only) — optional, can also be attached later from the list
  const [ticket, setTicket] = useState<File[]>([]);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [autocompleteQ, setAutocompleteQ] = useState("");
  const [subcatQ, setSubcatQ] = useState("");
  // Once the user picks a category by hand, stop auto-guessing it from the merchant.
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [autoCategory, setAutoCategory] = useState<string | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const ticketRef = useRef<HTMLInputElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const vv = useVisualViewport(isOpen);

  // Debounce merchant autocomplete
  useEffect(() => {
    const t = setTimeout(() => setAutocompleteQ(merchant), 150);
    return () => clearTimeout(t);
  }, [merchant]);

  // Debounce subcategory autocomplete
  useEffect(() => {
    const t = setTimeout(() => setSubcatQ(subcategory), 150);
    return () => clearTimeout(t);
  }, [subcategory]);

  const { data: suggestions = [] } = useQuery({
    queryKey: ["merchants", autocompleteQ],
    queryFn: () => moneyApi.merchants(autocompleteQ),
    enabled: autocompleteQ.length >= 1,
  });

  // Preselect a past merchant's usual category (and subcategory).
  function applyMerchant(s: MerchantSuggestion) {
    if (categoryTouched || !s.category) return;
    if (meta.categories.some((c) => c.key === s.category)) {
      setCategory(s.category);
      setCustomCategory("");
    } else {
      setCustomCategory(s.category);
    }
    setSubcategory((cur) => cur || s.subcategory || "");
    setSign(INCOME_CATS.has(s.category) ? "+" : "-");
    setAutoCategory(s.category);
  }

  // Typed merchant → guess: an exact (case-insensitive) past name wins; else,
  // once 3+ letters are in, if every match shares one category, use that.
  useEffect(() => {
    const typed = merchant.trim().toLowerCase();
    if (!typed || autocompleteQ !== merchant || categoryTouched) return;
    const exact = suggestions.find((s) => s.name.trim().toLowerCase() === typed);
    if (exact) return applyMerchant(exact);
    const cats = new Set(suggestions.map((s) => s.category).filter(Boolean));
    if (typed.length >= 3 && suggestions.length > 0 && cats.size === 1) {
      applyMerchant(suggestions.find((s) => s.category)!);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestions, merchant, autocompleteQ, categoryTouched]);

  const activeCategory = customCategory.trim() || category;
  const { data: subcatSuggestions = [] } = useQuery({
    queryKey: ["subcategories", activeCategory, subcatQ],
    queryFn: () => moneyApi.subcategories(activeCategory, subcatQ),
    enabled: !!activeCategory,
  });

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setSign(INCOME_CATS.has(meta.defaults.category || "Restaurant") ? "+" : "-");
      setAmount("");
      setCategory(meta.defaults.category || "Restaurant");
      setCustomCategory("");
      setSubcategory("");
      setMerchant("");
      setAccount(presetAccount ?? (meta.defaults.account || ""));
      setTxDate(date);
      setNotes("");
      setTicket([]);
      setTicketError(null);
      setCategoryTouched(false);
      setAutoCategory(null);
      setTimeout(() => amountRef.current?.focus(), 80);
    }
  }, [isOpen, date, meta.defaults.category, meta.defaults.account, presetAccount]);

  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [isOpen]);

  // Keep the focused field visible inside the (now keyboard-sized) sheet.
  function revealFocused(e: React.FocusEvent<HTMLDivElement>) {
    const el = e.target as HTMLElement;
    if (!["INPUT", "TEXTAREA"].includes(el.tagName)) return;
    setTimeout(() => el.scrollIntoView({ block: "center", behavior: "smooth" }), 300);
  }

  const isGroceries = (customCategory.trim() || category) === "Groceries";

  const { mutate: save, isPending, error } = useMutation({
    mutationFn: async () => {
      const txn = await moneyApi.addTransaction({
        date: txDate,
        name: merchant.trim() || (customCategory.trim() || category),
        amount: parseFloat(amount),
        sign,
        category: customCategory.trim() || category,
        subcategory: subcategory.trim() || undefined,
        account: account || undefined,
        notes: notes.trim() || undefined,
      });
      // The expense is saved either way; a ticket that can't be read is reported, not fatal.
      if (ticket.length && isGroceries) {
        try {
          await moneyApi.attachReceipt(txn.id, ticket);
        } catch (e) {
          return { ticketError: e instanceof Error ? e.message : "Couldn't read that ticket" };
        }
      }
      return { ticketError: null };
    },
    onSuccess: ({ ticketError }) => {
      qc.invalidateQueries({ queryKey: ["money"] });
      qc.invalidateQueries({ queryKey: ["groceries"] });
      if (ticketError) setTicketError(ticketError);
      else onClose();
    },
  });

  const canSave = !isPending && !ticketError && !!merchant.trim() && !isNaN(parseFloat(amount)) && parseFloat(amount) > 0;

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40" onClick={onClose} />

      {/* Pinned to the VISIBLE viewport: when the iOS keyboard opens, the sheet
          shrinks to the space above it instead of sliding under / off-screen. */}
      <div
        ref={sheetRef}
        onFocus={revealFocused}
        className="fixed left-0 right-0 z-50 bg-[#09090B] border-t border-[#27272A] rounded-t-2xl overflow-y-auto overflow-x-hidden overscroll-contain"
        style={sheetViewportStyle(vv, "92vh")}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-[#09090B] flex items-center justify-between px-6 pt-5 pb-4 border-b border-[#18181B]">
          <h2 className="text-base font-semibold text-[#FAFAFA]">Add transaction</h2>
          <button type="button" onClick={onClose} className="text-[#52525B] hover:text-[#A1A1AA]">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-5">
          {/* Amount + sign */}
          <div className="flex items-center gap-3">
            <div className="flex rounded-lg border border-[#27272A] overflow-hidden shrink-0">
              <button
                type="button"
                onClick={() => setSign("-")}
                className={`px-3 py-2.5 text-sm font-semibold transition-colors ${
                  sign === "-"
                    ? "bg-[#EF4444] text-white"
                    : "text-[#52525B] hover:text-[#A1A1AA]"
                }`}
              >
                −
              </button>
              <button
                type="button"
                onClick={() => setSign("+")}
                className={`px-3 py-2.5 text-sm font-semibold transition-colors ${
                  sign === "+"
                    ? "bg-[#22C55E] text-white"
                    : "text-[#52525B] hover:text-[#A1A1AA]"
                }`}
              >
                +
              </button>
            </div>
            <div className="flex items-center gap-1 flex-1 min-w-0 bg-[#18181B] border border-[#27272A] rounded-xl px-4 py-3">
              <span className="text-2xl font-light text-[#71717A]">€</span>
              <input
                ref={amountRef}
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(",", "."))}
                onKeyDown={(e) => e.key === "Enter" && canSave && save()}
                placeholder="0.00"
                className="flex-1 min-w-0 w-full bg-transparent text-2xl font-semibold text-[#FAFAFA] outline-none placeholder:text-[#3F3F46]"
              />
            </div>
          </div>

          {/* Merchant — first so autocomplete can pre-fill category */}
          <div>
            <label className="text-xs text-[#52525B] uppercase tracking-widest mb-2 block">Where / Who</label>
            <input
              type="text"
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && canSave && save()}
              placeholder="e.g. Mercadona, Bar Tony…"
              className="w-full bg-[#18181B] border border-[#27272A] rounded-xl px-4 py-3 text-base text-[#FAFAFA] placeholder:text-[#3F3F46] outline-none focus:border-[#52525B]"
            />
            {suggestions.length > 0 && merchant.length >= 1 && (
              <div className="mt-1 border border-[#27272A] rounded-xl overflow-hidden">
                {suggestions.map((s) => (
                  <button
                    key={s.name}
                    type="button"
                    onClick={() => {
                      setMerchant(s.name);
                      applyMerchant(s);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm text-left hover:bg-[#18181B] border-b border-[#1C1C1F] last:border-0 active:bg-[#27272A]"
                  >
                    <span className="text-[#71717A]">{CATEGORY_EMOJI[s.category ?? ""] ?? "💳"}</span>
                    <span className="text-[#D4D4D8] flex-1">{s.name}</span>
                    <span className="text-[#3F3F46] text-xs">{s.last_used}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Category */}
          <div>
            <label className="text-xs text-[#52525B] uppercase tracking-widest mb-2 block">
              Category
              {autoCategory && (
                <span className="normal-case tracking-normal text-[#F59E0B]/80 ml-2">· auto from {merchant.trim()}</span>
              )}
            </label>
            <div className="flex flex-wrap gap-2 mb-3">
              {meta.categories.map(({ key, emoji }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => { setCategory(key); setCustomCategory(""); setCategoryTouched(true); setAutoCategory(null); }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                    category === key && !customCategory
                      ? "bg-[#F59E0B] text-[#09090B]"
                      : "bg-[#18181B] border border-[#27272A] text-[#A1A1AA] hover:text-[#FAFAFA] hover:border-[#3F3F46]"
                  }`}
                >
                  <span>{emoji || CATEGORY_EMOJI[key] || "💳"}</span>
                  <span>{key}</span>
                </button>
              ))}
            </div>
            <input
              type="text"
              value={customCategory}
              onChange={(e) => { setCustomCategory(e.target.value); setCategoryTouched(true); setAutoCategory(null); }}
              placeholder="Or type a new category…"
              className="w-full bg-[#18181B] border border-[#27272A] rounded-xl px-4 py-2.5 text-base sm:text-sm text-[#FAFAFA] placeholder:text-[#3F3F46] outline-none focus:border-[#F59E0B]"
            />
          </div>

          {/* Subcategory */}
          <div>
            <label className="text-xs text-[#52525B] uppercase tracking-widest mb-2 block">
              Subcategory <span className="normal-case text-[#3F3F46]">(optional)</span>
            </label>
            <input
              type="text"
              value={subcategory}
              onChange={(e) => setSubcategory(e.target.value)}
              placeholder={`e.g. ${activeCategory === "Transportation" ? "Car, Motorcycle" : activeCategory === "Sports" ? "Running, Cycling" : activeCategory === "Home" ? "Rent, Utilities" : "specify…"}`}
              className="w-full bg-[#18181B] border border-[#27272A] rounded-xl px-4 py-2.5 text-base sm:text-sm text-[#FAFAFA] placeholder:text-[#3F3F46] outline-none focus:border-[#52525B]"
            />
            {subcatSuggestions.length > 0 && (
              <div className="mt-1 border border-[#27272A] rounded-xl overflow-hidden">
                {subcatSuggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSubcategory(s)}
                    className="w-full flex items-center px-4 py-2.5 text-sm text-left text-[#D4D4D8] hover:bg-[#18181B] border-b border-[#1C1C1F] last:border-0 active:bg-[#27272A]"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Account */}
          <div>
            <label className="text-xs text-[#52525B] uppercase tracking-widest mb-2 block">Account</label>
            {meta.accounts.length > 0 && (
              <div className="flex gap-2 flex-wrap mb-3">
                {meta.accounts.map((acc) => {
                  const colors = accountBadgeClass(acc);
                  const isSelected = account === acc;
                  return (
                    <button
                      key={acc}
                      type="button"
                      onClick={() => setAccount(acc)}
                      className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                        isSelected
                          ? `${colors.bg} ${colors.text} border-transparent ring-2 ring-white/20`
                          : `${colors.bg} ${colors.text} border-transparent opacity-40 hover:opacity-70`
                      }`}
                    >
                      {acc}
                    </button>
                  );
                })}
              </div>
            )}
            {/* Free-text so a brand-new account can be used straight from the entry
                sheet — the account is created implicitly by the first transaction,
                and can be given a type later in Portfolio → Manage accounts. */}
            <input
              type="text"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder="Type a new account…"
              className="w-full bg-[#18181B] border border-[#27272A] rounded-xl px-4 py-2.5 text-base sm:text-sm text-[#FAFAFA] placeholder:text-[#3F3F46] outline-none focus:border-[#52525B]"
            />
          </div>

          {/* Date + Notes in a row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[#52525B] uppercase tracking-widest mb-2 block">Date</label>
              <input
                type="date"
                value={txDate}
                onChange={(e) => setTxDate(e.target.value)}
                className="w-full bg-[#18181B] border border-[#27272A] rounded-xl px-3 py-2.5 text-base sm:text-sm text-[#FAFAFA] outline-none focus:border-[#52525B] [color-scheme:dark]"
              />
            </div>
            <div>
              <label className="text-xs text-[#52525B] uppercase tracking-widest mb-2 block">Notes</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional"
                className="w-full bg-[#18181B] border border-[#27272A] rounded-xl px-3 py-2.5 text-base sm:text-sm text-[#FAFAFA] placeholder:text-[#3F3F46] outline-none focus:border-[#52525B]"
              />
            </div>
          </div>

          {/* Ticket — Groceries only */}
          {isGroceries && (
            <div>
              <label className="text-xs text-[#52525B] uppercase tracking-widest mb-2 block">
                Ticket <span className="normal-case text-[#3F3F46]">(optional — or attach it later)</span>
              </label>
              <input
                ref={ticketRef}
                type="file"
                accept="application/pdf,.pdf,image/*"
                multiple
                className="hidden"
                onChange={(e) => setTicket(Array.from(e.target.files ?? []))}
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => ticketRef.current?.click()}
                  className={`flex-1 min-w-0 flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm border transition-colors ${
                    ticket.length
                      ? "bg-[#F59E0B]/10 border-[#F59E0B]/40 text-[#F59E0B]"
                      : "bg-[#18181B] border-[#27272A] text-[#71717A] hover:border-[#3F3F46]"
                  }`}
                >
                  <Paperclip size={14} className="shrink-0" />
                  <span className="truncate">
                    {ticket.length > 1 ? `${ticket.length} screenshots` : ticket.length ? ticket[0].name : "Mercadona PDF or El Corte Inglés screenshots"}
                  </span>
                </button>
                {ticket.length > 0 && (
                  <button type="button" onClick={() => setTicket([])} className="text-[#52525B] hover:text-[#A1A1AA] p-1">
                    <X size={16} />
                  </button>
                )}
              </div>
            </div>
          )}

          {ticketError && (
            <p className="text-xs text-[#F59E0B] text-center">
              Transaction saved, but the ticket wasn&apos;t attached: {ticketError}. You can attach it from the transaction list.
            </p>
          )}

          {/* Error */}
          {error && (
            <p className="text-xs text-[#EF4444] text-center">
              {error instanceof Error ? error.message : "Save failed — check connection"}
            </p>
          )}

          {/* Save */}
          {ticketError ? (
            <button
              type="button"
              onClick={onClose}
              className="w-full py-3.5 rounded-xl bg-[#27272A] text-[#FAFAFA] font-semibold"
            >
              Done
            </button>
          ) : (
            <button
              type="button"
              onClick={() => save()}
              disabled={!canSave}
              className="w-full py-3.5 rounded-xl bg-[#F59E0B] text-[#09090B] font-semibold flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            >
              {isPending ? <Loader size={18} className="animate-spin" /> : <Check size={18} />}
              Save transaction
            </button>
          )}
        </div>
      </div>
    </>
  );
}
