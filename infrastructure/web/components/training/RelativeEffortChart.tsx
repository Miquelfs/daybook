"use client";

import { useEffect, useState } from "react";
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts";
import { format, parseISO } from "date-fns";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

type RERow = {
  week: string;
  week_start: string;
  weekly_re: number;
  band_low: number | null;
  band_high: number | null;
};

const RANGES = [
  { label: "12W", weeks: 12 },
  { label: "6M", weeks: 26 },
  { label: "1Y", weeks: 52 },
];

const TOOLTIP_STYLE = {
  contentStyle: { background: "#09090B", border: "1px solid #27272A", borderRadius: 8, fontSize: 12 },
  labelStyle: { color: "#A1A1AA" },
  itemStyle: { color: "#FAFAFA" },
};

function formatDate(d: string) {
  try { return format(parseISO(d), "d MMM"); } catch { return d; }
}

export default function RelativeEffortChart() {
  const [range, setRange] = useState(12);
  const [data, setData] = useState<RERow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`${API}/training/relative-effort?range=${range}`)
      .then((r) => r.json())
      .then((d) => { setData(Array.isArray(d) ? d : []); })
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [range]);

  // Status based on most recent week
  const last = data.length > 0 ? data[data.length - 1] : null;
  let status = "";
  let statusColor = "text-[#52525B]";
  if (last && last.band_low !== null && last.band_high !== null) {
    if (last.weekly_re > last.band_high) {
      status = "Above trend — monitor fatigue";
      statusColor = "text-rose-400";
    } else if (last.weekly_re < last.band_low) {
      status = "Below trend — recovery or deload";
      statusColor = "text-blue-400";
    } else {
      status = "On trend";
      statusColor = "text-emerald-400";
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.weeks}
              onClick={() => setRange(r.weeks)}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                range === r.weeks ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        {status && (
          <span className={`text-xs font-medium ${statusColor}`}>{status}</span>
        )}
      </div>

      {loading ? (
        <div className="h-[160px] flex items-center justify-center text-[#52525B] text-sm">Loading…</div>
      ) : data.length === 0 ? (
        <div className="h-[160px] flex items-center justify-center text-[#52525B] text-sm">No relative effort data</div>
      ) : (
        <ResponsiveContainer width="100%" height={160}>
          <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
            <CartesianGrid stroke="#18181B" vertical={false} />
            <XAxis
              dataKey="week_start"
              tickFormatter={formatDate}
              tick={{ fill: "#52525B", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fill: "#52525B", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              {...TOOLTIP_STYLE}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0]?.payload as RERow;
                return (
                  <div style={TOOLTIP_STYLE.contentStyle} className="p-2 space-y-0.5">
                    <p style={TOOLTIP_STYLE.labelStyle} className="text-xs mb-1">{formatDate(String(label))}</p>
                    <p className="text-white text-xs">RE: {row.weekly_re}</p>
                    {row.band_low !== null && row.band_high !== null && (
                      <p className="text-[#A1A1AA] text-xs">Band: {row.band_low} – {row.band_high}</p>
                    )}
                  </div>
                );
              }}
            />
            {/* Band: fill band_high amber, then erase below band_low with bg color */}
            <Area
              dataKey="band_high"
              fill="#F59E0B"
              fillOpacity={0.12}
              stroke="none"
              dot={false}
              activeDot={false}
              legendType="none"
            />
            <Area
              dataKey="band_low"
              fill="#09090B"
              fillOpacity={1}
              stroke="none"
              dot={false}
              activeDot={false}
              legendType="none"
            />
            <Line
              type="monotone"
              dataKey="weekly_re"
              stroke="#F59E0B"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: "#F59E0B" }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
