"""
Gran Fondo 100km — 12 weeks.
No power meter required. Zones expressed in HR % and RPE.
Zone guide: Z1 <55% max HR / RPE 1-3, Z2 56-75% / RPE 4-5,
            Z3 76-90% / RPE 6-7, Z4 91-105% / RPE 8-9, Z5 >105% / RPE 10.
"""

CYCLING_GRAN_FONDO_100_TEMPLATE = [
    # === BASE: Weeks 1–4 ===
    # Build aerobic endurance. One long ride, two shorter sessions.
    {"week": 1, "sessions": [
        {"type": "Cycling - Easy Ride", "duration": 60, "intensity_zone": "Z2"},
        {"type": "Cycling - Easy Ride", "duration": 45, "intensity_zone": "Z2"},
        {"type": "Cycling - Long Ride", "duration": 90, "intensity_zone": "Z2"},
    ]},
    {"week": 2, "sessions": [
        {"type": "Cycling - Easy Ride", "duration": 60, "intensity_zone": "Z2"},
        {"type": "Cycling - Sweet Spot Intervals", "duration": 50, "intensity_zone": "Z3"},
        {"type": "Cycling - Long Ride", "duration": 105, "intensity_zone": "Z2"},
    ]},
    {"week": 3, "sessions": [
        {"type": "Cycling - Easy Ride", "duration": 60, "intensity_zone": "Z2"},
        {"type": "Cycling - Sweet Spot Intervals", "duration": 55, "intensity_zone": "Z3"},
        {"type": "Cycling - Long Ride", "duration": 120, "intensity_zone": "Z2"},
        {"type": "Cycling - Recovery Spin", "duration": 30, "intensity_zone": "Z1", "optional": True},
    ]},
    {"week": 4, "sessions": [
        {"type": "Cycling - Recovery Ride", "duration": 45, "intensity_zone": "Z1"},
        {"type": "Cycling - Easy Ride", "duration": 50, "intensity_zone": "Z2"},
        {"type": "Cycling - Long Ride", "duration": 90, "intensity_zone": "Z2"},
    ]},
    # === BUILD: Weeks 5–8 ===
    # Introduce intensity. Sweet spot 2x/week. Extend long ride.
    {"week": 5, "sessions": [
        {"type": "Cycling - Sweet Spot Intervals", "duration": 60, "intensity_zone": "Z3"},
        {"type": "Cycling - Easy Ride", "duration": 60, "intensity_zone": "Z2"},
        {"type": "Cycling - Long Ride", "duration": 150, "intensity_zone": "Z2"},
        {"type": "Cycling - Recovery Spin", "duration": 30, "intensity_zone": "Z1", "optional": True},
    ]},
    {"week": 6, "sessions": [
        {"type": "Cycling - Sweet Spot Intervals", "duration": 60, "intensity_zone": "Z3"},
        {"type": "Cycling - Threshold Efforts", "duration": 50, "intensity_zone": "Z4"},
        {"type": "Cycling - Long Ride", "duration": 165, "intensity_zone": "Z2"},
    ]},
    {"week": 7, "sessions": [
        {"type": "Cycling - Sweet Spot Intervals", "duration": 65, "intensity_zone": "Z3"},
        {"type": "Cycling - Easy Ride", "duration": 60, "intensity_zone": "Z2"},
        {"type": "Cycling - Long Ride", "duration": 180, "intensity_zone": "Z2"},
        {"type": "Cycling - Recovery Spin", "duration": 30, "intensity_zone": "Z1", "optional": True},
    ]},
    {"week": 8, "sessions": [
        {"type": "Cycling - Recovery Ride", "duration": 45, "intensity_zone": "Z1"},
        {"type": "Cycling - Easy Ride", "duration": 55, "intensity_zone": "Z2"},
        {"type": "Cycling - Long Ride", "duration": 120, "intensity_zone": "Z2"},
    ]},
    # === PEAK: Weeks 9–11 ===
    # Longest rides. Simulate gran fondo pace. Hills if applicable.
    {"week": 9, "sessions": [
        {"type": "Cycling - Sweet Spot Intervals", "duration": 65, "intensity_zone": "Z3"},
        {"type": "Cycling - Threshold Efforts", "duration": 55, "intensity_zone": "Z4"},
        {"type": "Cycling - Long Ride", "duration": 225, "intensity_zone": "Z2"},
        {"type": "Cycling - Recovery Spin", "duration": 30, "intensity_zone": "Z1", "optional": True},
    ]},
    {"week": 10, "sessions": [
        {"type": "Cycling - Sweet Spot Intervals", "duration": 70, "intensity_zone": "Z3"},
        {"type": "Cycling - Easy Ride", "duration": 60, "intensity_zone": "Z2"},
        {"type": "Cycling - Long Ride", "duration": 240, "intensity_zone": "Z2"},
    ]},
    {"week": 11, "sessions": [
        {"type": "Cycling - Sweet Spot Intervals", "duration": 60, "intensity_zone": "Z3"},
        {"type": "Cycling - Threshold Efforts", "duration": 50, "intensity_zone": "Z4"},
        {"type": "Cycling - Long Ride", "duration": 210, "intensity_zone": "Z2"},
        {"type": "Cycling - Recovery Spin", "duration": 30, "intensity_zone": "Z1", "optional": True},
    ]},
    # === TAPER + RACE WEEK: Week 12 ===
    {"week": 12, "sessions": [
        {"type": "Cycling - Easy Ride", "duration": 45, "intensity_zone": "Z2"},
        {"type": "Cycling - Activation Efforts", "duration": 35, "intensity_zone": "Z3"},
        {"type": "Race - Gran Fondo 100km", "duration": 210, "intensity_zone": "Z3"},
    ]},
]
