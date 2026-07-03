"use client";

import { useState } from "react";

export function SleepAnalysis() {
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  async function generate() {
    setLoading(true);
    setUnavailable(false);
    try {
      const res = await fetch("/api/ai/health-narrative", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: "sleep", days: 14 }),
      });
      const data = await res.json();
      if (data.text) {
        setText(data.text);
        setGeneratedAt(data.generated_at ?? null);
      } else {
        setUnavailable(true);
      }
    } catch {
      setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section>
      <p className="text-xs text-[#F59E0B] uppercase tracking-[0.2em] mb-4">AI Analysis</p>

      {!text && !loading && (
        <div className="bg-[#18181B] rounded-xl border border-[#27272A] p-6 text-center">
          <p className="text-sm text-[#71717A] mb-4">
            Generate a plain-English analysis of your sleep data — stage composition, trends, and one actionable recommendation.
          </p>
          <button
            onClick={generate}
            className="text-sm px-4 py-2 rounded-full bg-[#F59E0B] text-[#18181B] font-medium hover:bg-[#FBBF24] transition-colors"
          >
            Analyse my sleep
          </button>
        </div>
      )}

      {loading && (
        <div className="bg-[#18181B] rounded-xl border border-[#27272A] p-6 text-center">
          <p className="text-sm text-[#71717A] animate-pulse">Thinking… this takes 20–60 seconds on the HP</p>
        </div>
      )}

      {unavailable && (
        <div className="bg-[#18181B] rounded-xl border border-[#27272A] p-6 text-center">
          <p className="text-sm text-[#71717A]">Ollama is not reachable right now. Make sure the HP is on and connected to the home network.</p>
          <button
            onClick={generate}
            className="mt-3 text-xs px-3 py-1.5 rounded-full border border-[#27272A] text-[#71717A] hover:text-[#A1A1AA] transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {text && (
        <div className="bg-[#18181B] rounded-xl border border-[#27272A] p-5">
          <p className="text-sm text-[#A1A1AA] leading-relaxed">{text}</p>
          <div className="mt-4 flex items-center justify-between">
            {generatedAt && (
              <span className="text-xs text-[#52525B]">Generated {generatedAt}</span>
            )}
            <button
              onClick={generate}
              disabled={loading}
              className="text-xs text-[#52525B] hover:text-[#71717A] transition-colors"
            >
              Regenerate
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
