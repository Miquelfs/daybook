"use client";

import { AINarrative } from "@/components/AINarrative";

export function SleepAnalysis() {
  return (
    <AINarrative
      topic="sleep"
      days={14}
      blurb="Generate a plain-English analysis of your sleep data — stage composition, trends, and one actionable recommendation."
      cta="Analyse my sleep"
    />
  );
}
