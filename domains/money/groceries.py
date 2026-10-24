"""
Grocery analytics over parsed tickets (receipts + receipt_items in money.db).

Products are identified by the name exactly as the ticket prints it — Mercadona
prints the same string every time, so "QUESO GRANA PADANO" on two tickets is the
same product and its price can be tracked.

Each product gets a type (Dairy & eggs, Sweets & snacks, …) and an "avoid" flag
from keyword rules below; the user can override either per product
(grocery_products). Rules are applied at read time, so improving a rule fixes
every past ticket too.
"""

import re
import sqlite3
import unicodedata
from datetime import date, timedelta

GROUPS = [
    "Fruit & veg", "Meat & fish", "Dairy & eggs", "Bakery", "Pantry",
    "Frozen & ready", "Sweets & snacks", "Drinks", "Household", "Personal care", "Other",
]
NON_FOOD = {"Household", "Personal care"}

# (pattern, group) — first match wins, so specific rules go before broad ones.
# Patterns match at a word start on the accent-stripped, upper-case name.
_RULES: list[tuple[str, str]] = [
    (r"BOLSA|BASURA|SUAVIZANTE|DETERGENTE|LAVAVAJILLAS|RECIPIENTE|PAPEL|PANUELO|SERVILLETA|"
     r"ESTROPAJO|LEJIA|FREGASUELOS|LIMPIA|AMBIENTADOR|ALUMINIO|FILM\b|PILAS?\b|BAYETA|VELA", "Household"),
    (r"GEL\b|CHAMPU|DESODORANTE|CR\. DEPIL|DEPIL|CUCHILLA|AFEITAR|SOLUCION UNICA|DENTI|PASTA DENTAL|"
     r"CEPILLO|COMPRESA|JABON|COLONIA|MAQUINILLA|HIGIENICO|CREMA (CORPORAL|FACIAL|SOLAR)", "Personal care"),
    (r"DOCHI|CHEESECAKE|GALLETA|LLAVES|CARAMELO|CHOCO|RODITA|BARRITA|GOMINOLA|REGALIZ|HELADO|BOMBON|"
     r"DONUT|MAGDALENA|BIZCOCHO|CHIPS|NACHOS|PALOMITAS|TURRON|NOCILLA|GUSANITOS|SNACK|TARTA|PASTEL|"
     r"GOFRE|MOUSSE|NATILLAS|FLAN\b|CREMA CACAO|PATATAS FRITAS|CHUCHE", "Sweets & snacks"),
    (r"COLA\b|REFRESCO|TEA\b|TE\b|AGUA\b|CERVEZA|VINO\b|ZUMO|NECTAR|BEBIDA|CAFE|ISOTONIC|TONICA|"
     r"GASEOSA|KOMBUCHA|LIMONADA|HORCHATA|NARANJADA", "Drinks"),
    (r"NOQUIS|TOM\.|TOMATE (FRITO|TRITURADO)", "Pantry"),
    (r"AGUACATE|MANDARINA|BROCOLI|CEBOLLA|APIO|PERA\b|CHAMPINON|PIMIENTO|TOMATE|LECHUGA|ENSALADA|"
     r"ESPINACA|ZANAHORIA|PATATA|PLATANO|MANZANA|NARANJA|LIMON|FRESA|UVA\b|KIWI|MELON|SANDIA|PINA\b|"
     r"MELOCOTON|CALABACIN|BERENJENA|PEPINO|AJO\b|PUERRO|CALABAZA|JUDIA|COLIFLOR|BONIATO|RUCULA|"
     r"CANONIGO|ARANDANO|FRAMBUESA|MANGO|CEREZA|ALCACHOFA|ESPARRAGO|SETA|NECTARINA|CIRUELA|"
     r"GRANADA|BANANA|HIERBABUENA|PEREJIL|CILANTRO|ALBAHACA", "Fruit & veg"),
    (r"PIZZA|SALTEADO|CONG|LASANA|CROQUETA|NUGGET|EMPANADA|TORTILLA|GUACAMOLE|HUMMUS|GAZPACHO|"
     r"SALMOREJO|SANDWICH|WRAP|SUSHI|CANELON|POKE|PLATO", "Frozen & ready"),
    (r"MUSLO|BUTIFARRA|BURGER|HAMBURGUESA|BACON|POLLO|PECHUGA|SOLOMILLO|FILETE|JAMON|LOMO|CHORIZO|"
     r"SALCHICHA|PAVO|TERNERA|CERDO|CORDERO|CARNE|PICADA|COSTILLA|SALMON|ATUN|MERLUZA|BACALAO|GAMBA|"
     r"LANGOSTINO|MEJILLON|SEPIA|CALAMAR|SARDINA|DORADA|LUBINA|FUET|SOBRASADA|SALAMI|PEPPERONI|"
     r"ALBONDIGA|CONTRAMUSLO|ALITA|SECRETO|PANCETA", "Meat & fish"),
    (r"GRIEGO|YOGUR|QUESO|LECHE|HUEVO|MANTEQUILLA|NATA\b|KEFIR|SKYR|REQUESON|MOZZARELLA|BURRATA", "Dairy & eggs"),
    (r"PAN\b|PULGUITA|BARRA|BAGUETTE|CHAPATA|TOSTADA|TORTITA|PITA\b|CROISSANT|PICOS|REGANA|BOLLO", "Bakery"),
    (r"PASTA|ESPAGUETI|MACARRON|ARROZ|GARBANZO|LENTEJA|ALUBIA|SALSA|ACEITE|VINAGRE|SAL\b|HARINA|"
     r"AVENA|CEREAL|MUESLI|CONSERVA|CALDO|ESPECIA|PIMIENTA|OREGANO|MAYONESA|KETCHUP|MOSTAZA|MIEL|"
     r"MERMELADA|NUEZ|NUECES|ALMENDRA|CACAHUETE|ACEITUNA|MAIZ|QUINOA|COUSCOUS|FIDEO|NOODLE|SOJA|"
     r"AZUCAR|LEVADURA", "Pantry"),
]
_COMPILED = [(re.compile(r"\b(?:" + p + r")"), g) for p, g in _RULES]

