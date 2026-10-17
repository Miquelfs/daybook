"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { deviceTimeZone } from "@/lib/dates";

/**
 * Tells Daybook which timezone you're in (iOS switches it when you land), so
 * "today", weeks and the morning brief follow you on trips. Re-renders the page
 * when it changes so server-computed dates update immediately.
 */
export function TimezoneSync() {
  const router = useRouter();
  useEffect(() => {
    const tz = deviceTimeZone();
    const cookieTz = document.cookie.split("; ").find((c) => c.startsWith("tz="))?.slice(3);
    if (!tz || decodeURIComponent(cookieTz ?? "") === tz) return;
    fetch("/api/settings/timezone", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ timezone: tz }),
    }).then((r) => { if (r.ok) router.refresh(); }).catch(() => {});
  }, [router]);
  return null;
}
