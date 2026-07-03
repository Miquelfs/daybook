OLYMPIC_TRIATHLON_TEMPLATE = [
    # Base Phase
    {"week": 1, "sessions": [
        {"type": "Swimming - Endurance", "duration": 30, "intensity_zone": "Z2"},
        {"type": "Cycling - Easy Ride", "duration": 45, "intensity_zone": "Z2"},
        {"type": "Running - Easy Run", "duration": 30, "intensity_zone": "Z2"},
        {"type": "Swimming - Drills", "duration": 25, "intensity_zone": "Z2", "optional": True},
    ]},
    {"week": 2, "sessions": [
        {"type": "Swimming - Drills", "duration": 35, "intensity_zone": "Z2"},
        {"type": "Cycling - Endurance Ride", "duration": 60, "intensity_zone": "Z2"},
        {"type": "Running - Intervals", "duration": 25, "intensity_zone": "Z4"},
        {"type": "Running - Recovery Run", "duration": 20, "intensity_zone": "Z1", "optional": True},
    ]},
    {"week": 3, "sessions": [
        {"type": "Swimming - Continuous", "duration": 40, "intensity_zone": "Z2"},
        {"type": "Cycling - Tempo Ride", "duration": 50, "intensity_zone": "Z3"},
        {"type": "Running - Long Run", "duration": 45, "intensity_zone": "Z2"},
        {"type": "Swimming - Easy", "duration": 25, "intensity_zone": "Z1", "optional": True},
    ]},
    {"week": 4, "sessions": [
        {"type": "Swimming - Endurance", "duration": 40, "intensity_zone": "Z2"},
        {"type": "Cycling - Brick Ride", "duration": 45, "intensity_zone": "Z2"},
        {"type": "Running - Brick Run", "duration": 25, "intensity_zone": "Z3"},
        {"type": "Running - Easy Run", "duration": 30, "intensity_zone": "Z2", "optional": True},
    ]},
    # Deload
    {"week": 5, "sessions": [
        {"type": "Swimming - Easy", "duration": 30, "intensity_zone": "Z1"},
        {"type": "Cycling - Recovery", "duration": 40, "intensity_zone": "Z1"},
        {"type": "Running - Recovery", "duration": 25, "intensity_zone": "Z1"},
        {"type": "Swimming - Drills", "duration": 20, "intensity_zone": "Z2", "optional": True},
    ]},
    # Build / Intensity
    {"week": 6, "sessions": [
        {"type": "Swimming - Tempo", "duration": 40, "intensity_zone": "Z3"},
        {"type": "Cycling - Intervals", "duration": 50, "intensity_zone": "Z4"},
        {"type": "Running - Long Run", "duration": 50, "intensity_zone": "Z2"},
        {"type": "Running - Strides", "duration": 10, "intensity_zone": "Z3", "optional": True},
        {"type": "Swimming - Easy", "duration": 30, "intensity_zone": "Z1", "optional": True},
    ]},
    {"week": 7, "sessions": [
        {"type": "Swimming - Intervals", "duration": 35, "intensity_zone": "Z4"},
        {"type": "Cycling - Long Ride", "duration": 70, "intensity_zone": "Z2"},
        {"type": "Running - Tempo", "duration": 35, "intensity_zone": "Z3"},
        {"type": "Cycling - Easy Ride", "duration": 45, "intensity_zone": "Z2", "optional": True},
    ]},
    {"week": 8, "sessions": [
        {"type": "Swimming - Continuous", "duration": 45, "intensity_zone": "Z2"},
        {"type": "Cycling - Brick", "duration": 60, "intensity_zone": "Z3"},
        {"type": "Running - Brick Run", "duration": 30, "intensity_zone": "Z3"},
        {"type": "Running - Recovery Run", "duration": 20, "intensity_zone": "Z1", "optional": True},
    ]},
    {"week": 9, "sessions": [
        {"type": "Swimming - Endurance", "duration": 45, "intensity_zone": "Z2"},
        {"type": "Cycling - Intervals", "duration": 60, "intensity_zone": "Z4"},
        {"type": "Running - Long Run", "duration": 60, "intensity_zone": "Z2"},
        {"type": "Swimming - Drills", "duration": 30, "intensity_zone": "Z2", "optional": True},
    ]},
    # Deload
    {"week": 10, "sessions": [
        {"type": "Swimming - Drills", "duration": 30, "intensity_zone": "Z1"},
        {"type": "Cycling - Easy Ride", "duration": 45, "intensity_zone": "Z1"},
        {"type": "Running - Recovery Run", "duration": 30, "intensity_zone": "Z1"},
        {"type": "Swimming - Easy", "duration": 20, "intensity_zone": "Z1", "optional": True},
    ]},
    # Peak
    {"week": 11, "sessions": [
        {"type": "Swimming - Pace Sets", "duration": 40, "intensity_zone": "Z3"},
        {"type": "Cycling - Race Simulation", "duration": 75, "intensity_zone": "Z3"},
        {"type": "Running - Tempo Run", "duration": 40, "intensity_zone": "Z3"},
        {"type": "Cycling - Recovery Spin", "duration": 30, "intensity_zone": "Z1", "optional": True},
    ]},
    {"week": 12, "sessions": [
        {"type": "Swimming - Continuous", "duration": 50, "intensity_zone": "Z2"},
        {"type": "Cycling - Brick", "duration": 70, "intensity_zone": "Z3"},
        {"type": "Running - Goal Pace Run", "duration": 35, "intensity_zone": "Z4"},
        {"type": "Running - Easy Run", "duration": 30, "intensity_zone": "Z2", "optional": True},
    ]},
    # Taper
    {"week": 13, "sessions": [
        {"type": "Swimming - Easy", "duration": 30, "intensity_zone": "Z1"},
        {"type": "Cycling - Recovery", "duration": 40, "intensity_zone": "Z1"},
        {"type": "Running - Easy Run", "duration": 30, "intensity_zone": "Z2"},
    ]},
    # Race Week
    {"week": 14, "sessions": [
        {"type": "Swimming - Race Rehearsal", "duration": 30, "intensity_zone": "Z3"},
        {"type": "Cycling - Short Ride", "duration": 40, "intensity_zone": "Z2"},
        {"type": "Race - Olympic Triathlon", "duration": 120, "intensity_zone": "Z4"},
    ]},
]
