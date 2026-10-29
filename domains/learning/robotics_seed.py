"""
The robot-builder roadmap (v2.1) as a learning plan: phases with a gate, items per week.

Weeks count from the plan's start Monday. The roadmap's months map to weeks so
Robótica inicial (five weeks) fits month 1: M1 1–5 · M2 6–9 · M3 10–13 · M4 14–17
· M5 18–21 · M6 22–26, then Robot 2 open-ended (27–52).

Item tuple: (week, weeks, title, kind, tier, resource, est_hours, notes)
  week None → any time in the phase (not shown on Today).
  kind: course | learn | skill | build | buy | decide
  tier: core | pick | later
"""

SLUG = "robotics"

PLAN = {
    "slug": SLUG,
    "title": "Robot builder",
    "emoji": "🤖",
    "goal": "A mobile robot you drive from your phone, that avoids obstacles on its own, "
            "then sees through a camera, then does something useful at home.",
    "weeks": 26,
    "weekly_hours": 13,
}

_MULTIMETER = ("Order: continuity (beep) → DC voltage (probes in parallel) → resistance (unpowered only) "
               "→ diode mode (LED forward voltage) → current last (meter in series, red lead to the amp "
               "socket — move it back after). Never measure resistance live; never current across a source.")
_SOLDER_KIT = ("Temperature-controlled iron, rosin-core solder, flux, tip cleaner, flush cutters, strippers, "
               "desoldering braid, heat-shrink, safety glasses, ventilation.")
_MCW_NOTE = "Titles past T30 weren't all confirmed — check each against the roadmap's Core/Pick tags."

