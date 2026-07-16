"""
Half Ironman (70.3) — balanced 20-week plan.

Rebuilt for a bike-strong athlete targeting ~5:15–5:45 on a flat course.
Design principles:
  • Base (wk 1–9): aerobic volume, no Z5. Long ride 75→150 min, long run 40→65.
  • Build (wk 9–14): Z3 race-pace bike blocks + Z4 sweet-spot/threshold, run tempo
    and threshold, brick every ~2 weeks, one open-water swim/week from wk 9.
  • Peak (wk 14–17): long ride to ~3.5 h with 2×40' at race effort, long run to
    1h45, a full race-simulation brick.
  • Taper (wk 18–20): volume drops to ~65% then ~50%, sharpness kept, race week
    is short openers + the race. `trim_plan` keeps the LAST N weeks, so the taper
    always survives a mid-plan start.
  • Deload + benchmark tests on weeks 4/8/12/16 → results re-derive athlete_zones.

Every session carries a `structure` (warm-up / main set / cool-down) with
zone-relative targets. Numeric paces/HR/CSS are resolved at render time from
athlete_zones so a re-test propagates automatically. No power meter this year —
bike targets render as HR + RPE + speed.
"""


# ── structure step builders ─────────────────────────────────────────────────

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


def _swim_set(label, reps, distance_m, zone, rest_s, cue=None):
    s = {"kind": "swim_set", "label": label, "reps": reps, "distance_m": distance_m,
         "zone": zone, "rest_s": rest_s}
    if cue:
        s["cue"] = cue
    return s


def _sess(type_, duration, zone, structure, optional=False):
    d = {"type": type_, "duration": duration, "intensity_zone": zone, "structure": structure}
    if optional:
        d["optional"] = True
    return d


# ── canonical sessions ───────────────────────────────────────────────────────

def bike_endurance(mins):
    return _sess("Cycling - Foundation Ride", mins, "Z2", [
        _steady("Warm-up", 10, "Z1"),
        _steady("Aerobic ride", mins - 15, "Z2", "Smooth, cadence 85–95, conversational"),
        _steady("Cool-down", 5, "Z1"),
    ])


def bike_long(mins, race_blocks=0, block_min=20):
    body = mins - 20
    struct = [_steady("Warm-up", 15, "Z1")]
    if race_blocks:
        # aerobic ride with race-pace (Z3) blocks sprinkled in
        struct.append(_intervals(f"{race_blocks}× race-pace block", race_blocks, block_min,
                                  10, "Z3", "Z2", "Hold 70.3 goal effort; aero position"))
        remain = body - race_blocks * (block_min + 10)
        if remain > 10:
            struct.append(_steady("Aerobic to finish", remain, "Z2"))
    else:
        struct.append(_steady("Long aerobic ride", body, "Z2", "Fuel from minute 20; keep it steady"))
    struct.append(_steady("Cool-down", 5, "Z1"))
    return _sess("Cycling - Endurance Ride", mins, "Z2", struct)


def bike_sweetspot(mins, reps, work):
    return _sess("Cycling - Sweet Spot", mins, "Z3", [
        _steady("Warm-up", 15, "Z1", "Build to Z2 with 3× 30s spin-ups"),
        _intervals(f"{reps}× {work}min sweet spot", reps, work, 5, "Z3", "Z2",
                   "High-Z3 / low-Z4, cadence 85–90 — your engine"),
        _steady("Cool-down", 10, "Z1"),
    ])


def bike_threshold(mins, reps, work):
    return _sess("Cycling - Threshold", mins, "Z4", [
        _steady("Warm-up", 15, "Z1", "Build with 3× 30s spin-ups"),
        _intervals(f"{reps}× {work}min threshold", reps, work, work // 2 or 3, "Z4", "Z2",
                   "Sustainable hard; even effort start to finish"),
        _steady("Cool-down", 10, "Z1"),
    ])


def bike_recovery(mins):
    return _sess("Cycling - Recovery Ride", mins, "Z1", [
        _steady("Easy spin", mins, "Z1", "High cadence, light legs — recovery only"),
    ], optional=True)


def run_foundation(mins):
    return _sess("Running - Foundation Run", mins, "Z2", [
        _steady("Warm-up", 8, "Z1"),
        _steady("Aerobic run", mins - 13, "Z2", "Relaxed, nose-breathing pace"),
        _steady("Cool-down", 5, "Z1"),
    ])