# Sugary on top of everything in Sweets & snacks: added sugar, sugary soft drinks,
# instant tea (a sugar mix).
_AVOID = re.compile(r"(?<!SIN )\bAZUCAR|\bCOLA\b(?!.*\b(ZERO|LIGHT)\b)|\bREFRESCO|\bNARANJADA|\bTEA SOLUBLE")


def _norm(name: str) -> str:
    s = unicodedata.normalize("NFKD", name.upper())
    return "".join(c for c in s if not unicodedata.combining(c))


def rule_group(product: str) -> str:
    n = _norm(product)
    return next((g for rx, g in _COMPILED if rx.search(n)), "Other")


def rule_avoid(product: str, group: str | None = None) -> bool:
    group = group or rule_group(product)
    return group == "Sweets & snacks" or bool(_AVOID.search(_norm(product)))


def display_name(product: str) -> str:
    """'QUESO GRANA PADANO' → 'Queso grana padano'."""
    s = product.strip().lower()
    return s[:1].upper() + s[1:]


def overrides(conn: sqlite3.Connection) -> dict[str, sqlite3.Row]:
    return {r["product"]: r for r in conn.execute("SELECT product, grp, avoid FROM grocery_products")}


def classify(product: str, overrides: dict) -> tuple[str, bool]:
    """Effective (group, avoid): the user's override wins over the rules."""
    o = overrides.get(product)
    group = (o["grp"] if o and o["grp"] else None) or rule_group(product)
    avoid = bool(o["avoid"]) if o and o["avoid"] is not None else rule_avoid(product, group)
    return group, avoid


