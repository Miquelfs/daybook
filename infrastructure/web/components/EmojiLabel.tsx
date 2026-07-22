export type EmojiStep = { min: number; emoji: string; label: string };

// One emoji per level, 1 (worst) → 10 (best).
export const MOOD_STEPS: EmojiStep[] = [
  { min: 1,  emoji: "😭", label: "Awful" },
  { min: 2,  emoji: "😢", label: "Rough" },
  { min: 3,  emoji: "😞", label: "Bad" },
  { min: 4,  emoji: "😕", label: "Low" },
  { min: 5,  emoji: "😐", label: "Okay" },
  { min: 6,  emoji: "🙂", label: "Fine" },
  { min: 7,  emoji: "😊", label: "Good" },
  { min: 8,  emoji: "😄", label: "Happy" },
  { min: 9,  emoji: "🤩", label: "Great" },
  { min: 10, emoji: "🥳", label: "Amazing" },
];

// Energy: 1 = drained, 10 = peak
export const ENERGY_STEPS: EmojiStep[] = [
  { min: 1,  emoji: "🪫", label: "Empty" },
  { min: 2,  emoji: "😴", label: "Exhausted" },
  { min: 3,  emoji: "😪", label: "Tired" },
  { min: 4,  emoji: "🥱", label: "Sluggish" },
  { min: 5,  emoji: "😐", label: "Okay" },
  { min: 6,  emoji: "🙂", label: "Steady" },
  { min: 7,  emoji: "⚡", label: "Good" },
  { min: 8,  emoji: "💪", label: "Strong" },
  { min: 9,  emoji: "🔋", label: "Charged" },
  { min: 10, emoji: "🚀", label: "Peak" },
];

// Stress: 1 = calm, 10 = maxed
export const STRESS_STEPS: EmojiStep[] = [
  { min: 1,  emoji: "🧘", label: "Calm" },
  { min: 2,  emoji: "😌", label: "Relaxed" },
  { min: 3,  emoji: "🙂", label: "Easy" },
  { min: 4,  emoji: "😐", label: "Mild" },
  { min: 5,  emoji: "😕", label: "Moderate" },
  { min: 6,  emoji: "😟", label: "Tense" },
  { min: 7,  emoji: "😰", label: "High" },
  { min: 8,  emoji: "😣", label: "Strained" },
  { min: 9,  emoji: "😤", label: "Frazzled" },
  { min: 10, emoji: "🔥", label: "Maxed" },
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