def run_base_strides(mins):
    # base speed without Z5 — short controlled strides tagged Z3
    return _sess("Running - Aerobic + Strides", mins, "Z2", [
        _steady("Warm-up", 10, "Z1"),
        _steady("Aerobic run", mins - 22, "Z2"),
        _intervals("6× 20s strides", 6, 0.5, 1, "Z3", "Z1", "Fast but relaxed form, full recovery"),
        _steady("Cool-down", 6, "Z1"),
    ])


def run_long(mins, z3_finish=0):
    struct = [_steady("Warm-up", 10, "Z1")]
    if z3_finish:
        struct.append(_steady("Aerobic long run", mins - 15 - z3_finish, "Z2", "Fuel from minute 20"))
        struct.append(_steady(f"Last {z3_finish}min at race pace", z3_finish, "Z3",
                              "Negative-split finish at 70.3 goal pace"))
    else:
        struct.append(_steady("Long aerobic run", mins - 15, "Z2", "Easy, build durability"))
    struct.append(_steady("Cool-down", 5, "Z1"))
    return _sess("Running - Long Run", mins, "Z2", struct)


def run_tempo(mins, reps, work):
    return _sess("Running - Tempo", mins, "Z3", [
        _steady("Warm-up", 12, "Z1"),
        _intervals(f"{reps}× {work}min tempo", reps, work, 3, "Z3", "Z1",
                   "Comfortably hard, controlled breathing"),
        _steady("Cool-down", 8, "Z1"),
    ])


def run_threshold(mins, reps, work_min, rest_min):
    return _sess("Running - Threshold Intervals", mins, "Z4", [
        _steady("Warm-up", 15, "Z1", "Include 4× 20s strides"),
        _intervals(f"{reps}× {work_min}min", reps, work_min, rest_min, "Z4", "Z1",
                   "Threshold effort; hold pace across all reps"),
        _steady("Cool-down", 10, "Z1"),
    ])


def swim_technique(mins):
    return _sess("Swimming - Technique", mins, "Z2", [
        _swim_set("Warm-up", 1, 300, "Z1", 0, "Mixed stroke, loosen up"),
        _swim_set("Drills", 8, 50, "Z2", 20, "Catch-up, single-arm, scull — focus on catch"),
        _swim_set("Aerobic swim", 6, 100, "Z2", 20, "Long, smooth stroke"),
        _swim_set("Cool-down", 1, 100, "Z1", 0),
    ])


def swim_endurance(mins, reps=8, dist=100):
    return _sess("Swimming - Endurance", mins, "Z2", [
        _swim_set("Warm-up", 1, 300, "Z1", 0),
        _swim_set(f"{reps}× {dist}m aerobic", reps, dist, "Z2", 15, "Steady CSS+10s pace, even splits"),
        _swim_set("Cool-down", 1, 100, "Z1", 0),
    ])


def swim_css(mins, reps, dist):
    return _sess("Swimming - CSS Intervals", mins, "Z4", [
        _swim_set("Warm-up", 1, 400, "Z1", 0, "Build last 100"),
        _swim_set(f"{reps}× {dist}m at CSS", reps, dist, "Z4", 15, "Hold CSS pace; this is your threshold set"),
        _swim_set("Cool-down", 1, 100, "Z1", 0),
    ])


def swim_open_water(mins):
    return _sess("Swimming - Open Water", mins, "Z3", [
        _steady("Easy in-water warm-up", 8, "Z1", "Acclimatise, practice sighting"),
        _steady("Continuous OW swim", mins - 13, "Z2", "Sight every 6–8 strokes; practice drafting"),
        _steady("Cool-down", 5, "Z1"),
    ], optional=False)


def brick(mins, bike_min, run_min):
    return _sess("Brick - Bike + Run", mins, "Z3", [
        _steady("Bike warm-up", 10, "Z1"),
        _steady("Bike at race effort", bike_min - 10, "Z3", "70.3 goal effort, aero"),
        _steady("T2 transition", 2, "Z1", "Quick change — practice it"),
        _steady("Run off the bike", run_min, "Z3", "Start controlled; legs come around by 10min"),
    ])