def _items(conn: sqlite3.Connection, start: str | None = None, receipt_id: int | None = None) -> list[sqlite3.Row]:
    """Every item on a live (not deleted) transaction's ticket, oldest first."""
    sql = """
        SELECT i.product, i.quantity, i.weight_kg, i.unit_price, i.amount,
               t.date, r.id AS receipt_id, r.store, g.generic, g.pack_g
        FROM receipt_items i
        JOIN receipts r     ON r.id = i.receipt_id
        JOIN transactions t ON t.id = r.transaction_id AND t.deleted_at IS NULL
        LEFT JOIN grocery_products g ON g.product = i.product
    """
    where, params = [], []
    if start:
        where.append("t.date >= ?")
        params.append(start)
    if receipt_id is not None:
        where.append("r.id = ?")
        params.append(receipt_id)
    if where:
        sql += " WHERE " + " AND ".join(where)
    return conn.execute(sql + " ORDER BY t.date, r.id, i.line_no", params).fetchall()


def unit_price(row) -> float:
    """€/kg for loose produce, € per unit otherwise."""
    if row["weight_kg"]:
        return row["unit_price"]
    return row["unit_price"] if row["unit_price"] is not None else row["amount"] / (row["quantity"] or 1)


WINDOWS = ("ticket", "week", "month", "3m", "12m")


def _months_start(today: date, months: int) -> str:
    y, m = today.year, today.month - (months - 1)
    while m < 1:
        y, m = y - 1, m + 12
    return f"{y:04d}-{m:02d}-01"


def _window(conn: sqlite3.Connection, window: str, today: date) -> tuple[str, int | None]:
    """(start date, receipt id for "ticket" else None)."""
    if window == "ticket":
        last = conn.execute("""
            SELECT r.id, t.date FROM receipts r
            JOIN transactions t ON t.id = r.transaction_id AND t.deleted_at IS NULL
            ORDER BY t.date DESC, r.id DESC LIMIT 1
        """).fetchone()
        return (last["date"], last["id"]) if last else (today.isoformat(), -1)
    if window == "week":
        return (today - timedelta(days=6)).isoformat(), None
    return _months_start(today, {"month": 1, "3m": 3, "12m": 12}[window]), None


def summary(conn: sqlite3.Connection, window: str = "3m", today: date | None = None) -> dict:
    """Spend by type and the avoid-list over a window: the last ticket, the last
    7 days, or the last 1 / 3 / 12 calendar months."""
    today = today or date.today()
    start, receipt_id = _window(conn, window, today)

    ov = overrides(conn)
    rows = _items(conn, start, receipt_id)
    total = sum(r["amount"] for r in rows)
    by_group: dict[str, float] = {}
    avoid: dict[str, dict] = {}
    per_month: dict[str, dict] = {}
    receipts = set()
    for r in rows:
        group, is_avoid = classify(r["product"], ov)
        by_group[group] = by_group.get(group, 0) + r["amount"]
        pm = per_month.setdefault(r["date"][:7], {"month": r["date"][:7], "total": 0.0, "avoid": 0.0})
        pm["total"] += r["amount"]
        receipts.add(r["receipt_id"])
        if is_avoid:
            pm["avoid"] += r["amount"]
            a = avoid.setdefault(r["product"], {
                "product": r["product"], "display": display_name(r["product"]),
                "group": group, "times": 0, "amount": 0.0, "last_date": r["date"],
            })
            a["times"] += 1
            a["amount"] += r["amount"]
            a["last_date"] = r["date"]

    avoid_total = sum(a["amount"] for a in avoid.values())
    return {
        "start": start,
        "receipts": len(receipts),
        "total": round(total, 2),
        "groups": [
            {"group": g, "amount": round(v, 2), "share": round(v / total, 3) if total else 0}
            for g, v in sorted(by_group.items(), key=lambda kv: -kv[1])
        ],
        "avoid_total": round(avoid_total, 2),
        "avoid_share": round(avoid_total / total, 3) if total else 0,
        "avoid_items": sorted(
            ({**a, "amount": round(a["amount"], 2)} for a in avoid.values()), key=lambda a: -a["amount"]
        ),
        "months": [
            {**pm, "total": round(pm["total"], 2), "avoid": round(pm["avoid"], 2)}
            for pm in sorted(per_month.values(), key=lambda p: p["month"])
        ],
    }


