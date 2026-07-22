"use client";

import { useEffect, useState } from "react";

// Shared expand/collapse state for portfolio sections (Holdings, Recurring
// plans, …), persisted per-section in localStorage so it survives refreshes.
// Reads happen in an effect (not the initial useState) to avoid a hydration
// mismatch between server-rendered markup and the client's stored preference.
export function useCollapsible(key: string, defaultOpen = true) {
  const storageKey = `daybook:collapse:${key}`;
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem(storageKey) : null;
    if (saved !== null) setOpen(saved === "1");
  }, [storageKey]);

  function toggle() {
    setOpen((o) => {
      const next = !o;
      if (typeof window !== "undefined") window.localStorage.setItem(storageKey, next ? "1" : "0");
      return next;
    });
  }

  return { open, toggle };
}
