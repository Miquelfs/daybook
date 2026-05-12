"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { moneyApi } from "@/lib/money-api";

export function SyncNotionButton() {
  const [state, setState] = useState<"idle" | "syncing" | "done" | "error">("idle");

  async function handleSync() {
    setState("syncing");
    try {
      await moneyApi.syncNotion();
      setState("done");
      setTimeout(() => setState("idle"), 4000);
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 4000);
    }
  }

  return (
    <button
      onClick={handleSync}
      disabled={state === "syncing"}
      className={`flex items-center gap-1.5 text-xs uppercase tracking-widest transition-colors ${
        state === "done"
          ? "text-[#22C55E]"
          : state === "error"
          ? "text-[#EF4444]"
          : "text-[#52525B] hover:text-[#A1A1AA]"
      }`}
    >
      <RefreshCw
        size={11}
        className={state === "syncing" ? "animate-spin" : ""}
      />
      {state === "idle" && "Sync Notion"}
      {state === "syncing" && "Syncing…"}
      {state === "done" && "Synced"}
      {state === "error" && "Failed"}
    </button>
  );
}
