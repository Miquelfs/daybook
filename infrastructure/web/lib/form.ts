/** Form = fitness − fatigue (CTL − ATL) today — the one number and the one wording Today, Omyra and
 *  Health use, so the same morning never reads "deep fatigue" in one place and "overreaching" in another. */
export function formOf(ctl: number | null | undefined, atl: number | null | undefined): number | null {
  return ctl != null && atl != null ? ctl - atl : null;
}

export type FormLabel = { short: string; long: string; tone: "good" | "neutral" | "warn" | "bad" };

export function formLabel(form: number): FormLabel {
  if (form > 5) return { short: "fresh", long: "Fresh — ready for a big day", tone: "good" };
  if (form > -10) return { short: "neutral", long: "Neutral — training normally", tone: "neutral" };
  if (form > -30) return { short: "productive fatigue", long: "Productive fatigue — the work is landing", tone: "warn" };
  return { short: "deep fatigue", long: "Deep fatigue — plan easy days", tone: "bad" };
}