def products(conn: sqlite3.Connection) -> list[dict]:
    """Every product ever bought with its price history.

    Sorted: price changes first (biggest move first), then most bought.
    """
    ov = overrides(conn)
    out: dict[str, dict] = {}
    for r in _items(conn):
        p = out.get(r["product"])
        if p is None:
            group, is_avoid = classify(r["product"], ov)
            p = out[r["product"]] = {
                "product": r["product"], "display": display_name(r["product"]),
                "group": group, "avoid": is_avoid, "per_kg": bool(r["weight_kg"]),
                "times": 0, "spent": 0.0, "history": [],
            }
        p["times"] += 1
        p["spent"] += r["amount"]
        p["history"].append({"date": r["date"], "price": round(unit_price(r), 2)})

    result = []
    for p in out.values():
        first, last = p["history"][0]["price"], p["history"][-1]["price"]
        result.append({
            **p,
            "spent": round(p["spent"], 2),
            "last_date": p["history"][-1]["date"],
            "first_price": first,
            "last_price": last,
            "change_pct": round((last - first) / first * 100, 1) if first else 0.0,
        })
    result.sort(key=lambda p: (p["change_pct"] == 0, -abs(p["change_pct"]), -p["times"], p["display"]))
    return result


def recent(conn: sqlite3.Connection, days: int, today: date | None = None) -> list[dict]:
    """Food bought in the last `days` days, newest first, one row per product."""
    today = today or date.today()
    start = (today - timedelta(days=days)).isoformat()
    ov = overrides(conn)
    seen: dict[str, dict] = {}
    for r in _items(conn, start):
        group, is_avoid = classify(r["product"], ov)
        if group in NON_FOOD:
            continue
        s = seen.setdefault(r["product"], {
            "product": r["product"], "display": display_name(r["product"]),
            "group": group, "avoid": is_avoid, "times": 0,
        })
        s["times"] += 1
        s["last_date"] = r["date"]
    by_name = sorted(seen.values(), key=lambda s: s["display"])
    return sorted(by_name, key=lambda s: s["last_date"], reverse=True)


# ── Supermarkets side by side ────────────────────────────────────────────────

def store_name(store: str) -> str:
    """'MERCADONA' / 'Mercadona, S.A.' → 'Mercadona'; El Corte Inglés kept as read."""
    s = (store or "Other").strip()
    return "Mercadona" if _norm(s).startswith("MERCADONA") else s


def comparable_price(row) -> tuple[str, float] | None:
    """(basis, price) on a basis two stores can share: €/kg for loose produce and
    packs with a printed size (g or ml → €/kg or €/l), else € per unit."""
    if row["weight_kg"] and row["unit_price"]:
        return "kg", row["unit_price"]
    per_unit = row["amount"] / (row["quantity"] or 1)
    if row["pack_g"]:
        return "kg", per_unit / row["pack_g"] * 1000
    return "unit", per_unit


