export interface WorkoutPhase {
  label: string;
  duration_min: number;
  zone: string;
  cue: string;
}

export interface PaceZone {
  pace_s_km: number;
  display: string;  // e.g. "5:28/km"
  hr_pct: string;   // e.g. "76–86%"
  rpe: string;      // e.g. "4–5"
  label: string;    // e.g. "Aerobic"
}

export interface PaceZones {
  sport: string;
  source: string;
  target_time: string | null;
  threshold_pace_s_km: number;
  threshold_pace_display: string;
  zones: Record<string, PaceZone>;
  activities_analyzed: number | null;
  window_days: number | null;
}

// Fallback HR% cues when no pace zones are available
const ZONE_CUE: Record<string, string> = {
  Z1: "Very easy — conversational, HR 56–75% max · RPE 2–3",
  Z2: "Easy aerobic — can hold a conversation, HR 76–86% max · RPE 4–5",
  Z3: "Comfortably hard — tempo effort, HR 87–91% max · RPE 6–7",
  Z4: "Threshold — hard but controlled, HR 92–95% max · RPE 8",
  Z5: "All out — maximum effort, HR 95–100% max · RPE 9–10",
};

function zoneCue(zone: string, paceZones?: PaceZones): string {
  if (paceZones?.zones[zone]) {
    const z = paceZones.zones[zone];
    return `${z.display} · HR ${z.hr_pct} max · RPE ${z.rpe}`;
  }
  return ZONE_CUE[zone] ?? zone;
}

function warmup(min: number, paceZones?: PaceZones): WorkoutPhase {
  return { label: "Warm-up", duration_min: min, zone: "Z1", cue: zoneCue("Z1", paceZones) };
}
function cooldown(min: number, paceZones?: PaceZones): WorkoutPhase {
  return { label: "Cool-down", duration_min: min, zone: "Z1", cue: zoneCue("Z1", paceZones) };
}

