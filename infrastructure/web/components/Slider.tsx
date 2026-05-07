"use client";

interface Props {
  label: string;
  min?: number;
  max?: number;
  value: number | null;
  onChange: (v: number) => void;
  hint?: string;
}

const LABELS: Record<string, string[]> = {
  energy: ["Drained", "", "", "", "", "Moderate", "", "", "", "Buzzing"],
  mood: ["Low", "", "", "", "", "Neutral", "", "", "", "Great"],
  stress: ["None", "", "", "", "", "Moderate", "", "", "", "Max"],
  sleep_quality: ["Terrible", "", "", "", "", "OK", "", "", "", "Perfect"],
};

export function Slider({ label, min = 1, max = 10, value, onChange, hint }: Props) {
  const id = label.toLowerCase().replace(/\s+/g, "-");
  const labelKey = id.replace("-", "_");
  const endpoints = LABELS[labelKey];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-sm font-medium text-[#FAFAFA]">
          {label}
        </label>
        <span className="text-lg font-semibold text-[#F59E0B] tabular-nums w-6 text-right">
          {value ?? "—"}
        </span>
      </div>

      {hint && (
        <p className="text-xs text-[#52525B] -mt-1">{hint}</p>
      )}

      <input
        id={id}
        type="range"
        min={min}
        max={max}
        value={value ?? Math.round((min + max) / 2)}
        onChange={(e) => onChange(Number(e.target.value))}
        className="accent-[#F59E0B]"
        style={{
          background: value
            ? `linear-gradient(to right, #F59E0B ${((value - min) / (max - min)) * 100}%, #3F3F46 ${((value - min) / (max - min)) * 100}%)`
            : "#3F3F46",
        }}
      />

      {endpoints && (
        <div className="flex justify-between text-[10px] text-[#52525B]">
          <span>{endpoints[0]}</span>
          <span>{endpoints[5]}</span>
          <span>{endpoints[9]}</span>
        </div>
      )}
    </div>
  );
}
