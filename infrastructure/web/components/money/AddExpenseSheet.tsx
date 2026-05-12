"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X, Check, Loader } from "lucide-react";
import { moneyApi, type MoneyMeta } from "@/lib/money-api";
import { CategoryPills, CATEGORY_EMOJI } from "./CategoryPills";

interface Props {
  date: string;
  isOpen: boolean;
  onClose: () => void;
  meta: MoneyMeta;
}

type Step = "amount" | "category" | "merchant";

export function AddExpenseSheet({ date, isOpen, onClose, meta }: Props) {
  const qc = useQueryClient();

  const [step, setStep] = useState<Step>("amount");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState(meta.defaults.category || "Restaurant");
  const [merchant, setMerchant] = useState("");
  const [account, setAccount] = useState(meta.defaults.account || "");
  const [autocompleteQ, setAutocompleteQ] = useState("");
  const amountRef = useRef<HTMLInputElement>(null);
  const merchantRef = useRef<HTMLInputElement>(null);

  // Debounce autocomplete query
  useEffect(() => {
    const t = setTimeout(() => setAutocompleteQ(merchant), 150);
    return () => clearTimeout(t);
  }, [merchant]);

  const { data: suggestions = [] } = useQuery({
    queryKey: ["merchants", autocompleteQ],
    queryFn: () => moneyApi.merchants(autocompleteQ),
    enabled: step === "merchant" && autocompleteQ.length >= 1,
  });

  // Focus appropriate input when step changes
  useEffect(() => {
    if (!isOpen) return;
    if (step === "amount") setTimeout(() => amountRef.current?.focus(), 50);
    if (step === "merchant") setTimeout(() => merchantRef.current?.focus(), 50);
  }, [step, isOpen]);

  // Reset when opened
  useEffect(() => {
    if (isOpen) {
      setStep("amount");
      setAmount("");
      setCategory(meta.defaults.category || "Restaurant");
      setMerchant("");
    }
  }, [isOpen, meta.defaults.category]);

  const { mutate: save, isPending } = useMutation({
    mutationFn: () =>
      moneyApi.addTransaction({
        date,
        name: merchant.trim() || category,
        amount: parseFloat(amount),
        category,
        account: account || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["money", "day", date] });
      qc.invalidateQueries({ queryKey: ["money", "month"] });
      onClose();
    },
  });

  const handleAmountNext = useCallback(() => {
    const v = parseFloat(amount);
    if (!isNaN(v) && v > 0) setStep("category");
  }, [amount]);

  const handleCategorySelect = useCallback((cat: string) => {
    setCategory(cat);
    setStep("merchant");
  }, []);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 z-40"
        onClick={onClose}
      />

      {/* Sheet */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#09090B] border-t border-[#27272A] rounded-t-2xl max-h-[85vh] overflow-y-auto">
        {/* Handle + header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4">
          <div className="flex items-center gap-3">
            {step !== "amount" && (
              <button
                type="button"
                onClick={() => setStep(step === "merchant" ? "category" : "amount")}
                className="text-[#71717A] hover:text-[#A1A1AA] text-sm"
              >
                ←
              </button>
            )}
            <h2 className="text-base font-semibold text-[#FAFAFA]">
              {step === "amount" && "How much?"}
              {step === "category" && "Category"}
              {step === "merchant" && "Where?"}
            </h2>
          </div>
          <button type="button" onClick={onClose} className="text-[#52525B] hover:text-[#A1A1AA]">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 pb-8">
          {/* Step 1: Amount */}
          {step === "amount" && (
            <div className="flex flex-col gap-6">
              <div className="flex items-center gap-2">
                <span className="text-4xl font-light text-[#71717A]">€</span>
                <input
                  ref={amountRef}
                  type="number"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAmountNext()}
                  placeholder="0.00"
                  className="flex-1 bg-transparent text-4xl font-semibold text-[#FAFAFA] outline-none placeholder:text-[#3F3F46]"
                />
              </div>
              <button
                type="button"
                onClick={handleAmountNext}
                disabled={!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0}
                className="w-full py-3 rounded-xl bg-[#F59E0B] text-[#09090B] font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next →
              </button>
            </div>
          )}

          {/* Step 2: Category */}
          {step === "category" && (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-[#71717A]">€{parseFloat(amount).toFixed(2)}</p>
              <CategoryPills selected={category} onSelect={handleCategorySelect} />
            </div>
          )}

          {/* Step 3: Merchant */}
          {step === "merchant" && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2 text-sm text-[#71717A]">
                <span>€{parseFloat(amount).toFixed(2)}</span>
                <span>·</span>
                <span>{CATEGORY_EMOJI[category] ?? "💳"} {category}</span>
              </div>

              <input
                ref={merchantRef}
                type="text"
                value={merchant}
                onChange={(e) => setMerchant(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && save()}
                placeholder="e.g. Mercadona, Zara…"
                className="w-full bg-[#18181B] border border-[#27272A] rounded-xl px-4 py-3 text-[#FAFAFA] placeholder:text-[#3F3F46] outline-none focus:border-[#52525B]"
              />

              {/* Autocomplete suggestions */}
              {suggestions.length > 0 && merchant.length >= 1 && (
                <div className="border border-[#27272A] rounded-xl overflow-hidden">
                  {suggestions.map((s) => (
                    <button
                      key={s.name}
                      type="button"
                      onClick={() => setMerchant(s.name)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-[#18181B] border-b border-[#1C1C1F] last:border-0"
                    >
                      <span className="text-[#71717A]">{CATEGORY_EMOJI[s.category ?? ""] ?? "💳"}</span>
                      <span className="text-[#D4D4D8] flex-1">{s.name}</span>
                      <span className="text-[#3F3F46] text-xs">{s.last_used}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Account selector */}
              {meta.accounts.length > 1 && (
                <div className="flex gap-2 flex-wrap">
                  {meta.accounts.map((acc) => (
                    <button
                      key={acc}
                      type="button"
                      onClick={() => setAccount(acc)}
                      className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                        account === acc
                          ? "bg-[#27272A] border-[#52525B] text-[#FAFAFA]"
                          : "border-[#27272A] text-[#52525B] hover:text-[#A1A1AA]"
                      }`}
                    >
                      {acc}
                    </button>
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={() => save()}
                disabled={isPending}
                className="w-full py-3 rounded-xl bg-[#F59E0B] text-[#09090B] font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {isPending ? <Loader size={18} className="animate-spin" /> : <Check size={18} />}
                Save expense
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
