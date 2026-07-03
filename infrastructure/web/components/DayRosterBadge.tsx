import Link from "next/link";

interface RosterBrief {
  duty_type: string;
  report_time: string | null;
  end_time: string | null;
  raw_code: string;
}

const DUTY_STYLE: Record<string, { bg: string; border: string; text: string; label: string }> = {
  flying_duty: { bg: "bg-[#1a3a2a]", border: "border-[#2d5a3d]", text: "text-[#4ADE80]", label: "Flying Duty" },
  standby:     { bg: "bg-[#2a2a1a]", border: "border-[#4a4a1a]", text: "text-[#FACC15]", label: "Standby"     },
  day_off:     { bg: "bg-[#18181B]", border: "border-[#27272A]", text: "text-[#52525B]", label: "Day Off"     },
  ground_duty: { bg: "bg-[#1a1a2e]", border: "border-[#2d2d4e]", text: "text-[#818CF8]", label: "Ground Duty" },
  unknown:     { bg: "bg-[#18181B]", border: "border-[#27272A]", text: "text-[#71717A]", label: "Duty"        },
};

const BASE =
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

async function fetchRosterBrief(date: string): Promise<RosterBrief | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${BASE}/roster/day/${date}/brief`, {
        cache: "no-store",
        signal: AbortSignal.timeout(4000),
      });
      if (res.status === 404) return null;
      if (!res.ok) continue;
      return await res.json();
    } catch {
      // retry on timeout or connection error
    }
  }
  return null;
}

export async function DayRosterBadge({ date }: { date: string }) {
  const brief = await fetchRosterBrief(date);

  if (!brief || brief.duty_type === "day_off") return null;

  const s = DUTY_STYLE[brief.duty_type] ?? DUTY_STYLE.unknown;

  return (
    <Link
      href="/aviation/roster"
      className={`flex items-center justify-between ${s.bg} border ${s.border} rounded-xl px-4 py-3 transition-colors hover:brightness-110`}
    >
      <div className="flex items-center gap-3">
        <span className={`text-sm font-semibold ${s.text}`}>{s.label}</span>
        {brief.report_time && (
          <span className="text-xs text-[#71717A] tabular-nums">
            C/I {brief.report_time}
            {brief.end_time && <> · C/O {brief.end_time}</>}
          </span>
        )}
      </div>
      <span className="text-xs text-[#52525B]">Roster →</span>
    </Link>
  );
}
