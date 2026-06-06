export type EmojiStep = { min: number; emoji: string; label: string };

export const MOOD_STEPS: EmojiStep[] = [
  { min: 1, emoji: "😞", label: "Bad" },
  { min: 3, emoji: "😕", label: "Low" },
  { min: 5, emoji: "😐", label: "Okay" },
  { min: 7, emoji: "🙂", label: "Good" },
  { min: 9, emoji: "😄", label: "Great" },
];

export const ENERGY_STEPS: EmojiStep[] = [
  { min: 1, emoji: "🪫", label: "Drained" },
  { min: 3, emoji: "😪", label: "Tired" },
  { min: 5, emoji: "😐", label: "Okay" },
  { min: 7, emoji: "⚡", label: "Good" },
  { min: 9, emoji: "🚀", label: "High" },
];

// Stress: 1 = calm, 10 = maxed
export const STRESS_STEPS: EmojiStep[] = [
  { min: 1, emoji: "🧘", label: "Calm" },
  { min: 3, emoji: "😌", label: "Low" },
  { min: 5, emoji: "😐", label: "Moderate" },
  { min: 7, emoji: "😤", label: "High" },
  { min: 9, emoji: "🔥", label: "Maxed" },
];

interface Props {
  value: number | null;
  steps: EmojiStep[];
}

export function EmojiLabel({ value, steps }: Props) {
  if (value === null) return null;
  const step = [...steps].reverse().find((s) => value >= s.min) ?? steps[0];
  return (
    <span className="flex items-center gap-1 text-sm text-[#A1A1AA]">
      <span>{step.emoji}</span>
      <span className="text-xs text-[#52525B]">{step.label}</span>
    </span>
  );
}
