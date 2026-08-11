import type { HeartRating } from "@/lib/food-api";

export const HEART_META: Record<HeartRating, { label: string; color: string; dot: string }> = {
  good:  { label: "Heart-healthy", color: "#34D399", dot: "🟢" },
  ok:    { label: "OK",            color: "#A3A3A3", dot: "⚪️" },
  limit: { label: "Limit",         color: "#FBBF24", dot: "🟡" },
  avoid: { label: "Avoid",         color: "#F87171", dot: "🔴" },
};

// Compact pill for a food's cholesterol rating.
export function HeartRatingBadge({ rating, className = "" }: { rating: HeartRating; className?: string }) {
  const m = HEART_META[rating];
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide font-medium ${className}`}
      style={{ color: m.color, background: `${m.color}1A` }}
    >
      {m.label}
    </span>
  );
}

// Just the coloured dot, for dense rows.
export function HeartDot({ rating, title }: { rating: HeartRating; title?: string }) {
  const m = HEART_META[rating];
  return (
    <span
      title={title ?? m.label}
      className="inline-block w-2 h-2 rounded-full shrink-0"
      style={{ background: m.color }}
    />
  );
}
