"""
ISIN doctor — audit every active market holding against OpenFIGI + yfinance.

For each holding it shows the last cached price date, re-resolves its ISIN,
probes every candidate exchange listing for real Yahoo data, and recommends
the listing that actually updates. Holdings without an ISIN just get their
current ticker probed.

Run:  python -m domains.money.isin_doctor           # report only
      python -m domains.money.isin_doctor --fix     # apply recommended ticker
                                                    # switches + fetch price now
"""

from __future__ import annotations

import argparse
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from typing import Optional

import requests

from infrastructure.db.money_connection import get_money_connection
from domains.money.price_sync import sync_price_now

try:
    import yfinance as yf
    import logging
    # Dead listings are expected here — that's the whole point of probing.
    # Keep yfinance from spamming "possibly delisted" for every miss.
    logging.getLogger("yfinance").setLevel(logging.CRITICAL)
except ImportError:  # pragma: no cover
    yf = None  # type: ignore

# OpenFIGI exchange code → yfinance suffix (mirror of the isin-lookup endpoint)
EXCHANGE_MAP = {
    "GY": ".DE", "GR": ".DE", "GF": ".F", "GM": ".MU", "GD": ".DU",  # Germany
    "SW": ".SW",  # Switzerland
    "SM": ".MC", "SQ": ".MC",  # Spain
    "IX": ".IR",  # Ireland
    "FP": ".PA",  # Paris (Euronext)
    "NA": ".AS",  # Amsterdam
    "BB": ".BR",  # Brussels
    "IM": ".MI",  # Milan
    "LN": ".L",   # London
    "PL": ".LS",  # Lisbon
    "US": "", "UN": "", "UW": "", "UP": "",  # US listings — no suffix
}

FRESH_DAYS = 5  # a listing whose last close is within this window counts as live


def probe(ticker: str) -> Optional[str]:
    """Date (ISO) of the most recent close Yahoo has for ticker, or None."""
    try:
        hist = yf.Ticker(ticker).history(period="1mo", auto_adjust=False)
        if hist.empty:
            return None
        return hist.index[-1].date().isoformat()
    except Exception:
        return None


