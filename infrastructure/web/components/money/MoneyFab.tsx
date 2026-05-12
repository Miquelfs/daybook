"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { moneyApi } from "@/lib/money-api";
import { AddExpenseSheet } from "./AddExpenseSheet";
import { format } from "date-fns";

export function MoneyFab() {
  const [open, setOpen] = useState(false);
  const today = format(new Date(), "yyyy-MM-dd");

  const { data: meta } = useQuery({
    queryKey: ["money", "meta"],
    queryFn: () => moneyApi.meta(),
  });

  if (!meta) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-30 w-14 h-14 rounded-full bg-[#F59E0B] text-[#09090B] shadow-lg flex items-center justify-center hover:bg-[#FCD34D] transition-colors"
        aria-label="Add expense"
      >
        <Plus size={24} strokeWidth={2.5} />
      </button>
      <AddExpenseSheet
        date={today}
        isOpen={open}
        onClose={() => setOpen(false)}
        meta={meta}
      />
    </>
  );
}
