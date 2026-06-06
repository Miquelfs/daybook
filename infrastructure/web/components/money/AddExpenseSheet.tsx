"use client";

import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X, Check, Loader } from "lucide-react";
import { moneyApi, type MoneyMeta } from "@/lib/money-api";
import { CATEGORY_EMOJI, accountBadgeClass } from "./CategoryPills";

const INCOME_CATS = new Set(["Income", "OMYRA", "Finance"]);

interface Props {
  date: string;
  isOpen: boolean;
  onClose: () => void;
  meta: MoneyMeta;
}

export function AddExpenseSheet({ date, isOpen, onClose, meta }: Props) {
  const qc = useQueryClient();

  const [sign, setSign] = useState<"+" | "-">("-");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState(meta.defaults.category || "Restaurant");
  const [customCategory, setCustomCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [merchant, setMerchant] = useState("");
  const [account, setAccount] = useState(meta.defaults.account || "");
  const [txDate, setTxDate] = useState(date);
  const [notes, setNotes] = useState("");
  const [autocompleteQ, setAutocompleteQ] = useState("");
  const [subcatQ, setSubcatQ] = useState("");
  const amountRef = useRef<HTMLInputElement>(null);

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
      setAccount(meta.defaults.account || "");
      setTxDate(date);
      setNotes("");
      setTimeout(() => amountRef.current?.focus(), 80);
    }
  }, [isOpen, date, meta.defaults.category, meta.defaults.account]);

  const { mutate: save, isPending, error } = useMutation({
    mutationFn: () =>
      moneyApi.addTransaction({
        date: txDate,
        name: merchant.trim() || (customCategory.trim() || category),
        amount: parseFloat(amount),
        sign,
        category: customCategory.trim() || category,
        subcategory: subcategory.trim() || undefined,
        account: account || undefined,
        notes: notes.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["money"] });
      onClose();
    },
  });

  const canSave = !isPending && !!merchant.trim() && !isNaN(parseFloat(amount)) && parseFloat(amount) > 0;

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40" onClick={onClose} />

      <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#09090B] border-t border-[#27272A] rounded-t-2xl max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-[#18181B]">
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
            <div className="flex items-center gap-1 flex-1 bg-[#18181B] border border-[#27272A] rounded-xl px-4 py-3">
              <span className="text-2xl font-light text-[#71717A]">€</span>
              <input
                ref={amountRef}
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(",", "."))}
                onKeyDown={(e) => e.key === "Enter" && canSave && save()}
                placeholder="0.00"
                className="flex-1 bg-transparent text-2xl font-semibold text-[#FAFAFA] outline-none placeholder:text-[#3F3F46]"
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
              className="w-full bg-[#18181B] border border-[#27272A] rounded-xl px-4 py-3 text-[#FAFAFA] placeholder:text-[#3F3F46] outline-none focus:border-[#52525B]"
            />
            {suggestions.length > 0 && merchant.length >= 1 && (
              <div className="mt-1 border border-[#27272A] rounded-xl overflow-hidden">
                {suggestions.map((s) => (
                  <button
                    key={s.name}
                    type="button"
                    onClick={() => {
                      setMerchant(s.name);
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
            <label className="text-xs text-[#52525B] uppercase tracking-widest mb-2 block">Category</label>
            <div className="flex flex-wrap gap-2 mb-3">
              {meta.categories.map(({ key, emoji }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => { setCategory(key); setCustomCategory(""); }}
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
              onChange={(e) => setCustomCategory(e.target.value)}
              placeholder="Or type a new category…"
              className="w-full bg-[#18181B] border border-[#27272A] rounded-xl px-4 py-2.5 text-sm text-[#FAFAFA] placeholder:text-[#3F3F46] outline-none focus:border-[#F59E0B]"
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
              className="w-full bg-[#18181B] border border-[#27272A] rounded-xl px-4 py-2.5 text-sm text-[#FAFAFA] placeholder:text-[#3F3F46] outline-none focus:border-[#52525B]"
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
          {meta.accounts.length > 0 && (
            <div>
              <label className="text-xs text-[#52525B] uppercase tracking-widest mb-2 block">Account</label>
              <div className="flex gap-2 flex-wrap">
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
            </div>
          )}

          {/* Date + Notes in a row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[#52525B] uppercase tracking-widest mb-2 block">Date</label>
              <input
                type="date"
                value={txDate}
                onChange={(e) => setTxDate(e.target.value)}
                className="w-full bg-[#18181B] border border-[#27272A] rounded-xl px-3 py-2.5 text-sm text-[#FAFAFA] outline-none focus:border-[#52525B] [color-scheme:dark]"
              />
            </div>
            <div>
              <label className="text-xs text-[#52525B] uppercase tracking-widest mb-2 block">Notes</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional"
                className="w-full bg-[#18181B] border border-[#27272A] rounded-xl px-3 py-2.5 text-sm text-[#FAFAFA] placeholder:text-[#3F3F46] outline-none focus:border-[#52525B]"
              />
            </div>
          </div>

          {/* Error */}
          {error && (
            <p className="text-xs text-[#EF4444] text-center">
              {error instanceof Error ? error.message : "Save failed — check connection"}
            </p>
          )}

          {/* Save */}
          <button
            type="button"
            onClick={() => save()}
            disabled={!canSave}
            className="w-full py-3.5 rounded-xl bg-[#F59E0B] text-[#09090B] font-semibold flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          >
            {isPending ? <Loader size={18} className="animate-spin" /> : <Check size={18} />}
            Save transaction
          </button>
        </div>
      </div>
    </>
  );
}