def brick_race_sim(mins, swim_min, bike_min, run_min):
    return _sess("Brick - Race Simulation", mins, "Z3", [
        _steady("Open-water / pool swim", swim_min, "Z2", "Race-pace effort, then T1"),
        _steady("Bike at race pace", bike_min, "Z3", "Hold goal watts-feel; full race fuelling & hydration"),
        _steady("T2 transition", 3, "Z1"),
        _steady("Run off the bike", run_min, "Z3", "Lock into 70.3 race pace; rehearse gels"),
    ])


def test_run_1k():
    return _sess("Test - Run 1km TT", 32, "Z5", [
        _steady("Warm-up", 15, "Z1", "Include 4× 20s strides"),
        _intervals("1km time trial", 1, 4, 0, "Z5", "Z1", "All-out even 1km — log your time"),
        _steady("Cool-down", 12, "Z1"),
    ])


def test_bike_20():
    return _sess("Test - Bike 20min field test", 55, "Z4", [
        _steady("Warm-up", 20, "Z1", "Build with 3× 1min efforts"),
        _intervals("20min all-out steady", 1, 20, 0, "Z4", "Z1",
                   "Flat road, hold the highest pace you can — log avg HR + avg speed"),
        _steady("Cool-down", 15, "Z1"),
    ])


def test_swim_css():
    return _sess("Test - Swim CSS 400+200", 40, "Z4", [
        _swim_set("Warm-up", 1, 400, "Z1", 0),
        _swim_set("400m time trial", 1, 400, "Z5", 0, "Max sustainable — log time"),
        _swim_set("Easy recovery", 1, 200, "Z1", 300),
        _swim_set("200m time trial", 1, 200, "Z5", 0, "Max sustainable — log time"),
        _swim_set("Cool-down", 1, 100, "Z1", 0),
    ])


def race_half():
    return _sess("Race - Half Ironman", 300, "Z4", [
        _steady("Swim 1.9km", 38, "Z3", "Controlled start, settle into rhythm, sight & draft"),
        _steady("Bike 90km", 165, "Z3", "Goal effort, never surge; fuel 60–90g carbs/h"),
        _steady("Run 21.1km", 110, "Z3", "First 3km easy, then lock race pace; walk aid stations if needed"),
    ])


def opener(discipline):
    if discipline == "bike":
        return _sess("Cycling - Openers", 30, "Z3", [
            _steady("Easy spin", 15, "Z1"),
            _intervals("3× 90s at race effort", 3, 1.5, 2, "Z3", "Z1", "Prime the legs, stay fresh"),
            _steady("Cool-down", 6, "Z1"),
        ])
    if discipline == "run":
        return _sess("Running - Openers", 25, "Z3", [
            _steady("Easy jog", 12, "Z1"),
            _intervals("3× 90s at race pace", 3, 1.5, 2, "Z3", "Z1"),
            _steady("Cool-down", 5, "Z1"),
        ])
    return _sess("Swimming - Openers", 25, "Z3", [
        _swim_set("Warm-up", 1, 300, "Z1", 0),
        _swim_set("4× 50m build to race pace", 4, 50, "Z3", 20),
        _swim_set("Cool-down", 1, 100, "Z1", 0),
    ])


# ── week assembly ────────────────────────────────────────────────────────────

