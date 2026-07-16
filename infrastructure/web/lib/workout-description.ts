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

// ── Structured workouts (structure_json from the plan template) ──────────────

export interface DZone {
  display?: string;
  label: string;
  rpe: string;
  hr_pct?: string;
  hr_lo?: number | null;
  hr_hi?: number | null;
  speed_kmh_hint?: number;
  pace_s_km?: number;
  pace_s_100m?: number;
}

export interface DisciplineZones {
  run: {
    source: string | null;
    threshold_pace_s_km?: number;
    threshold_pace_display?: string;
    zones: Record<string, DZone>;
  };
  ride: {
    source: string | null;
    threshold_hr?: number | null;
    ref_speed_kmh?: number | null;
    zones: Record<string, DZone>;
    note?: string;
  };
  swim: {
    source: string | null;
    css_s_100m?: number | null;
    css_display?: string | null;
    zones: Record<string, DZone>;
  };
}

export interface StructureStep {
  kind: "steady" | "intervals" | "swim_set";
  label: string;
  zone?: string;
  work_zone?: string;
  rest_zone?: string;
  duration_min?: number;
  reps?: number;
  work_min?: number;
  rest_min?: number;
  distance_m?: number;
  rest_s?: number;
  cue?: string;
}

type DiscKey = "run" | "ride" | "swim";

function mapDiscipline(discipline?: string): DiscKey {
  if (discipline === "cycling" || discipline === "ride") return "ride";
  if (discipline === "swimming" || discipline === "swim") return "swim";
  return "run";
}

// Infer which discipline a step belongs to (matters inside a brick).
function stepDiscipline(label: string, sessionDiscipline?: string): DiscKey {
  const l = label.toLowerCase();
  if (/swim/.test(l)) return "swim";
  if (/run/.test(l)) return "run";
  if (/bike|cycl|ride/.test(l)) return "ride";
  return mapDiscipline(sessionDiscipline);
}

// Short target string for a zone in a given discipline.
function zoneTarget(dz: DisciplineZones | undefined, disc: DiscKey, zone: string): string {
  const z = dz?.[disc]?.zones?.[zone];
  if (!z) return "";
  if (disc === "ride") {
    const sp = z.speed_kmh_hint ? ` · ~${z.speed_kmh_hint} km/h` : "";
    return `${z.display ?? ""}${sp}`;
  }
  return z.display ?? "";
}

// Build a `WorkoutPhase[]` from a structure array, resolving zone-relative
// targets to concrete paces/HR/CSS via the discipline-zones payload.
export function resolveStructure(
  structure: StructureStep[],
  dz?: DisciplineZones,
  sessionDiscipline?: string,
): WorkoutPhase[] {
  if (!Array.isArray(structure) || structure.length === 0) return [];
  const phases: WorkoutPhase[] = [];

  for (const step of structure) {
    const disc = stepDiscipline(step.label, sessionDiscipline);

    if (step.kind === "intervals") {
      const reps = step.reps ?? 1;
      const work = step.work_min ?? 0;
      const rest = step.rest_min ?? 0;
      const wZone = step.work_zone ?? "Z4";
      const rZone = step.rest_zone ?? "Z1";
      const target = zoneTarget(dz, disc, wZone);
      const restTarget = zoneTarget(dz, disc, rZone);
      const workLabel = work < 1 ? `${Math.round(work * 60)}s` : `${work}min`;
      const restLabel = rest < 1 ? `${Math.round(rest * 60)}s` : `${rest}min`;
      const meta = dz?.[disc]?.zones?.[wZone];
      const cueParts = [
        `${reps}× ${workLabel}${target ? ` @ ${target}` : ` @ ${wZone}`}`,
        rest > 0 ? `${restLabel} easy${restTarget ? ` (${restTarget})` : ""}` : null,
        meta ? `RPE ${meta.rpe}` : null,
        step.cue,
      ].filter(Boolean);
      phases.push({
        label: step.label,
        duration_min: Math.round(reps * (work + rest)),
        zone: wZone,
        cue: cueParts.join(" · "),
      });
    } else if (step.kind === "swim_set") {
      const reps = step.reps ?? 1;
      const dist = step.distance_m ?? 100;
      const zone = step.zone ?? "Z2";
      const restS = step.rest_s ?? 0;
      const target = zoneTarget(dz, "swim", zone);
      const pacePer100 = dz?.swim?.zones?.[zone]?.pace_s_100m ?? 110;
      const durMin = Math.max(1, Math.round((reps * ((dist / 100) * pacePer100 + restS)) / 60));
      const meta = dz?.swim?.zones?.[zone];
      const setLabel = reps > 1 ? `${reps}× ${dist}m` : `${dist}m`;
      const cueParts = [
        `${setLabel}${target ? ` @ ${target}` : ` @ ${zone}`}`,
        restS > 0 ? `rest ${restS}s` : null,
        meta ? `RPE ${meta.rpe}` : null,
        step.cue,
      ].filter(Boolean);
      phases.push({ label: step.label, duration_min: durMin, zone, cue: cueParts.join(" · ") });
    } else {
      // steady
      const zone = step.zone ?? "Z2";
      const target = zoneTarget(dz, disc, zone);
      const meta = dz?.[disc]?.zones?.[zone];
      const cueParts = [
        target || (meta ? meta.label : zone),
        meta ? `RPE ${meta.rpe}` : null,
        step.cue,
      ].filter(Boolean);
      phases.push({
        label: step.label,
        duration_min: step.duration_min ?? 0,
        zone,
        cue: cueParts.join(" · "),
      });
    }
  }
  return phases;
}

// Adapt the run slice of discipline-zones into the run-shaped PaceZones the
// heuristic fallback (and target banner) expects.
export function runZonesAsPaceZones(dz?: DisciplineZones): PaceZones | undefined {
  if (!dz?.run?.zones) return undefined;
  return {
    sport: "running",
    source: dz.run.source ?? "",
    target_time: null,
    threshold_pace_s_km: dz.run.threshold_pace_s_km ?? 0,
    threshold_pace_display: dz.run.threshold_pace_display ?? "",
    zones: dz.run.zones as Record<string, PaceZone>,
    activities_analyzed: null,
    window_days: null,
  };
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
