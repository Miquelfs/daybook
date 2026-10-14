"""
Mallorca 312 — 312 km · ~4,750 m D+ · 27 weeks (7-week foundation + the
20-week race plan). Goal: finish inside the cut-offs.

Equipment: smart indoor trainer (measures power) but no power meter on the road
bike. So every interval session and FTP test is an INDOOR trainer session (ERG
watts from the trainer's FTP), and outdoor rides are paced by HR + RPE. Gym
strength runs alongside: 2×/week through foundation and base, 1×/week
maintenance in the build, light/none in the taper.

Adapted from the cyclingcoachai.com 20-week plan, re-shaped for a pilot on a
shifting roster and for what actually decides a 312 finish:

  • The binding constraint is the FIRST cut-off (km 97 by 11:15, start 06:30 →
    ~4h45 for the mountain half, incl. Puig Major). Then km 220 by 16:30 and the
    finish at ~20:40. So the engine is long sub-threshold climbing + durability,
    not VO2. "Puig Major" sessions are 88–92% (high Z3 / low Z4) — the effort
    you can repeat on a 12-hour day — not 95% threshold.
  • Long ride progresses 2h30 → 7h (≈200 km, 2,800 m) in week 16, with two
    back-to-back weekends. Rides in the Tramuntana when possible: you live on
    the course.
  • Fuelling is trained, not improvised: every ride ≥ 2h carries a carb/h cue
    building to 80–90 g/h (see the Fuel tab / gut-training log).
  • Recovery weeks 4, 8, 12 keep ONE quality session (per the source plan) and
    carry a 20-min field test so zones re-derive from real numbers.
  • Taper: weeks 18–20 (volume ~60% → 45% → race week), sharpness kept.

Weekday-free on purpose: there are no fixed "Tue/Sat" slots. Each session has a
`role` — long / long2 (back-to-back day 2, must follow `long`) / key / easy —
and domains.training.reflow places them on the days the roster actually leaves
free (long rides on days off, quality on mornings with a real window, nothing on
layover nights). Rest days are simply the days nothing lands on.

Foundation (F1–F7, before the source plan's week 1): learn the trainer, set
FTP, build gym tolerance and a 3h aerobic ride, so week 1 of the race plan
isn't a shock. trim_plan keeps the LAST N weeks, so a later start simply drops
foundation weeks first.

Zones follow the app's Z1–Z5 (HR/RPE, or power when a power meter is present):
Z2 = 60–75% FTP, Z3 = sweet spot 88–92%, Z4 = threshold, Z5 = VO2.
"""


def _steady(label, minutes, zone, cue=None):
    s = {"kind": "steady", "label": label, "duration_min": minutes, "zone": zone}
    if cue:
        s["cue"] = cue
    return s


def _intervals(label, reps, work_min, rest_min, work_zone, rest_zone="Z1", cue=None):
    s = {"kind": "intervals", "label": label, "reps": reps, "work_min": work_min,
         "rest_min": rest_min, "work_zone": work_zone, "rest_zone": rest_zone}
    if cue:
        s["cue"] = cue
    return s


def _sess(type_, duration, zone, structure, role, optional=False):
    d = {"type": type_, "duration": duration, "intensity_zone": zone,
         "structure": structure, "role": role}
    if optional:
        d["optional"] = True
    return d


def _fuel_cue(mins):
    if mins < 120:
        return "Bottle + 1 gel; practise eating on the bike"
    g = 60 if mins < 210 else 75 if mins < 300 else 90
    return f"Fuel {g} g carbs/h from minute 20 — log it (gut training)"


# ── canonical sessions ───────────────────────────────────────────────────────

def z2(mins, optional=False):
    return _sess("Cycling - Zone 2 Ride", mins, "Z2", [
        _steady("Warm-up", 10, "Z1"),
        _steady("Aerobic ride", mins - 15, "Z2", "60–75% FTP, cadence 85–95, conversational"),
        _steady("Cool-down", 5, "Z1"),
    ], role="easy", optional=optional)


