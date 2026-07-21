"use client";

import { useState, useEffect, useCallback } from "react";
import { ChevronDown } from "lucide-react";

// Render inline **bold** spans within a run of text.
function inlineBold(s: string, keyBase: string) {
  return s.split(/(\*\*[^*]+\*\*)/g).map((chunk, i) =>
    /^\*\*[^*]+\*\*$/.test(chunk) ? (
      <strong key={keyBase + i} className="text-[#D4D4D8] font-semibold">
        {chunk.slice(2, -2)}
      </strong>
    ) : (
      <span key={keyBase + i}>{chunk}</span>
    )
  );
}

// Parse the model's markdown-lite output into labelled, justified sections.
// Splits on blank lines and before any "**Label:**" marker, so it reads well
// even when the model runs the sections together.
function FormattedNarrative({ text }: { text: string }) {
  const blocks = text
    .split(/\n\s*\n|(?=\*\*[^*\n]+:\*\*)/g)
    .map((s) => s.trim())
    .filter(Boolean);
  return (
    <div className="space-y-3">
      {blocks.map((block, i) => {
        const m = block.match(/^\*\*([^*]+):\*\*\s*([\s\S]*)$/);
        return (
          <p key={i} className="text-sm text-[#A1A1AA] leading-relaxed text-justify">
            {m ? (
              <>
                <strong className="text-[#F59E0B] font-semibold">{m[1]}. </strong>
                {inlineBold(m[2], `b${i}-`)}
              </>
            ) : (
              inlineBold(block, `b${i}-`)
            )}
          </p>
        );
      })}
    </div>
  );
}

interface Props {
  topic: string;          // sleep | hrv | training | load | money | insights …
  days?: number;
  label?: string;
  blurb: string;          // shown before first generation
  cta?: string;           // generate-button label
}

export function AINarrative({ topic, days = 14, label = "AI Analysis", blurb, cta = "Generate" }: Props) {
  const [text, setText] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  // Restore collapsed preference per card.
  useEffect(() => {
    if (typeof window !== "undefined" && localStorage.getItem(`ai-collapsed-${topic}`) === "1") {
      setCollapsed(true);
    }
  }, [topic]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem(`ai-collapsed-${topic}`, next ? "1" : "0"); } catch {}
      return next;
    });
  }, [topic]);

  // Restore today's cached narrative on mount so it survives navigation.
  useEffect(() => {
    let alive = true;
    fetch(`/api/ai/health-narrative?topic=${encodeURIComponent(topic)}&days=${days}`)
      .then((r) => r.json())
      .then((d) => {
        if (alive && d.text) {
          setText(d.text);
          setGeneratedAt(d.generated_at ?? null);
        }
      })
      .catch(() => {})
      .finally(() => { if (alive) setRestoring(false); });
    return () => { alive = false; };
  }, [topic, days]);

  const generate = useCallback(async (force = false) => {
    setLoading(true);
    setUnavailable(false);
    try {
      const res = await fetch("/api/ai/health-narrative", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, days, force }),
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
  }, [topic, days]);

  return (
    <section>
      {text ? (
        <button
          onClick={toggleCollapsed}
          className="w-full flex items-center justify-between mb-4 group"
          aria-expanded={!collapsed}
        >
          <span className="text-xs text-[#F59E0B] uppercase tracking-[0.2em]">{label}</span>
          <span className="flex items-center gap-1 text-xs text-[#52525B] group-hover:text-[#A1A1AA] transition-colors">
            {collapsed ? "Show" : "Hide"}
            <ChevronDown size={14} className={`transition-transform ${collapsed ? "" : "rotate-180"}`} />
          </span>
        </button>
      ) : (
        <p className="text-xs text-[#F59E0B] uppercase tracking-[0.2em] mb-4">{label}</p>
      )}

      {text && !collapsed && (
        <div className="bg-[#18181B] rounded-xl border border-[#27272A] p-5">
          <FormattedNarrative text={text} />
          <div className="mt-4 flex items-center gap-4">
            {generatedAt && <span className="text-xs text-[#52525B]">Generated {generatedAt}</span>}
            <button
              onClick={() => generate(true)}
              disabled={loading}
              className="text-xs text-[#52525B] hover:text-[#71717A] transition-colors disabled:opacity-50 ml-auto"
            >
              {loading ? "Regenerating…" : "Regenerate"}
            </button>
          </div>
        </div>
      )}

      {!text && loading && (
        <div className="bg-[#18181B] rounded-xl border border-[#27272A] p-6 text-center">
          <p className="text-sm text-[#71717A] animate-pulse">Thinking…</p>
        </div>
      )}

      {!text && !loading && unavailable && (
        <div className="bg-[#18181B] rounded-xl border border-[#27272A] p-6 text-center">
          <p className="text-sm text-[#71717A]">AI is offline right now.</p>
          <button
            onClick={() => generate()}
            className="mt-3 text-xs px-3 py-1.5 rounded-full border border-[#27272A] text-[#71717A] hover:text-[#A1A1AA] transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {!text && !loading && !unavailable && !restoring && (
        <div className="bg-[#18181B] rounded-xl border border-[#27272A] p-6 text-center">
          <p className="text-sm text-[#71717A] mb-4">{blurb}</p>
          <button
            onClick={() => generate()}
            className="text-sm px-4 py-2 rounded-full bg-[#F59E0B] text-[#18181B] font-medium hover:bg-[#FBBF24] transition-colors"
          >
            {cta}
          </button>
        </div>
      )}

      {!text && !loading && !unavailable && restoring && (
        <div className="bg-[#18181B] rounded-xl border border-[#27272A] p-6 h-24 animate-pulse" />
      )}
    </section>
  );
}
