"use client";

// Connects the ExploreMap to the Countries list further down the page (they
// aren't adjacent in the layout, so a plain lifted-ref pattern doesn't reach
// across) — the Countries list calls focusCountry() on this shared ref to
// make tapping a country jump/highlight it on the map above, instead of
// being a dead ranking.

import { createContext, useContext, useRef, type ReactNode, type RefObject } from "react";
import type { ExploreMapHandle } from "@/components/ExploreMap";

const Ctx = createContext<RefObject<ExploreMapHandle | null> | null>(null);

export function TravelMapProvider({ children }: { children: ReactNode }) {
  const ref = useRef<ExploreMapHandle>(null);
  return <Ctx.Provider value={ref}>{children}</Ctx.Provider>;
}

export function useTravelMapRef(): RefObject<ExploreMapHandle | null> {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTravelMapRef must be used within a TravelMapProvider");
  return ctx;
}