def spin(mins, optional=True):
    return _sess("Cycling - Recovery Spin", mins, "Z1", [
        _steady("Easy spin", mins, "Z1", "Light gear, high cadence — recovery only"),
    ], role="easy", optional=optional)


def long_ride(mins, climb_m=None, label="Cycling - Long Ride", cue=None):
    body = mins - 20
    main_cue = cue or _fuel_cue(mins)
    if climb_m:
        main_cue = f"~{climb_m:,} m climbing — climbs at high Z2/low Z3, never above. " + main_cue
    return _sess(label, mins, "Z2", [
        _steady("Warm-up", 15, "Z1"),
        _steady("Long aerobic ride", body, "Z2", main_cue),
        _steady("Cool-down", 5, "Z1"),
    ], role="long")


def b2b_day2(mins):
    return _sess("Cycling - Back-to-back Day 2", mins, "Z2", [
        _steady("Warm-up", 15, "Z1", "Legs will be heavy — that's the point"),
        _steady("Aerobic ride on tired legs", mins - 20, "Z2", _fuel_cue(mins)),
        _steady("Cool-down", 5, "Z1"),
    ], role="long2")


def climb_sim(reps, work, mins=90):
    """Puig Major simulation: long sustained climbing at race-repeatable effort."""
    return _sess("Cycling - Puig Major Climb Sim (trainer)", mins, "Z3", [
        _steady("Warm-up", 15, "Z1", "Build to Z2 with 3× 1min spin-ups"),
        _intervals(f"{reps}× {work}min seated climbing", reps, work, max(5, work // 3), "Z3", "Z1",
                   "88–92% FTP in ERG, cadence 70–80 to mimic the climb (or a real climb by HR "
                   "when riding outside), seated, even pacing"),
        _steady("Cool-down", 10, "Z1"),
    ], role="key")


def sweetspot(reps, work, mins=90):
    return _sess("Cycling - Sweet Spot (trainer)", mins, "Z3", [
        _steady("Warm-up", 15, "Z1", "Build with 3× 30s spin-ups"),
        _intervals(f"{reps}× {work}min sweet spot", reps, work, 5, "Z3", "Z2",
                   "88–92% FTP — the engine for a 12h day"),
        _steady("Cool-down", 10, "Z1"),
    ], role="key")


def threshold(reps, work, mins=90):
    return _sess("Cycling - Threshold (trainer)", mins, "Z4", [
        _steady("Warm-up", 15, "Z1", "Build with 3× 30s spin-ups"),
        _intervals(f"{reps}× {work}min threshold", reps, work, max(4, work // 3), "Z4", "Z2",
                   "95–100% FTP, even effort start to finish"),
        _steady("Cool-down", 10, "Z1"),
    ], role="key")


def vo2(reps, work, mins=90):
    return _sess("Cycling - VO2max (trainer)", mins, "Z5", [
        _steady("Warm-up", 20, "Z1", "Build to Z3 with 2× 1min openers"),
        _intervals(f"{reps}× {work}min VO2max", reps, work, work, "Z5", "Z1",
                   "110–120% FTP — hard but repeatable, equal recovery"),
        _steady("Cool-down", 10, "Z1"),
    ], role="key")


def ftp_test():
    return _sess("Test - Bike 20min FTP test (trainer)", 55, "Z4", [
        _steady("Warm-up", 20, "Z1", "Build with 3× 1min efforts"),
        _intervals("20min all-out steady", 1, 20, 0, "Z4", "Z1",
                   "ERG off, steady max effort — log avg power AND avg HR: FTP = 95% of the "
                   "power, outdoor HR zones come from the HR"),
        _steady("Cool-down", 15, "Z1"),
    ], role="key")


def _ex(label, minutes, cue):
    return {"kind": "exercise", "label": label, "duration_min": minutes, "cue": cue}


GYM_PHASES = {
    # anatomical adaptation → max strength → maintenance
    "adapt": ("3×12 controlled, RPE 6", "3×12/leg", "3×15"),
    "max":   ("4×5 heavy, RPE 8, 3' rest", "3×6/leg heavy", "3×8"),
    "keep":  ("2×5 heavy, RPE 7–8", "2×6/leg", "2×8"),
}


def gym(phase="max", optional=False, mins=50):
    """Lower-body strength + core: power on the climbs, a back that survives 12h."""
    main, single, acc = GYM_PHASES[phase]
    return _sess("Strength - Gym (legs + core)", mins, "Z2", [
        _ex("Warm-up", 8, "5' bike/rower + hip & ankle mobility"),
        _ex("Back squat or leg press", 12, main),
        _ex("Romanian deadlift", 8, main.replace("4×5", "3×6")),
        _ex("Bulgarian split squat / step-ups", 8, single),
        _ex("Hip thrust + calf raises", 6, acc),
        _ex("Core: dead bug, side plank, bird dog", 8, "3 rounds — anti-rotation for long hours in the drops"),
    ], role="gym", optional=optional)


def pacing(mins=60):
    return _sess("Cycling - Pacing Discipline Ride", mins, "Z2", [
        _steady("Warm-up", 10, "Z1"),
        _steady("Locked Z2", mins - 15, "Z2",
                "Hold the cap on every rise — the skill that saves the last 100 km"),
        _steady("Cool-down", 5, "Z1"),
    ], role="easy", optional=True)


def activation(reps, mins):
    return _sess("Cycling - Activation", mins, "Z4", [
        _steady("Warm-up", 15, "Z1"),
        _intervals(f"{reps}× 5min @ threshold", reps, 5, 5, "Z4", "Z1", "Crisp, not deep"),
        _steady("Easy to finish", mins - 15 - reps * 10, "Z1"),
    ], role="key")


_FOUNDATION = [
    # === FOUNDATION (F1–F7): trainer, FTP, gym, aerobic durability ===
    [ftp_test(), z2(60), long_ride(120), spin(45), gym("adapt"), gym("adapt", optional=True)],
    [sweetspot(3, 8, 60), z2(75), long_ride(135), spin(45), gym("adapt"), gym("adapt", optional=True)],
    [sweetspot(3, 10, 70), z2(75), long_ride(150), z2(60, optional=True), gym("adapt"), gym("adapt")],
    [z2(60), long_ride(105), spin(45), gym("adapt")],                                   # recovery
    [climb_sim(2, 12, 70), z2(75), long_ride(165), spin(45), gym("max"), gym("max", optional=True)],
    [sweetspot(3, 12, 80), z2(90), long_ride(180), spin(45), gym("max"), gym("max")],
    [ftp_test(), z2(60), long_ride(120), gym("max")],                                   # recovery + re-test
]

_RACE_PLAN = [
    # === PHASE 1 — AEROBIC BASE (weeks 1–8) ===
    {"week": 1, "sessions": [threshold(2, 15, 80), z2(75), spin(45), long_ride(150), spin(45)]},
    {"week": 2, "sessions": [threshold(2, 20, 85), z2(90), spin(45), long_ride(180), spin(60)]},
    {"week": 3, "sessions": [climb_sim(3, 12, 85), z2(90), spin(45), long_ride(210, 1000), spin(60)]},
    {"week": 4, "sessions": [sweetspot(2, 12, 60), z2(60), long_ride(120), spin(45)]},  # ✦ recovery
    {"week": 5, "sessions": [threshold(2, 20, 90), z2(90), spin(60), long_ride(240), z2(75, optional=True)]},
    {"week": 6, "sessions": [climb_sim(3, 15, 90), z2(90), spin(60), long_ride(270, 1000), z2(75, optional=True)]},
    {"week": 7, "sessions": [threshold(3, 15, 90), z2(90), spin(60), long_ride(300, 1200), z2(90, optional=True)]},
    {"week": 8, "sessions": [ftp_test(), z2(60), long_ride(150), spin(45)]},  # ✦ recovery + test

    # === PHASE 2 — BUILD (weeks 9–16) ===
    # wk 9–10 ramp in gently: the source plan jumps ~9h → ~14h straight out of a
    # recovery week; with gym on top that's an injury/illness invitation.
    {"week": 9, "sessions": [climb_sim(3, 14), sweetspot(3, 15), z2(90), spin(60),
                             long_ride(270, 1200), b2b_day2(150)]},
    {"week": 10, "sessions": [climb_sim(3, 16), vo2(6, 4), z2(120), spin(60),
                              long_ride(300, 1500), b2b_day2(165)]},
    {"week": 11, "sessions": [threshold(3, 18), sweetspot(4, 15), z2(120), spin(60),
                              long_ride(330, 1800), b2b_day2(180)]},
    {"week": 12, "sessions": [ftp_test(), z2(75), long_ride(180), spin(60)]},  # ✦ recovery + test
    {"week": 13, "sessions": [climb_sim(3, 20), sweetspot(4, 15), z2(120), spin(60),
                              long_ride(330, 1500, "Cycling - Back-to-back Day 1"), b2b_day2(210)]},
    {"week": 14, "sessions": [threshold(2, 25), vo2(5, 5), z2(120), spin(60),
                              long_ride(360, 2000, cue="Cut-off rehearsal: first 100 km incl. a long climb "
                                                    "in ≤ 4h15. Fuel 90 g/h."),
                              b2b_day2(210)]},
    {"week": 15, "sessions": [climb_sim(2, 25), sweetspot(4, 15), z2(120), pacing(60),
                              long_ride(360), z2(180)]},
    {"week": 16, "sessions": [climb_sim(3, 20), threshold(2, 25), z2(120), pacing(60),
                              long_ride(420, 2800, "Cycling - Back-to-back Day 1",
                                        cue="Biggest day: ~200 km in the Tramuntana. Race kit, race food, "
                                            "90 g/h."),
                              b2b_day2(240)]},

    # === PHASE 3 — RACE PREPARATION + TAPER (weeks 17–20) ===
    {"week": 17, "sessions": [
        _sess("Cycling - Race Simulation", 90, "Z3", [
            _steady("Warm-up", 15, "Z1"),
            _intervals("2× 30min race-climb effort", 2, 30, 10, "Z3", "Z1",
                       "85–90% FTP — the Puig Major effort you'll hold on the day"),
            _steady("Cool-down", 5, "Z1"),
        ], role="key"),
        sweetspot(3, 20), z2(120), spin(60), long_ride(300), z2(210, optional=True)]},
    {"week": 18, "sessions": [threshold(1, 20, 75), z2(75), long_ride(240, cue="Last long ride — easy, fuel it all"),
                              z2(150, optional=True)]},
    {"week": 19, "sessions": [
        _sess("Cycling - Easy + 2×8 @ FTP", 60, "Z4", [
            _steady("Warm-up", 15, "Z1"),
            _intervals("2× 8min @ FTP", 2, 8, 5, "Z4", "Z1"),
            _steady("Easy", 19, "Z1"),
        ], role="key"),
        z2(45), activation(3, 60), long_ride(120, cue="Easy with 4× 1min race-pace surges"),
        spin(60)]},
    {"week": 20, "sessions": [z2(60), activation(2, 45), spin(30, optional=False)]},  # race day added by scheduler
]

# Gym through the race plan: 2×/week base (wk 1–11, one optional; recovery
# weeks 1× light), 1× maintenance in the build (wk 13–17), 1 light in wk 18,
# none in the last two weeks.
_GYM_BY_WEEK = {
    **{w: [gym("max"), gym("max", optional=True)] for w in (1, 2, 3, 5, 6, 7, 9, 10, 11)},
    **{w: [gym("keep", mins=40)] for w in (4, 8, 12, 13, 14, 15, 16, 17)},
    18: [gym("keep", optional=True, mins=35)],
}
for wk in _RACE_PLAN:
    wk["sessions"] = wk["sessions"] + _GYM_BY_WEEK.get(wk["week"], [])

MALLORCA_312_TEMPLATE = (
    [{"week": i + 1, "sessions": sess} for i, sess in enumerate(_FOUNDATION)]
    + [{"week": len(_FOUNDATION) + wk["week"], "sessions": wk["sessions"]} for wk in _RACE_PLAN]
)
