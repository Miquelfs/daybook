"""
Taiwan by bike, 10–18 Nov 2026 — loaded from "Taiwan-Trip-and-Logistics.pdf"
(Draft 1, 22 Oct 2026): itinerary + where you sleep, open decisions, checklist
by phase, packing list, budget (NT$, €1 = NT$36), logistics notes, risks.
Routes and the training impact live elsewhere (training / race plan).

Uses the planned trip whose name contains "Taiwan" (or creates one). Idempotent:
only fills what's empty and skips anything already there — your edits win.

On the Pi: python -m domains.plans.trip_imports.taiwan_2026
"""

from __future__ import annotations

import sqlite3

from domains.plans import planned_trips as pt

START, END = "2026-11-10", "2026-11-18"

# date, kind, plan, sleep, est NT$
DAYS = [
    ("2026-11-10", "travel", "Fly Palma (PMI) → Taipei (TPE); you land on Wed 11 Nov", "In the air", None),
    ("2026-11-11", "rest", "Land in Taipei, collect the bike at Mathew Bike (Shilin), dinner at Shilin night market",
     "Taipei", 2300),
    ("2026-11-12", "ride", "Day 1 · Taipei → Nan'ao · 130 km · +1,786 m · start 06:30", "Nan'ao", 1800),
    ("2026-11-13", "ride", "Day 2 · Nan'ao → Hualien · 70 km · +1,044 m · plan B: train Nan'ao → Hualien (~1 h)",
     "Hualien", 2200),
    ("2026-11-14", "ride", "Day 3 · Hualien → Chishang · 118 km · +670 m", "Chishang", 1500),
    ("2026-11-15", "ride", "Day 4 · Chishang → south Taitung · 69 km · +537 m · ends ~10 km from Day 5's start",
     "Taitung", 1500),
    ("2026-11-16", "ride", "Day 5 · Taitung → Chenggong · 55 km · +355 m · easy day", "Chenggong", 1600),
    ("2026-11-17", "ride", "Day 6 · Chenggong → Hualien · 115 km · +960 m, then evening train to Taipei with the bike",
     "Taipei", 2300),
    ("2026-11-18", "travel", "Return the bike at Mathew Bike, Taipei day, airport by ~20:30, fly 23:45", None, None),
]

DECISIONS = [
    "Do the tunnels on Day 1 (km 121–123) and Day 2 (km 34–37, 40–42) allow bikes — or re-route onto the old "
    "coastal road? Plan B is the Nan'ao → Hualien train.",
    "Where to sleep on 15 Nov: near Day 4's end or in central Taitung, where Day 5 starts?",
    "Is there a bike space on the Hualien → Taipei train on 17 Nov? If not: bike bag or Mathew's shipping service?",
]

# risk, where, what to do
RISKS = [
    ("Tunnels that may ban bikes, plus heavy trucks", "Day 1 km 121–123 · Day 2 km 34–37, 40–42",
     "Check the course on the map, ride the old coastal road or take the Nan'ao → Hualien train; lights and "
     "hi-vis; stop to let trucks pass"),
    ("Headwind", "Days 5 and 6 (northbound)", "Start early, keep Day 5 easy, accept slower Day 6 speeds"),
    ("Rain or storm", "Any day, mostly the east coast",
     "Check the Central Weather Administration forecast; Day 5 is your buffer"),
    ("Short daylight", "All days (sunset ~17:10)", "Start by 06:30 on Day 1 and by 07:00 on Day 6"),
    ("No bike space on the train", "Tue 17 Nov", "Book early; fallback is a bike bag or Mathew's shipping service"),
    ("Late flight home", "Wed 18 Nov", "Return the bike in the morning; leave for the airport by ~20:00"),
]

