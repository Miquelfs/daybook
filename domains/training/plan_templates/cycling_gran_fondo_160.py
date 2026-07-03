"""
Gran Fondo 160km / Century Ride — 16 weeks.
No power meter required. Zones expressed in HR % and RPE.
Zone guide: Z1 <55% max HR / RPE 1-3, Z2 56-75% / RPE 4-5,
            Z3 76-90% / RPE 6-7, Z4 91-105% / RPE 8-9, Z5 >105% / RPE 10.
Long ride builds to 130km (80% of event distance) at Week 12.
"""

CYCLING_GRAN_FONDO_160_TEMPLATE = [
    # === BASE: Weeks 1–5 ===
    {"week": 1, "sessions": [
        {"type": "Cycling - Easy Ride", "duration": 60, "intensity_zone": "Z2"},
        {"type": "Cycling - Easy Ride", "duration": 50, "intensity_zone": "Z2"},
        {"type": "Cycling - Long Ride", "duration": 90, "intensity_zone": "Z2"},
    ]},
    {"week": 2, "sessions": [
        {"type": "Cycling - Easy Ride", "duration": 60, "intensity_zone": "Z2"},
        {"type": "Cycling - Sweet Spot Intervals", "duration": 50, "intensity_zone": "Z3"},
        {"type": "Cycling - Long Ride", "duration": 105, "intensity_zone": "Z2"},
        {"type": "Cycling - Recovery Spin", "duration": 30, "intensity_zone": "Z1", "optional": True},
    ]},
    {"week": 3, "sessions": [
        {"type": "Cycling - Easy Ride", "duration": 60, "intensity_zone": "Z2"},
        {"type": "Cycling - Sweet Spot Intervals", "duration": 55, "intensity_zone": "Z3"},
        {"type": "Cycling - Long Ride", "duration": 120, "intensity_zone": "Z2"},
    ]},
    {"week": 4, "sessions": [
        {"type": "Cycling - Easy Ride", "duration": 60, "intensity_zone": "Z2"},
        {"type": "Cycling - Sweet Spot Intervals", "duration": 55, "intensity_zone": "Z3"},
        {"type": "Cycling - Long Ride", "duration": 135, "intensity_zone": "Z2"},
        {"type": "Cycling - Recovery Spin", "duration": 30, "intensity_zone": "Z1", "optional": True},
    ]},
    {"week": 5, "sessions": [
        {"type": "Cycling - Recovery Ride", "duration": 45, "intensity_zone": "Z1"},
        {"type": "Cycling - Easy Ride", "duration": 55, "intensity_zone": "Z2"},
        {"type": "Cycling - Long Ride", "duration": 105, "intensity_zone": "Z2"},
    ]},
    # === BUILD: Weeks 6–10 ===
    {"week": 6, "sessions": [
        {"type": "Cycling - Sweet Spot Intervals", "duration": 60, "intensity_zone": "Z3"},
        {"type": "Cycling - Easy Ride", "duration": 60, "intensity_zone": "Z2"},
        {"type": "Cycling - Long Ride", "duration": 165, "intensity_zone": "Z2"},
    ]},
    {"week": 7, "sessions": [
        {"type": "Cycling - Sweet Spot Intervals", "duration": 65, "intensity_zone": "Z3"},
        {"type": "Cycling - Threshold Efforts", "duration": 50, "intensity_zone": "Z4"},
        {"type": "Cycling - Long Ride", "duration": 180, "intensity_zone": "Z2"},
        {"type": "Cycling - Recovery Spin", "duration": 30, "intensity_zone": "Z1", "optional": True},
    ]},
    {"week": 8, "sessions": [
        {"type": "Cycling - Sweet Spot Intervals", "duration": 65, "intensity_zone": "Z3"},
        {"type": "Cycling - Easy Ride", "duration": 60, "intensity_zone": "Z2"},
        {"type": "Cycling - Long Ride", "duration": 210, "intensity_zone": "Z2"},
    ]},
    {"week": 9, "sessions": [
        {"type": "Cycling - Recovery Ride", "duration": 45, "intensity_zone": "Z1"},
        {"type": "Cycling - Easy Ride", "duration": 55, "intensity_zone": "Z2"},
        {"type": "Cycling - Long Ride", "duration": 150, "intensity_zone": "Z2"},
    ]},
    {"week": 10, "sessions": [
        {"type": "Cycling - Sweet Spot Intervals", "duration": 70, "intensity_zone": "Z3"},
        {"type": "Cycling - Threshold Efforts", "duration": 55, "intensity_zone": "Z4"},
        {"type": "Cycling - Long Ride", "duration": 225, "intensity_zone": "Z2"},
        {"type": "Cycling - Recovery Spin", "duration": 30, "intensity_zone": "Z1", "optional": True},
    ]},
    # === PEAK: Weeks 11–14 ===
    # Long ride peaks at week 12 (~130km equivalent duration ~5h).
    {"week": 11, "sessions": [
        {"type": "Cycling - Sweet Spot Intervals", "duration": 70, "intensity_zone": "Z3"},
        {"type": "Cycling - Easy Ride", "duration": 60, "intensity_zone": "Z2"},
        {"type": "Cycling - Long Ride", "duration": 255, "intensity_zone": "Z2"},
    ]},
    {"week": 12, "sessions": [
        {"type": "Cycling - Sweet Spot Intervals", "duration": 70, "intensity_zone": "Z3"},
        {"type": "Cycling - Threshold Efforts", "duration": 55, "intensity_zone": "Z4"},
        {"type": "Cycling - Long Ride", "duration": 285, "intensity_zone": "Z2"},
        {"type": "Cycling - Recovery Spin", "duration": 35, "intensity_zone": "Z1", "optional": True},
    ]},
    {"week": 13, "sessions": [
        {"type": "Cycling - Sweet Spot Intervals", "duration": 65, "intensity_zone": "Z3"},
        {"type": "Cycling - Easy Ride", "duration": 60, "intensity_zone": "Z2"},
        {"type": "Cycling - Long Ride", "duration": 255, "intensity_zone": "Z2"},
    ]},
    {"week": 14, "sessions": [
        {"type": "Cycling - Sweet Spot Intervals", "duration": 60, "intensity_zone": "Z3"},
        {"type": "Cycling - Threshold Efforts", "duration": 50, "intensity_zone": "Z4"},
        {"type": "Cycling - Long Ride", "duration": 225, "intensity_zone": "Z2"},
        {"type": "Cycling - Recovery Spin", "duration": 30, "intensity_zone": "Z1", "optional": True},
    ]},
    # === TAPER: Week 15 ===
    {"week": 15, "sessions": [
        {"type": "Cycling - Easy Ride", "duration": 60, "intensity_zone": "Z2"},
        {"type": "Cycling - Sweet Spot Intervals", "duration": 45, "intensity_zone": "Z3"},
        {"type": "Cycling - Long Ride", "duration": 150, "intensity_zone": "Z2"},
    ]},
    # === RACE WEEK: Week 16 ===
    {"week": 16, "sessions": [
        {"type": "Cycling - Easy Ride", "duration": 45, "intensity_zone": "Z2"},
        {"type": "Cycling - Activation Efforts", "duration": 35, "intensity_zone": "Z3"},
        {"type": "Race - Gran Fondo 160km", "duration": 330, "intensity_zone": "Z3"},
    ]},
]
