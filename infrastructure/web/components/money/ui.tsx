import Link from "next/link";
import { format, addMonths, subMonths } from "date-fns";

// Shared building blocks for the Money pages, so every page reads the same way.

export function Section({ title, hint, action, children, className = "mb-10" }: {
  title: string;
  hint?: string;               // one line under the title: what this section answers
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      <div className="flex items-end justify-between gap-3 mb-3">
        <div>
          <h2 className="text-xs text-[#71717A] uppercase tracking-widest">{title}</h2>
          {hint && <p className="text-xs text-[#52525B] mt-1">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

const TONE = { good: "text-[#22C55E]", warn: "text-[#F59E0B]", bad: "text-[#EF4444]", plain: "text-[#FAFAFA]" };

export function StatTile({ label, value, sub, tone = "plain" }: {
  label: string;
  value: string;
  sub?: string;
  tone?: keyof typeof TONE;
}) {
  return (
    <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-3 min-w-0">
      <p className="text-[11px] text-[#52525B] uppercase tracking-widest mb-1 truncate">{label}</p>
      <p className={`text-xl font-semibold tabular-nums truncate ${TONE[tone]}`}>{value}</p>
      {sub && <p className="text-xs text-[#52525B] mt-0.5 truncate">{sub}</p>}
    </div>
  );
}

/** ‹ October 2026 › — links to `${basePath}?month=YYYY-MM`; no going past this month. */
export function MonthSwitcher({ basePath, month, subtitle }: { basePath: string; month: string; subtitle?: string }) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  const isCurrent = month === format(new Date(), "yyyy-MM");
  const arrow = "px-3 py-1 text-lg transition-colors";
  return (
    <div className="flex items-center justify-between mb-8">
      <Link href={`${basePath}?month=${format(subMonths(d, 1), "yyyy-MM")}`} className={`${arrow} text-[#52525B] hover:text-[#A1A1AA]`} aria-label="Previous month">
        ‹
      </Link>
      <div className="text-center">
        <h1 className="text-xl font-semibold tracking-tight">{format(d, "MMMM yyyy")}</h1>
        {subtitle && <p className="text-xs text-[#52525B] mt-0.5">{subtitle}</p>}
      </div>
      <Link
        href={`${basePath}?month=${format(addMonths(d, 1), "yyyy-MM")}`}
        className={`${arrow} ${isCurrent ? "text-[#27272A] pointer-events-none" : "text-[#52525B] hover:text-[#A1A1AA]"}`}
        aria-label="Next month"
        aria-disabled={isCurrent}
      >
        ›
      </Link>
    </div>
  );
}
