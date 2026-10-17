/**
 * Local calendar dates — where you ARE, not UTC.
 *
 * `new Date().toISOString().slice(0, 10)` is the UTC date: in Japan (UTC+9) it
 * is still "yesterday" until 09:00, which is how things got logged on the wrong
 * day/week on trips. Use these instead.
 */

/** YYYY-MM-DD of `d` in the device's local timezone (default: now). */
export function localISODate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Today's YYYY-MM-DD in an IANA timezone (server components: pass the `tz` cookie). */
export function todayIn(tz?: string | null): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz || undefined, year: "numeric", month: "2-digit", day: "2-digit" })
      .format(new Date());
  } catch {
    return localISODate();
  }
}

/** The device's IANA timezone, e.g. "Asia/Taipei". */
export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