def stores(conn: sqlite3.Connection, window: str = "3m", today: date | None = None) -> dict:
    """Spend per supermarket in the window, the same products' latest prices at
    each (all time), and what each store's basket would have cost elsewhere."""
    today = today or date.today()
    start, receipt_id = _window(conn, window, today)
    ov = overrides(conn)

    per_store: dict[str, dict] = {}
    for r in _items(conn, start, receipt_id):
        st = store_name(r["store"])
        p = per_store.setdefault(st, {"store": st, "receipts": set(), "spend": 0.0, "avoid": 0.0,
                                      "last_date": r["date"], "groups": {}})
        group, is_avoid = classify(r["product"], ov)
        p["receipts"].add(r["receipt_id"])
        p["spend"] += r["amount"]
        p["avoid"] += r["amount"] if is_avoid else 0
        p["last_date"] = max(p["last_date"], r["date"])
        p["groups"][group] = p["groups"].get(group, 0) + r["amount"]
    total = sum(p["spend"] for p in per_store.values())

    # Latest price of each generic product at each store (all time — prices are sparse)
    latest: dict[tuple[str, str], dict] = {}     # (generic, store) → row
    for r in _items(conn):
        if not r["generic"]:
            continue
        cp = comparable_price(r)
        latest[(r["generic"], store_name(r["store"]))] = {
            "store": store_name(r["store"]), "product": r["product"], "display": display_name(r["product"]),
            "date": r["date"], "basis": cp[0], "price": round(cp[1], 2),
        }
    by_generic: dict[str, list[dict]] = {}
    for (g, _), v in latest.items():
        by_generic.setdefault(g, []).append(v)
    matches = []
    for g, offers in by_generic.items():
        if len({o["store"] for o in offers}) < 2:
            continue
        basis = "kg" if sum(o["basis"] == "kg" for o in offers) >= 2 else "unit"
        offers = sorted((o for o in offers if o["basis"] == basis), key=lambda o: o["price"])
        if len(offers) < 2 or not offers[0]["price"]:
            continue
        matches.append({"generic": g, "basis": basis, "offers": offers, "cheapest": offers[0]["store"],
                        "spread_pct": round((offers[-1]["price"] / offers[0]["price"] - 1) * 100, 1)})
    matches.sort(key=lambda m: -m["spread_pct"])

    # Each store's basket in the window, re-priced at the other stores' latest prices
    elsewhere: dict[tuple[str, str], dict] = {}
    for r in _items(conn, start, receipt_id):
        if not r["generic"]:
            continue
        here = store_name(r["store"])
        cp = comparable_price(r)
        if cp[0] == "kg":   # kilos (or litres) bought
            qty = r["weight_kg"] if r["weight_kg"] else (r["quantity"] or 1) * r["pack_g"] / 1000
        else:
            qty = r["quantity"] or 1
        for (g, other), o in latest.items():
            if g != r["generic"] or other == here or o["basis"] != cp[0]:
                continue
            e = elsewhere.setdefault((here, other), {"store": here, "other": other, "items": 0,
                                                     "paid": 0.0, "would_pay": 0.0})
            e["items"] += 1
            e["paid"] += r["amount"]
            e["would_pay"] += o["price"] * qty

    return {
        "start": start,
        "total": round(total, 2),
        "stores": sorted((
            {"store": p["store"], "receipts": len(p["receipts"]), "spend": round(p["spend"], 2),
             "share": round(p["spend"] / total, 3) if total else 0,
             "avg_ticket": round(p["spend"] / len(p["receipts"]), 2),
             "avoid_share": round(p["avoid"] / p["spend"], 3) if p["spend"] else 0,
             "last_date": p["last_date"],
             "top_groups": [{"group": g, "amount": round(v, 2)}
                            for g, v in sorted(p["groups"].items(), key=lambda kv: -kv[1])[:3]]}
            for p in per_store.values()), key=lambda p: -p["spend"]),
        "matches": matches,
        "elsewhere": [{**e, "paid": round(e["paid"], 2), "would_pay": round(e["would_pay"], 2),
                       "diff": round(e["would_pay"] - e["paid"], 2)}
                      for e in sorted(elsewhere.values(), key=lambda e: (e["store"], e["other"]))],
        "unlabelled": conn.execute("""SELECT COUNT(DISTINCT i.product) FROM receipt_items i
                                      LEFT JOIN grocery_products g ON g.product = i.product
                                      WHERE g.generic IS NULL""").fetchone()[0],
    }