HALF_IRONMAN_BALANCED_TEMPLATE = [
    # ---- BASE (1–9): aerobic volume, no Z5 ----
    {"week": 1, "sessions": [
        swim_technique(40), swim_endurance(40, 8, 100),
        bike_sweetspot(55, 3, 8), bike_endurance(50), bike_long(75),
        run_foundation(35), run_long(40),
    ]},
    {"week": 2, "sessions": [
        swim_technique(40), swim_endurance(45, 10, 100),
        bike_sweetspot(60, 3, 10), bike_endurance(55), bike_long(90),
        run_base_strides(35), run_long(45),
    ]},
    {"week": 3, "sessions": [
        swim_technique(45), swim_endurance(50, 12, 100),
        bike_sweetspot(60, 4, 10), bike_endurance(55), bike_long(105),
        run_foundation(40), run_long(50),
    ]},
    {"week": 4, "sessions": [  # deload + baseline benchmarks
        test_swim_css(), swim_endurance(35, 6, 100),
        test_bike_20(), bike_endurance(45),
        test_run_1k(), run_long(35),
    ]},
    {"week": 5, "sessions": [
        swim_technique(45), swim_endurance(55, 12, 100),
        bike_sweetspot(65, 4, 12), bike_endurance(60), bike_long(120),
        run_base_strides(40), run_long(55),
    ]},
    {"week": 6, "sessions": [
        swim_technique(45), swim_endurance(58, 14, 100),
        bike_sweetspot(70, 3, 15), bike_endurance(60), bike_long(135),
        run_foundation(40), run_long(60),
    ]},
    {"week": 7, "sessions": [
        swim_technique(50), swim_endurance(60, 14, 100),
        bike_sweetspot(75, 4, 15), bike_endurance(65), bike_long(150),
        run_base_strides(45), run_long(65),
    ]},
    {"week": 8, "sessions": [  # deload + benchmarks
        test_swim_css(), swim_endurance(40, 8, 100),
        test_bike_20(), bike_endurance(50),
        test_run_1k(), run_long(45),
    ]},
    {"week": 9, "sessions": [  # build begins — Z3 race-pace blocks, OW swim, brick
        swim_css(55, 8, 100), swim_open_water(45),
        bike_threshold(65, 3, 10), bike_long(150, race_blocks=2, block_min=15),
        run_threshold(45, 4, 5, 3), brick(75, 50, 25),
    ]},
    # ---- BUILD (9–14) ----
    {"week": 10, "sessions": [
        swim_css(58, 8, 125), swim_open_water(50),
        bike_threshold(70, 3, 12), bike_endurance(60), bike_long(165, race_blocks=2, block_min=20),
        run_threshold(48, 4, 6, 3), run_long(80, z3_finish=15),
    ]},
    {"week": 11, "sessions": [
        swim_css(60, 10, 100), swim_open_water(55),
        bike_sweetspot(75, 4, 15), bike_long(180, race_blocks=3, block_min=20),
        run_tempo(50, 3, 10), brick(95, 65, 30),
    ]},
    {"week": 12, "sessions": [  # deload + benchmarks
        test_swim_css(), swim_open_water(40),
        test_bike_20(), bike_endurance(55),
        test_run_1k(), run_long(50),
    ]},
    {"week": 13, "sessions": [
        swim_css(62, 10, 125), swim_open_water(55),
        bike_threshold(75, 4, 12), bike_long(180, race_blocks=3, block_min=20),
        run_threshold(52, 5, 6, 3), brick(105, 70, 35),
    ]},
    # ---- PEAK (14–17) ----
    {"week": 14, "sessions": [
        swim_css(62, 12, 100), swim_open_water(60),
        bike_sweetspot(80, 3, 20), bike_long(195, race_blocks=2, block_min=40),
        run_long(95, z3_finish=20), run_tempo(50, 3, 12),
    ]},
    {"week": 15, "sessions": [  # race-simulation week
        swim_css(60, 8, 150), swim_open_water(60),
        bike_long(210, race_blocks=2, block_min=40),
        brick_race_sim(215, 45, 150, 30), run_long(100, z3_finish=20),
    ]},
    {"week": 16, "sessions": [  # deload + benchmarks, keep a little sharpness
        test_swim_css(), swim_open_water(45),
        test_bike_20(), bike_endurance(60),
        test_run_1k(), brick(70, 45, 25),
    ]},
    {"week": 17, "sessions": [  # final big block
        swim_css(60, 10, 125), swim_open_water(55),
        bike_threshold(75, 4, 15), bike_long(195, race_blocks=2, block_min=40),
        run_long(105, z3_finish=25), brick(90, 60, 30),
    ]},
    # ---- TAPER (18–20) ----
    {"week": 18, "sessions": [  # ~65% volume, keep intensity
        swim_css(50, 6, 100), swim_open_water(45),
        bike_sweetspot(70, 3, 12), bike_long(150, race_blocks=2, block_min=20),
        run_tempo(45, 3, 8), run_long(75),
    ]},
    {"week": 19, "sessions": [  # ~50% volume, sharpen
        swim_css(40, 5, 100),
        bike_threshold(60, 3, 8), bike_endurance(60),
        run_threshold(40, 3, 5, 3), run_long(55),
    ]},
    {"week": 20, "sessions": [  # race week — short openers + race
        opener("swim"), opener("bike"),
        run_foundation(25), opener("run"),
        race_half(),
    ]},
]