PHASES = [
    {
        "title": "Month 1 · First win and the basics",
        "summary": "Robótica inicial is the main extra. Multimeter in week 1, soldering practice. No Webots yet.",
        "week_from": 1, "week_to": 5,
        "gate": "You've driven a robot from your phone, and can measure voltage, continuity and resistance correctly.",
        "items": [
            (1, 1, "Robótica inicial · week 1 — check the materials list, order parts", "course", "core",
             "Robótica inicial (UAB)", 3, "Check the list before buying anything else."),
            (1, 1, "Multimeter: continuity, voltage, resistance, diode, current", "skill", "core",
             "Engineering Mindset / EEVblog multimeter video", 2, _MULTIMETER),
            (1, 1, "Electricity basics: voltage, current, resistance, Ohm's law", "learn", "core",
             "The Engineering Mindset", 1, None),
            (1, 1, "McWhorter T20–22 · RGB LEDs as a PWM exercise", "course", "core",
             "McWhorter (newer series)", 2, "Don't linger on RGB."),
            (1, 1, "Order a basic soldering kit", "buy", "core", None, None, _SOLDER_KIT),
            (2, 1, "Robótica inicial · week 2", "course", "core", "Robótica inicial (UAB)", 3, None),
            (2, 1, "McWhorter T23–24 · buzzers (quick)", "course", "pick", "McWhorter", 1,
             "Handy for robot beeps and status sounds."),
            (2, 1, "Soldering practice: header pins on scrap perfboard", "skill", "core",
             "Adafruit — Guide to Excellent Soldering", 2,
             "Heat pad and lead together, feed solder to the joint, aim for a shiny cone."),
            (3, 1, "Robótica inicial · week 3", "course", "core", "Robótica inicial (UAB)", 3, None),
            (3, 1, "McWhorter T25–26 · photoresistors (quick)", "course", "pick", "McWhorter", 1,
             "Stepping stone to line sensors."),
            (3, 1, "Soldering: wires + heat-shrink; crimp Dupont/JST", "skill", "core", None, 2, None),
            (4, 1, "Robótica inicial · week 4", "course", "core", "Robótica inicial (UAB)", 3, None),
            (4, 1, "McWhorter → T30 · servos", "course", "core", "McWhorter", 3,
             "Servos: steering, grippers, pan/tilt cameras."),
            (5, 1, "Robótica inicial · week 5 — drive the robot from your phone", "course", "core",
             "Robótica inicial (UAB)", 3, "The month-1 win."),
            (5, 1, "McWhorter · next 2–3 tutorials", "course", "core", "McWhorter", 2, _MCW_NOTE),
        ],
    },
    {
        "title": "Month 2 · Electronics for motors",
        "summary": "Motors are noisy and hungry — most robot faults are wiring or power. CAD and Webots start.",
        "week_from": 6, "week_to": 9,
        "gate": "You can explain why a motor can't be driven from a pin.",
        "items": [
            (6, 1, "Voltage dividers and pull-ups", "learn", "core", "The Engineering Mindset", 1, None),
            (6, 1, "Capacitors and decoupling", "learn", "core", "The Engineering Mindset", 1, None),
            (6, 4, "Onshape fundamentals (~2 h/week)", "course", "core", "Onshape learning pathways", 8,
             "One CAD tool only."),
            (6, 2, "Webots course 1 · set up + module 1", "course", "pick",
             "CU Boulder — Basic Robotic Behaviors and Odometry", 5,
             "Background track, 2–3 h/week. Drop it first if a week gets crowded."),
            (6, 1, "McWhorter · buttons, debouncing, interrupts", "course", "core", "McWhorter", 3,
             "Interrupts are how you'll read encoders. Don't skip."),
            (7, 1, "Transistors and MOSFETs as switches; flyback diodes", "learn", "core",
             "Engineering Mindset · Make: Electronics if shaky", 2, None),
            (7, 1, "Build: MOSFET-switched motor", "build", "core", None, 2, None),
            (7, 1, "McWhorter · ultrasonic distance sensor", "course", "core", "McWhorter", 2,
             "Your first obstacle sensor."),
            (8, 1, "H-bridges, PWM, motor stall current", "learn", "core",
             "Engineering Mindset · Pololu motor guides", 2, None),
            (8, 1, "Build: a motor driver module on your own wiring", "build", "core", None, 3, None),
            (8, 2, "Webots course 1 · module 2", "course", "pick", "CU Boulder (Webots)", 5, None),
            (9, 1, "Decide and order the 3D printer", "decide", "core", "Prusa knowledge base · current reviews",
             None, None),
            (9, 1, "McWhorter · LCD / displays (quick)", "course", "core", "McWhorter", 1,
             "Robot status messages."),
            (None, 1, "3Blue1Brown linear algebra — one episode a week", "learn", "pick",
             "3Blue1Brown", None, "Background only."),
        ],
    },
    {
        "title": "Month 3 · Driving accurately",
        "summary": "Encoders, interrupts and a practical PID make it drive straight. First printed parts, ESP32.",
        "week_from": 10, "week_to": 13,
        "gate": "Your robot drives straight and turns on command, and you can explain the gains you tuned.",
        "items": [
            (10, 1, "Encoders + interrupts: count wheel ticks", "learn", "core", "Pololu guides · McWhorter", 2, None),
            (10, 2, "PID basics", "learn", "core", "Tim Wescott — PID Without a PhD · Brian Douglas", 3,
             "Brunton's Control Bootcamp only if stuck."),
            (10, 2, "Print first parts: motor mounts", "build", "core", "Onshape · Prusa knowledge base", 3, None),
            (11, 2, "Build: encoder motor with a PID speed controller, log runs", "build", "core", None, 5,
             "Predict, measure, explain — then break it on purpose (change a gain)."),
            (11, 1, "McWhorter · I2C and shift registers", "course", "core", "McWhorter", 3,
             "Needed for IMUs and driver boards."),
            (12, 2, "ESP32 + a phone interface for wireless control", "build", "core",
             "Andreas Spiess (YouTube)", 5, None),
            (12, 2, "Chassis draft in Onshape", "build", "core", "Onshape", 4, None),
            (12, 1, "Webots · odometry (pairs with real encoders)", "course", "pick", "CU Boulder (Webots)", 3, None),
            (13, 1, "McWhorter · SD-card data logging; plot motor and sensor data", "course", "core",
             "McWhorter", 2, None),
            (13, 1, "Entry-level oscilloscope (if you keep building)", "buy", "pick", None, None, None),
        ],
    },
    {
        "title": "Month 4 · Robot 1 — RC plus obstacle avoidance",
        "summary": "Your own printed chassis, battery powered, phone controlled, avoids obstacles on its own.",
        "week_from": 14, "week_to": 17,
        "gate": "It runs without a cable, switches between RC and autonomous mode, and you can say what failed and why.",
        "items": [
            (14, 2, "Print the chassis; mount motors, driver, battery", "build", "core", None, 5, None),
            (14, 1, "Robot 1 Git repo + journal (photos, wiring diagram)", "skill", "core", None, 1,
             "One journal and one repo per robot."),
            (15, 1, "Untethered power: battery pack, fuse, switch", "build", "core", None, 3,
             "AA/NiMH or a USB bank. LiPo only with a safe bag and a balance charger."),
            (15, 1, "Phone control over the ESP32", "build", "core", None, 3, None),
            (16, 2, "Ultrasonic obstacle avoidance + a basic autonomous mode", "build", "core", None, 6, None),
            (17, 1, "Switch between RC and autonomous mode", "build", "core", None, 3, None),
            (17, 1, "Write-up: what failed and why", "skill", "core", None, 1, None),
        ],
    },
    {
        "title": "Month 5 · Linux and the camera rover",
        "summary": "Linux and Git, Python in the robot context, a Raspberry Pi rover with live video.",
        "week_from": 18, "week_to": 21,
        "gate": "You can drive the camera robot from your phone and see live video.",
        "items": [
            (18, 2, "The Missing Semester: shell and Git", "course", "core", "MIT — The Missing Semester", 5, None),
            (18, 1, "Decide Pi 4 or Pi 5; buy it with a camera", "decide", "core", None, None,
             "The Pi Zero is fine for Linux, not for vision."),
            (19, 3, "Staple: Python in the robot context (selected chapters)", "course", "core",
             "Learn Robotics Programming (Staple)", 8, "Not cover to cover."),
            (20, 2, "Build: Pi rover with camera streaming", "build", "core", "Staple", 6, None),
            (21, 1, "Drive the camera rover from browser / phone", "build", "core", None, 3, None),
        ],
    },
    {
        "title": "Month 6 · The AI layer",
        "summary": "A pretrained model and a simple controller that turns detections into motion.",
        "week_from": 22, "week_to": 26,
        "gate": "Your robot reacts to something it sees, and you know why it sometimes gets it wrong.",
        "items": [
            (22, 2, "OpenCV basics", "learn", "core", "OpenCV tutorials", 5, None),
            (23, 4, "Duke ML · CNN / image-recognition modules", "course", "pick", "Duke — Intro to ML", 10,
             "Only the vision modules; skip NLP unless you want voice control."),
            (24, 2, "Pretrained object / person detection on the Pi", "build", "core", None, 5,
             "Slow? Lower the resolution or use a lighter model."),
            (25, 2, "Line following, follow-me or object tracking", "build", "core", None, 6, None),
            (26, 1, "Failure log: lighting, speed, resolution", "skill", "core", None, 1, None),
        ],
    },
    {
        "title": "Months 7–12 · Robot 2 — a home helper",
        "summary": "Pick one problem at home. ROS 2 and mapping only if the project genuinely needs them.",
        "week_from": 27, "week_to": 52,
        "gate": "A home-helper robot, documented.",
        "items": [
            (27, 1, "Choose the home problem Robot 2 solves", "decide", "core", None, None,
             "Patrol / telepresence rover · plant-watering bot · fetch bot · sensor rover with a dashboard."),
            (35, 1, "Decide on Webots courses 2–3", "decide", "pick", "CU Boulder (Webots)", None, None),
            (None, 1, "ROS 2 + mapping — only if the project outgrows simple code", "learn", "later",
             "Articulated Robotics (Josh Newans)", None, None),
            (None, 1, "Train or fine-tune your own vision model", "learn", "later", "Duke course", None, None),
            (None, 1, "KiCad: your own PCB", "learn", "later", None, None, None),
        ],
    },
]


