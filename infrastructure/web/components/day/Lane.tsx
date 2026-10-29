import Link from "next/link";
import type { LucideIcon } from "lucide-react";

// The "Today" section is four lanes — Duty, Training, Learning, Tasks — that all
// open the same way: a line icon, a small grey label, and a quiet link on the right.
// Each lane component renders its own header so it can disappear when empty.

export function LaneHeader({ icon: Icon, label, action }: {
  icon: LucideIcon;
  label: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 mb-2.5 px-0.5">
      <Icon size={14} strokeWidth={1.75} className="text-[#71717A] shrink-0" />
      <h3 className="text-[11px] uppercase tracking-[0.18em] text-[#71717A]">{label}</h3>
      {action && <div className="ml-auto min-w-0 truncate">{action}</div>}
    </div>
  );
}

export function LaneLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-[11px] text-[#71717A] hover:text-[#F59E0B] transition-colors">
      {children}
    </Link>
  );
}
