import { fmtAmount, type EfficiencyData } from "@/lib/money-api";

const FLAG_STYLE: Record<string, { label: string; cls: string }> = {
  over_budget: { label: "over budget", cls: "text-[#EF4444] border-[#EF4444]/30" },
  recoverable: { label: "recoverable", cls: "text-[#F59E0B] border-[#F59E0B]/30" },
  efficient: { label: "efficient", cls: "text-[#22C55E] border-[#22C55E]/30" },
};

// Recoverable savings: what each category could give back if it ran at its
// aggressive cap (25th percentile of its own history, floored by budget).
export function EfficiencyTable({ data }: { data: EfficiencyData }) {
  if (data.rows.length === 0) {
    return <p className="text-xs text-[#52525B]">Not enough history yet.</p>;
  }
  return (
    <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[#52525B] uppercase tracking-widest text-[9px]">
              <th className="text-left font-normal px-4 py-2.5">Category</th>
              <th className="text-right font-normal px-2 py-2.5">Avg/mo</th>
              <th className="text-right font-normal px-2 py-2.5">Cap</th>
              <th className="text-right font-normal px-2 py-2.5">Recoverable</th>
              <th className="text-right font-normal px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#18181B]">
            {data.rows.map((r) => (
              <tr key={r.category}>
                <td className="px-4 py-2.5 text-[#D4D4D8]">{r.category}</td>
                <td className="px-2 py-2.5 text-right tabular-nums text-[#A1A1AA]">{fmtAmount(r.avg_actual)}</td>
                <td className="px-2 py-2.5 text-right tabular-nums text-[#52525B]">{fmtAmount(r.aggressive_cap)}</td>
                <td className="px-2 py-2.5 text-right tabular-nums text-[#FAFAFA]">
                  {r.recoverable_per_month > 0 ? fmtAmount(r.recoverable_per_month) : "—"}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <span className={`inline-block border rounded-full px-2 py-0.5 text-[9px] uppercase tracking-wider ${FLAG_STYLE[r.flag].cls}`}>
                    {FLAG_STYLE[r.flag].label}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-[#27272A]">
              <td className="px-4 py-3 text-[#A1A1AA]" colSpan={3}>
                Total recoverable at aggressive caps
              </td>
              <td className="px-2 py-3 text-right tabular-nums text-[#FAFAFA] font-medium">
                {fmtAmount(data.total_recoverable)}/mo
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-[10px] text-[#3F3F46] px-4 pb-3">
        cap = 25th percentile of your own monthly history for that category (max: its budget) · last {data.window_months} months
      </p>
    </div>
  );
}