PACKING = {
    "Bike and safety": [
        "Helmet", "Pedals and shoes (if the rental allows)",
        "Front and rear USB lights, flashing rear for tunnels", "High-vis vest or jacket for the Suhua tunnels",
        "Two spare tubes, tyre levers, mini pump, patch kit, multitool, quick-link",
        "Garmin, cable and the GPX files backed up on the phone",
    ],
    "Care": ["Sun cream and chamois cream (≤100 ml each)", "Electrolyte tablets and snacks",
             "Small first-aid and blister kit"],
    "Clothing": ["Two cycling kits and one casual outfit", "Arm and leg warmers", "Packable breathable rain jacket",
                 "Light gilet and light long-finger gloves", "Three pairs of socks",
                 "Swimwear and sandals for hot springs and beaches", "Cap and sunglasses"],
    "Tech and money": ["Power bank (cabin) and a Type A/B adapter (110 V)",
                       "eSIM, offline maps and an offline translator",
                       "Some TWD cash and a transit card", "Dry bags for the panniers, waterproof pouch for phone and passport"],
    "Documents": ["Passport and a screenshot of the online arrival card",
                  "Insurance policy with cycling and rental-bike cover", "Mathew Bike booking and deposit receipt",
                  "Flight, hotel and train confirmations saved offline"],
}

# section, title, detail
INFO = [
    ("Flights and entry", "Flights", "Palma → Taipei Tue 10 Nov · Taipei → Palma Wed 18 Nov 23:45 · about €300 return. "
     "Be at the airport ~3 h before; airport MRT from Taipei ~35–40 min."),
    ("Flights and entry", "Entry", "Spanish passport: visa-free up to 90 days; complete the online arrival card before "
     "travelling. Confirm the passport-validity rule on the official immigration site."),
    ("Flights and entry", "Insurance", "Check it covers cycling, medical costs and damage to or loss of the rented bike."),
    ("Flights and entry", "Phone", "eSIM before you fly; offline maps and the GPX files from Garmin Connect."),
    ("Mathew Bike", "Pickup and return", "No. 577, Wenlin Road, Shilin, Taipei · (02) 2832-2238 · pickup Wed 11 Nov, "
     "return Wed 18 Nov"),
    ("Mathew Bike", "Bike options", "Froging touring NT$700/day (15-day NT$6,000) · 27-gear flat-bar road NT$500/day "
     "(NT$4,300) · RIKULAU stainless flat-bar road NT$1,000/day (NT$7,500). For 8 days ≈ NT$5,600 / 4,000 / 8,000"),
    ("Mathew Bike", "Terms", "NT$1,000 deposit in advance for round-island rentals, ID as collateral, free 30-min test "
     "ride, free round-island route map"),
    ("Mathew Bike", "Ask them", "Rack and panniers included? Pickup time on 11 Nov and return hours on 18 Nov? A bike "
     "bag for the train? Which bike for tunnels and long days (lights, tyre width)? Shipping price?"),
    ("Trains with the bike", "Hualien → Taipei · Tue 17 Nov, evening", "About 2–3 h. Unbagged bikes only on designated "
     "bicycle-friendly trains with a half-fare bike ticket, limited spaces; Puyuma and Taroko need a fully bagged "
     "bike. Book first."),
    ("Trains with the bike", "Nan'ao → Hualien (plan B) · Fri 13 Nov", "About 1 h. Same rules; book a bike space the "
     "day before at the latest."),
    ("Trains with the bike", "Fallbacks for 17 Nov", "A bike bag (ask Mathew), Mathew's shipping service, or a "
     "different train time."),
    ("Useful numbers", "Emergency", "119 ambulance and fire · 110 police"),
    ("Useful numbers", "Mathew Bike", "(02) 2832-2238"),
    ("Useful numbers", "Road status and weather", "Highway Bureau live road info (168.thb.gov.tw) · Central Weather "
     "Administration"),
    ("Useful numbers", "Trains", "Taiwan Railway bicycle-friendly train rules and the bicycle seat search on its website"),
]

# line, low, mid, high (NT$)
BUDGET = [
    ("Bike rental, 8 days", 4000, 5600, 8000),
    ("Accommodation, 7 nights", 9800, 13200, 20000),
    ("Food and drink, 8 days", 6400, 9600, 14400),
    ("Train home with the bike, airport and metro", 1000, 1200, 1800),
    ("Repair kit, small gear", 500, 800, 1200),
    ("Sightseeing and entries", 500, 1500, 3000),
    ("eSIM and miscellaneous", 1000, 2000, 3000),
]

