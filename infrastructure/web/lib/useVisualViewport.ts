"use client";

import { useEffect, useState, type CSSProperties } from "react";

/**
 * Visible-viewport geometry while the sheet is open. On iOS the on-screen
 * keyboard shrinks window.visualViewport but not the layout viewport, so a
 * `bottom: 0` sheet ends up hidden behind the keyboard and Safari scrolls the
 * page to compensate — pushing the amount field off the top. bottomInset is
 * how much of the layout viewport the keyboard covers.
 */
export function useVisualViewport(active: boolean) {
  const [state, setState] = useState<{ height: number; bottomInset: number } | null>(null);
  useEffect(() => {
    const v = typeof window !== "undefined" ? window.visualViewport : null;
    if (!active || !v) return;
    const update = () => {
      const bottomInset = Math.max(0, window.innerHeight - (v.height + v.offsetTop));
      setState({ height: v.height, bottomInset });
    };
    update();
    v.addEventListener("resize", update);
    v.addEventListener("scroll", update);
    return () => {
      v.removeEventListener("resize", update);
      v.removeEventListener("scroll", update);
    };
  }, [active]);
  return active ? state : null;
}

/**
 * Inline style for a bottom sheet pinned to the visible viewport: sits right
 * above the keyboard and never grows taller than the space left over.
 */
export function sheetViewportStyle(
  vv: { height: number; bottomInset: number } | null,
  fallbackMaxHeight: string,
): CSSProperties {
  return vv
    ? { top: "auto", bottom: vv.bottomInset, maxHeight: vv.height * 0.96 }
    : { bottom: 0, maxHeight: fallbackMaxHeight };
}
