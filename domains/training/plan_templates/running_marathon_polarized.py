RUNNING_MARATHON_POLARIZED_TEMPLATE = [
    # Weeks 1–4: Base Endurance Phase
    {"week": 1, "sessions": [
        {"type": "Running - Easy Run", "duration": 40, "intensity_zone": "Z2"},
        {"type": "Running - Intervals", "duration": 20, "intensity_zone": "Z5"},
        {"type": "Running - Long Run", "duration": 60, "intensity_zone": "Z2"},
        {"type": "Running - Recovery Run", "duration": 25, "intensity_zone": "Z1", "optional": True},
        {"type": "Running - Strides", "duration": 10, "intensity_zone": "Z3", "optional": True},
    ]},
    {"week": 2, "sessions": [
        {"type": "Running - Easy Run", "duration": 45, "intensity_zone": "Z2"},
        {"type": "Running - Intervals", "duration": 25, "intensity_zone": "Z5"},
        {"type": "Running - Long Run", "duration": 75, "intensity_zone": "Z2"},
        {"type": "Running - Drills & Form", "duration": 15, "intensity_zone": "Z2", "optional": True},
    ]},
    {"week": 3, "sessions": [
        {"type": "Running - Easy Run", "duration": 50, "intensity_zone": "Z2"},
        {"type": "Running - Hill Repeats", "duration": 20, "intensity_zone": "Z5"},
        {"type": "Running - Long Run", "duration": 90, "intensity_zone": "Z2"},
        {"type": "Running - Recovery Run", "duration": 25, "intensity_zone": "Z1", "optional": True},
    ]},
    {"week": 4, "sessions": [
        {"type": "Running - Easy Run", "duration": 55, "intensity_zone": "Z2"},
        {"type": "Running - Intervals", "duration": 25, "intensity_zone": "Z5"},
        {"type": "Running - Long Run", "duration": 100, "intensity_zone": "Z2"},
        {"type": "Running - Easy Run", "duration": 40, "intensity_zone": "Z2", "optional": True},
    ]},
    # Deload
    {"week": 5, "sessions": [
        {"type": "Running - Recovery Run", "duration": 25, "intensity_zone": "Z1"},
        {"type": "Running - Easy Run", "duration": 35, "intensity_zone": "Z2"},
        {"type": "Running - Long Run", "duration": 75, "intensity_zone": "Z2"},
        {"type": "Running - Strides", "duration": 10, "intensity_zone": "Z3", "optional": True},
    ]},
    # Load Progression
    {"week": 6, "sessions": [
        {"type": "Running - Intervals", "duration": 30, "intensity_zone": "Z5"},
        {"type": "Running - Easy Run", "duration": 50, "intensity_zone": "Z2"},
        {"type": "Running - Long Run", "duration": 105, "intensity_zone": "Z2"},
        {"type": "Running - Recovery Run", "duration": 30, "intensity_zone": "Z1", "optional": True},
    ]},
    {"week": 7, "sessions": [
        {"type": "Running - Easy Run", "duration": 55, "intensity_zone": "Z2"},
        {"type": "Running - Intervals", "duration": 35, "intensity_zone": "Z5"},
        {"type": "Running - Long Run", "duration": 115, "intensity_zone": "Z2"},
        {"type": "Running - Drills & Form", "duration": 15, "intensity_zone": "Z2", "optional": True},
    ]},
    {"week": 8, "sessions": [
        {"type": "Running - Easy Run", "duration": 60, "intensity_zone": "Z2"},
        {"type": "Running - Hill Repeats", "duration": 30, "intensity_zone": "Z5"},
        {"type": "Running - Long Run", "duration": 120, "intensity_zone": "Z2"},
        {"type": "Running - Strides", "duration": 15, "intensity_zone": "Z3", "optional": True},
    ]},
    {"week": 9, "sessions": [
        {"type": "Running - Easy Run", "duration": 60, "intensity_zone": "Z2"},
        {"type": "Running - Intervals", "duration": 40, "intensity_zone": "Z5"},
        {"type": "Running - Long Run", "duration": 125, "intensity_zone": "Z2"},
        {"type": "Running - Recovery Run", "duration": 30, "intensity_zone": "Z1", "optional": True},
    ]},
    # Deload
    {"week": 10, "sessions": [
        {"type": "Running - Recovery Run", "duration": 30, "intensity_zone": "Z1"},
        {"type": "Running - Easy Run", "duration": 40, "intensity_zone": "Z2"},
        {"type": "Running - Long Run", "duration": 90, "intensity_zone": "Z2"},
        {"type": "Running - Drills & Form", "duration": 15, "intensity_zone": "Z2", "optional": True},
    ]},
    # Peak
    {"week": 11, "sessions": [
        {"type": "Running - Easy Run", "duration": 65, "intensity_zone": "Z2"},
        {"type": "Running - Intervals", "duration": 40, "intensity_zone": "Z5"},
        {"type": "Running - Long Run", "duration": 135, "intensity_zone": "Z2"},
        {"type": "Running - Easy Run", "duration": 45, "intensity_zone": "Z2", "optional": True},
    ]},
    {"week": 12, "sessions": [
        {"type": "Running - Easy Run", "duration": 60, "intensity_zone": "Z2"},
        {"type": "Running - Intervals", "duration": 35, "intensity_zone": "Z5"},
        {"type": "Running - Long Run", "duration": 130, "intensity_zone": "Z2"},
        {"type": "Running - Recovery Run", "duration": 25, "intensity_zone": "Z1", "optional": True},
    ]},
    {"week": 13, "sessions": [
        {"type": "Running - Goal Pace Run", "duration": 50, "intensity_zone": "Z4"},
        {"type": "Running - Intervals", "duration": 45, "intensity_zone": "Z5"},
        {"type": "Running - Long Run", "duration": 140, "intensity_zone": "Z2"},
    ]},
    {"week": 14, "sessions": [
        {"type": "Running - Easy Run", "duration": 40, "intensity_zone": "Z2"},
        {"type": "Running - Tempo", "duration": 40, "intensity_zone": "Z4"},
        {"type": "Running - Long Run", "duration": 145, "intensity_zone": "Z2"},
    ]},
    # Taper
    {"week": 15, "sessions": [
        {"type": "Running - Recovery Run", "duration": 30, "intensity_zone": "Z1"},
        {"type": "Running - Easy Run", "duration": 40, "intensity_zone": "Z2"},
        {"type": "Running - Long Run", "duration": 90, "intensity_zone": "Z2"},
        {"type": "Running - Strides", "duration": 10, "intensity_zone": "Z3", "optional": True},
    ]},
    # Race Week
    {"week": 16, "sessions": [
        {"type": "Running - Recovery Run", "duration": 20, "intensity_zone": "Z1"},
        {"type": "Running - Race Simulation", "duration": 30, "intensity_zone": "Z4"},
        {"type": "Race - Marathon", "duration": 180, "intensity_zone": "Z4"},
    ]},
]