def resolve_isin(isin: str) -> list[dict]:
    """OpenFIGI candidates as [{ticker, exch, currency}], unprobed."""
    resp = requests.post(
        "https://api.openfigi.com/v3/mapping",
        json=[{"idType": "ID_ISIN", "idValue": isin}],
        headers={"Content-Type": "application/json"},
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()
    out: list[dict] = []
    seen: set[str] = set()
    if data and isinstance(data, list) and data[0].get("data"):
        for item in data[0]["data"]:
            raw, exch = item.get("ticker"), item.get("exchCode")
            suffix = EXCHANGE_MAP.get(exch)
            if not raw or suffix is None:
                continue
            yf_ticker = f"{raw}{suffix}"
            if yf_ticker in seen:
                continue
            seen.add(yf_ticker)
            out.append({"ticker": yf_ticker, "exch": exch,
                        "currency": item.get("currency")})
    return out


def is_fresh(close_date: Optional[str]) -> bool:
    if not close_date:
        return False
    return close_date >= (date.today() - timedelta(days=FRESH_DAYS)).isoformat()


def main(fix: bool) -> None:
    if yf is None:
        sys.exit("yfinance not installed — run inside the project venv")

    conn = get_money_connection()
    holdings = conn.execute(
        """SELECT id, ticker, isin, name, currency, asset_class FROM holdings
           WHERE is_active = 1 AND COALESCE(pricing_mode, 'market') = 'market'
           ORDER BY name"""
    ).fetchall()

    switches: list[tuple[str, str, str]] = []  # (holding_id, old, new)

    for h in holdings:
        last_cached = conn.execute(
            "SELECT MAX(date) AS d FROM price_history WHERE ticker = ?",
            (h["ticker"],),
        ).fetchone()["d"]

        print(f"\n── {h['name']}  [{h['ticker']}]"
              f"  cached price: {last_cached or 'NEVER'}")

        current_close = probe(h["ticker"])
        status = "LIVE" if is_fresh(current_close) else "STALE/DEAD"
        print(f"   current ticker on Yahoo: last close {current_close or '—'}  → {status}")

        if is_fresh(current_close):
            continue  # nothing to fix

        if not h["isin"]:
            # Crypto has no ISIN — Yahoo quotes pairs like BTC-EUR. If the
            # stored ticker isn't already a pair, probe the common variants.
            if h["asset_class"] == "crypto" and "-" not in h["ticker"]:
                base = h["ticker"].upper()
                for pair in (f"{base}-EUR", f"{base}-USD"):
                    d = probe(pair)
                    mark = "✓" if is_fresh(d) else "✗"
                    print(f"     {mark} {pair:<12} last close {d or '—'}")
                    if is_fresh(d):
                        print(f"        ← recommended (crypto pair)")
                        switches.append((h["id"], h["ticker"], pair))
                        break
                else:
                    print("   ✗ no crypto pair found on Yahoo for this symbol")
                continue
            print("   ⚠ no ISIN stored — can't look up alternate listings."
                  " Find the ISIN and set it via Edit, then re-run.")
            continue

        candidates: list[dict] = []
        try:
            candidates = resolve_isin(h["isin"])
        except Exception as e:
            print(f"   ⚠ OpenFIGI lookup failed: {e}")
        if not candidates:
            print("   ⚠ OpenFIGI returned no mappable exchange listings")

        with ThreadPoolExecutor(max_workers=8) as pool:
            dates = list(pool.map(lambda c: probe(c["ticker"]), candidates[:10]))
        for c, d in zip(candidates, dates):
            c["last_close"] = d

        live = [c for c in candidates[:10] if is_fresh(c.get("last_close"))]
        # Same preference as the API: EUR-quoted first, then XETRA
        live.sort(key=lambda c: (
            0 if (c.get("currency") or "").upper() == "EUR" else 1,
            0 if c["exch"] in ("GY", "GR") else 1,
        ))

        for c in candidates[:10]:
            mark = "✓" if is_fresh(c.get("last_close")) else "✗"
            star = "  ← recommended" if live and c is live[0] else ""
            print(f"     {mark} {c['ticker']:<12} {c.get('currency') or '?':<4}"
                  f" last close {c.get('last_close') or '—'}{star}")

        if not live:
            # Yahoo carries most UCITS mutual funds under the raw ISIN as the
            # symbol (NAV series, updates with ~1-2 day lag) — try that.
            isin_close = probe(h["isin"])
            if is_fresh(isin_close):
                print(f"     ✓ {h['isin']:<12} EUR? last close {isin_close}"
                      f"  ← recommended (ISIN as Yahoo symbol)")
                switches.append((h["id"], h["ticker"], h["isin"]))
                continue
            print("   ✗ no listing has recent Yahoo data — this instrument may"
                  " not be coverable. Consider converting it to a manual-value"
                  " holding.")
            continue

        best = live[0]["ticker"]
        if best == h["ticker"]:
            continue
        switches.append((h["id"], h["ticker"], best))

    if not switches:
        print("\nNo ticker switches needed." if not fix else "\nNothing to fix.")
        conn.close()
        return

    print(f"\n{'Applying' if fix else 'Would apply (re-run with --fix)'}:")
    for hid, old, new in switches:
        print(f"   {hid}: {old} → {new}")
        if fix:
            conn.execute(
                """UPDATE holdings SET ticker = ?,
                       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
                   WHERE id = ?""",
                (new, hid),
            )
            conn.commit()
            price = sync_price_now(conn, new)
            print(f"      price fetched: €{price:.4f}" if price is not None
                  else "      price fetch failed — nightly sync will retry")

    conn.close()


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--fix", action="store_true",
                   help="apply recommended ticker switches and fetch prices")
    main(p.parse_args().fix)