# Checklist by phase → due date (Now · within two weeks · final week)
CHECKLIST = {
    "2026-10-26": ["Confirm bike model, rack and panniers with Mathew Bike",
                   "Ask Mathew Bike about pickup on 11 Nov and return hours on 18 Nov",
                   "Book a bike space on the Hualien → Taipei train for 17 Nov",
                   "Book hotels, starting with Nan'ao, Hualien and Chishang",
                   "Buy travel insurance with cycling cover"],
    "2026-11-03": ["Complete the online arrival card",
                   "Buy the eSIM; download offline maps",
                   "Load the six GPX files on the Garmin and phone",
                   "Book the Nan'ao → Hualien bike space as plan B",
                   "Check the course on a map at the tunnel locations"],
    "2026-11-08": ["Check the weather and typhoon warnings",
                   "Re-check the 17 Nov train booking",
                   "Pack to about 8 kg and weigh the bag",
                   "Photograph passport, bike receipt and bookings",
                   "Charge lights, Garmin and power bank"],
}


def run(conn: sqlite3.Connection) -> dict:
    row = conn.execute("""SELECT id FROM planned_trips WHERE name LIKE '%Taiwan%'
                          ORDER BY ABS(julianday(start_date) - julianday(?)) LIMIT 1""", (START,)).fetchone()
    if row:
        pid = row[0]
    else:
        pid = pt.save(conn, {"name": "Taiwan by bike", "start_date": START, "end_date": END}, [])
    trip = dict(conn.execute("SELECT * FROM planned_trips WHERE id=?", (pid,)).fetchone())
    fill = {k: v for k, v in {"destination": "Taiwan", "currency": "TWD", "fx_rate": 36.0, "flights_eur": 300.0,
                              "start_date": START, "end_date": END}.items() if not trip.get(k)}
    if fill:
        pt.save(conn, fill, None, pid)

    added = {"days": 0, "items": 0, "budget": 0, "tasks": 0}
    for d, kind, plan, sleep, cost in DAYS:
        cur = conn.execute("SELECT * FROM planned_trip_days WHERE planned_id=? AND date=?", (pid, d)).fetchone()
        cur = dict(cur) if cur else {}
        fields = {k: v for k, v in {"kind": kind, "note": plan, "sleep": sleep, "sleep_cost": cost}.items()
                  if v is not None and not cur.get(k)}
        if fields:
            pt.set_day(conn, pid, d, fields)
            added["days"] += 1

    have = {(r[0], r[1]) for r in conn.execute("SELECT kind, title FROM planned_trip_items WHERE planned_id=?", (pid,))}

    def item(kind, title, section=None, detail=None):
        if (kind, title) not in have:
            pt.add_item(conn, pid, kind, title, section, detail)
            added["items"] += 1

    for q in DECISIONS:
        item("decision", q)
    for risk, where, todo in RISKS:
        item("risk", risk, where, todo)
    for section, things in PACKING.items():
        for t in things:
            item("pack", t, section)
    for section, title, detail in INFO:
        item("info", title, section, detail)

    lines = {r[0] for r in conn.execute("SELECT line FROM planned_trip_budget WHERE planned_id=?", (pid,))}
    for line, low, mid, high in BUDGET:
        if line not in lines:
            pt.add_budget_line(conn, pid, {"line": line, "low": low, "mid": mid, "high": high})
            added["budget"] += 1

    titles = {r[0] for r in conn.execute("SELECT title FROM tasks WHERE planned_trip_id=?", (pid,))}
    for due, todos in CHECKLIST.items():
        for t in todos:
            if t not in titles:
                conn.execute("INSERT INTO tasks (title, due_date, area, planned_trip_id) VALUES (?, ?, 'travel', ?)",
                             (t, due, pid))
                added["tasks"] += 1
    conn.commit()
    return {"planned_id": pid, **added}


if __name__ == "__main__":
    from infrastructure.db.connection import get_connection
    from infrastructure.db.migrate_plans import migrate
    c = get_connection()
    migrate(c)
    print(run(c))
    c.close()