def seed(conn, start_date: str) -> int | None:
    """Insert the plan once (keyed by slug). Returns the new plan id, or None if it exists."""
    if conn.execute("SELECT 1 FROM learning_plans WHERE slug=?", (SLUG,)).fetchone():
        return None
    cur = conn.execute(
        "INSERT INTO learning_plans (slug, title, emoji, goal, start_date, weeks, weekly_hours) "
        "VALUES (:slug, :title, :emoji, :goal, :start, :weeks, :weekly_hours)",
        {**PLAN, "start": start_date})
    plan_id = cur.lastrowid
    for p_ord, ph in enumerate(PHASES):
        pid = conn.execute(
            "INSERT INTO learning_phases (plan_id, ord, title, summary, week_from, week_to, gate) "
            "VALUES (?,?,?,?,?,?,?)",
            (plan_id, p_ord, ph["title"], ph["summary"], ph["week_from"], ph["week_to"], ph["gate"])).lastrowid
        for i_ord, (week, weeks, title, kind, tier, resource, est, notes) in enumerate(ph["items"]):
            conn.execute(
                "INSERT INTO learning_items (plan_id, phase_id, ord, week, weeks, title, kind, tier, "
                "resource, est_hours, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (plan_id, pid, i_ord, week, weeks, title, kind, tier, resource, est, notes))
    conn.commit()
    return plan_id
