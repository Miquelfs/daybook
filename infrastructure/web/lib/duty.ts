// Roster duty vocabulary shared by the Today duty card and the Plan calendar.

export const DUTY: Record<string, { label: string; short: string; color: string }> = {
  flying_duty: { label: "Flying duty", short: "FLY", color: "#4ADE80" },
  standby:     { label: "Standby",     short: "SBY", color: "#FACC15" },
  ground_duty: { label: "Ground duty", short: "GND", color: "#818CF8" },
  day_off:     { label: "Day off",     short: "OFF", color: "#94A3B8" },
  vacation:    { label: "Vacation",    short: "VAC", color: "#2DD4BF" },
  unknown:     { label: "Duty",        short: "DTY", color: "#A1A1AA" },
};

/** An accent hex as text: deepened in light mode so yellow / green stay readable. */
export const ink = (hex: string) => `color-mix(in srgb, ${hex} var(--accent-ink), black)`;
