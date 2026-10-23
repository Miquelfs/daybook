"""
How much money is in the portfolio, as opposed to what it's worth.

For each snapshot date: the units held that day × what was paid per unit
(the holding's average cost). The line steps up when you buy and down when you
sell, so worth − invested is pure market growth.

Average cost per unit comes from the holding (cost_basis_eur / quantity); for a
fully sold holding, from its realized trades. A holding with no known cost counts
at its market value — no gain or loss rather than an invented one.
"""

import sqlite3


def unit_costs(conn: sqlite3.Connection) -> dict[str, float]:
    costs: dict[str, float] = {}
    for r in conn.execute("SELECT id, quantity, cost_basis_eur FROM holdings"):
        if r[1] and r[1] > 0 and r[2]:
            costs[r[0]] = r[2] / r[1]
    try:
        for r in conn.execute(
            """SELECT holding_id, SUM(cost_basis_sold_eur), SUM(quantity) FROM realized_trades
               WHERE cost_basis_sold_eur IS NOT NULL GROUP BY holding_id"""
        ):
            if r[0] not in costs and r[2]:
                costs[r[0]] = r[1] / r[2]
    except sqlite3.OperationalError:
        pass  # no sales recorded yet
    return costs


def by_date(conn: sqlite3.Connection, since: str = "1900-01-01") -> dict[str, tuple[float, float]]:
    """{date: (worth, invested)} for every snapshot date on or after `since`."""
    costs = unit_costs(conn)
    out: dict[str, list[float]] = {}
    for d, hid, qty, value in conn.execute(
        "SELECT date, holding_id, quantity, value_eur FROM holding_snapshots WHERE date >= ? ORDER BY date",
        (since,),
    ):
        acc = out.setdefault(d, [0.0, 0.0])
        acc[0] += value or 0.0
        acc[1] += qty * costs[hid] if hid in costs else (value or 0.0)
    return {d: (round(w, 2), round(i, 2)) for d, (w, i) in out.items()}