export function buildWorkoutDescription(
  session: {
    session_type: string;
    intensity_zone: string;
    effective_duration_min: number;
    discipline: string;
  },
  paceZones?: PaceZones,
): WorkoutPhase[] {
  const { session_type, intensity_zone, effective_duration_min: dur, discipline } = session;
  const type = session_type.toLowerCase();

  // Swimming sessions
  if (discipline === "swimming") {
    const main = Math.max(10, dur - 15);
    return [
      { label: "Warm-up", duration_min: 5, zone: "Z1", cue: "200m easy choice stroke — loosen up" },
      { label: "Drills", duration_min: 5, zone: "Z1", cue: "4×25m technique drills (catch-up, fingertip drag)" },
      { label: "Main set", duration_min: main, zone: intensity_zone, cue: zoneCue(intensity_zone, paceZones) },
      { label: "Cool-down", duration_min: 5, zone: "Z1", cue: "100m easy backstroke — HR down" },
    ];
  }

  // Brick sessions (bike + run)
  if (discipline === "brick" || type.includes("brick")) {
    const rideMin = Math.round(dur * 0.7);
    const runMin = dur - rideMin;
    const z2cue = zoneCue("Z2", paceZones);
    const z3cue = zoneCue("Z3", paceZones);
    return [
      { label: "Ride", duration_min: rideMin, zone: "Z2", cue: `Steady endurance — ${z2cue}. Last 10 min push to Z3.` },
      { label: "Transition", duration_min: 3, zone: "Z1", cue: "Quick T2 — rack bike, switch shoes, go" },
      { label: "Run (off-bike)", duration_min: runMin - 3, zone: "Z3", cue: `Settle into race pace — ${z3cue}. Expect HR elevated for first 5 min.` },
    ];
  }

  // Intervals
  if (type.includes("interval")) {
    const wuMin = Math.min(12, Math.round(dur * 0.25));
    const cdMin = Math.min(8, Math.round(dur * 0.15));
    const mainMin = dur - wuMin - cdMin;
    const repMin = Math.max(2, Math.round(mainMin / 5));
    const repCount = Math.max(4, Math.floor(mainMin / (repMin * 2)));
    const z5cue = zoneCue("Z5", paceZones);
    const z1cue = zoneCue("Z1", paceZones);
    return [
      warmup(wuMin, paceZones),
      {
        label: "Main set",
        duration_min: mainMin,
        zone: "Z5",
        cue: `${repCount}×${repMin}min at ${z5cue} · ${repMin}min recovery (${z1cue}) between each`,
      },
      cooldown(cdMin, paceZones),
    ];
  }

  // Threshold
  if (type.includes("threshold")) {
    const wuMin = Math.min(12, Math.round(dur * 0.25));
    const cdMin = Math.min(8, Math.round(dur * 0.15));
    const mainMin = dur - wuMin - cdMin;
    return [
      warmup(wuMin, paceZones),
      { label: "Threshold block", duration_min: mainMin, zone: "Z4", cue: `Sustained hard effort — ${zoneCue("Z4", paceZones)}. Hold even pace throughout.` },
      cooldown(cdMin, paceZones),
    ];
  }

  // Tempo / sweet spot
  if (type.includes("tempo") || type.includes("sweet spot")) {
    const wuMin = Math.min(10, Math.round(dur * 0.2));
    const cdMin = Math.min(8, Math.round(dur * 0.15));
    const mainMin = dur - wuMin - cdMin;
    return [
      warmup(wuMin, paceZones),
      { label: "Tempo block", duration_min: mainMin, zone: "Z3", cue: `Comfortably hard — ${zoneCue("Z3", paceZones)}. Can speak in short sentences. No pace spikes.` },
      cooldown(cdMin, paceZones),
    ];
  }

  // Goal pace / race pace
  if (type.includes("goal pace") || type.includes("race pace")) {
    const wuMin = Math.min(12, Math.round(dur * 0.25));
    const cdMin = Math.min(8, Math.round(dur * 0.15));
    const mainMin = dur - wuMin - cdMin;
    return [
      warmup(wuMin, paceZones),
      { label: "Race-pace block", duration_min: mainMin, zone: "Z4", cue: `Target race pace — ${zoneCue("Z4", paceZones)}. This is what event day feels like.` },
      cooldown(cdMin, paceZones),
    ];
  }

  // Long run / long ride
  if (type.includes("long")) {
    const cdMin = Math.min(10, Math.round(dur * 0.1));
    const mainMin = dur - cdMin;
    return [
      { label: "Main effort", duration_min: mainMin, zone: "Z2", cue: `Easy aerobic — ${zoneCue("Z2", paceZones)}. If HR drifts above Z2, slow down. Fuel every 45 min.` },
      { label: "Final stretch", duration_min: cdMin, zone: "Z1", cue: "Gradually reduce pace — let HR drop naturally" },
    ];
  }

  // Recovery run
  if (type.includes("recovery")) {
    return [
      { label: "Easy run", duration_min: dur, zone: "Z1", cue: `Very easy — ${zoneCue("Z1", paceZones)}. This run aids recovery, not fitness.` },
    ];
  }

  // Easy run (default for run discipline)
  if (discipline === "running" || type.includes("easy")) {
    const cdMin = Math.min(5, Math.round(dur * 0.1));
    const mainMin = dur - cdMin;
    return [
      { label: "Easy run", duration_min: mainMin, zone: "Z2", cue: `${zoneCue("Z2", paceZones)}. Speak full sentences throughout.` },
      cooldown(cdMin, paceZones),
    ];
  }

  // Easy ride / cycling default
  if (discipline === "ride") {
    const cdMin = Math.min(10, Math.round(dur * 0.1));
    const mainMin = dur - cdMin;
    return [
      { label: "Main ride", duration_min: mainMin, zone: intensity_zone, cue: zoneCue(intensity_zone, paceZones) },
      cooldown(cdMin, paceZones),
    ];
  }

  // Generic fallback
  return [
    { label: "Session", duration_min: dur, zone: intensity_zone, cue: zoneCue(intensity_zone, paceZones) },
  ];
}
