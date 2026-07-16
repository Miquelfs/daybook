"""
Daily price sync for investment holdings.

Fetches yesterday's close for every active ticker via yfinance, converts to EUR,
upserts into `price_history`, and writes a `holding_snapshots` row per holding
so we can chart portfolio value over time.

Run:  python -m domains.money.price_sync
      python -m domains.money.price_sync --backfill 30    # 30 days of history

Idempotent per (ticker, date). If yfinance is down, previous prices remain in
the cache — the dashboard falls back to the latest known close.
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from datetime import date, datetime, timedelta
from typing import Optional

from infrastructure.db.money_connection import get_money_connection

# yfinance is optional at import-time so tests / non-price code don't fail
try:
    import yfinance as yf
except ImportError:  # pragma: no cover
    yf = None  # type: ignore


def _log_run(conn: sqlite3.Connection, status: str, upserted: int, skipped: int, error: Optional[str]) -> None:
    conn.execute(
        """INSERT INTO money_sync_log (source, status, records_upserted, records_skipped, error)
           VALUES ('price_sync', ?, ?, ?, ?)""",
        (status, upserted, skipped, error),
    )
    conn.commit()


def _fx_to_eur(currency: str, on_date: date) -> tuple[float, Optional[float]]:
    """Return (eur_rate, close_price_native_for_fx_pair).

    For EUR returns (1.0, None). Otherwise fetches the {CURRENCY}EUR=X close near on_date.
    """
    if currency.upper() == "EUR":
        return 1.0, None
    pair = f"{currency.upper()}EUR=X"
    try:
        hist = yf.Ticker(pair).history(
            start=(on_date - timedelta(days=7)).isoformat(),
            end=(on_date + timedelta(days=1)).isoformat(),
            auto_adjust=False,
        )
        if hist.empty:
            return 1.0, None
        rate = float(hist["Close"].iloc[-1])
        return rate, rate
    except Exception:
        return 1.0, None


def _fetch_close(ticker: str, on_date: date) -> Optional[tuple[float, str]]:
    """Return (close_price, currency) for the most recent close on or before on_date."""
    try:
        t = yf.Ticker(ticker)
        hist = t.history(
            start=(on_date - timedelta(days=7)).isoformat(),
            end=(on_date + timedelta(days=1)).isoformat(),
            auto_adjust=False,
        )
        if hist.empty:
            # Thinly-traded listings (esp. German secondary exchanges) can go
            # more than a week without a printed close — widen to a month
            # before giving up so the holding doesn't show as stale forever.
            hist = t.history(
                start=(on_date - timedelta(days=31)).isoformat(),
                end=(on_date + timedelta(days=1)).isoformat(),
                auto_adjust=False,
            )
        if hist.empty:
            return None
        close = float(hist["Close"].iloc[-1])
        currency = t.fast_info.get("currency") or t.info.get("currency", "USD")
        return close, str(currency).upper()
    except Exception as e:
        print(f"  [{ticker}] fetch failed: {e}", file=sys.stderr)
        return None


def sync_price_now(conn: sqlite3.Connection, ticker: str, currency_hint: str = "EUR") -> Optional[float]:
    """Fetch and cache TODAY's price for a single ticker, synchronously.

    Used right after a holding is created (or bought into) so its value shows
    immediately instead of waiting for the nightly `price_sync` cron. Returns
    the cached EUR close, or None if yfinance is unavailable/fetch fails —
    callers should treat that as non-fatal (the holding still saves; price
    fills in on the next cron run).
    """
    if yf is None:
        return None
    today = date.today()
    try:
        result = _fetch_close(ticker, today)
        if result is None:
            return None
        close_native, currency = result
        currency = currency or currency_hint
        fx_rate, _ = _fx_to_eur(currency, today)
        close_eur = close_native * fx_rate

        conn.execute(
            """INSERT INTO price_history (ticker, date, close_price, close_price_eur, currency, fx_rate, source)
               VALUES (?, ?, ?, ?, ?, ?, 'yfinance')
               ON CONFLICT(ticker, date) DO UPDATE SET
                   close_price = excluded.close_price,
                   close_price_eur = excluded.close_price_eur,
                   currency = excluded.currency,
                   fx_rate = excluded.fx_rate,
                   fetched_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')""",
            (ticker, today.isoformat(), close_native, close_eur, currency, fx_rate),
        )
        conn.commit()
        return close_eur
    except Exception as e:
        print(f"  [{ticker}] immediate sync failed: {e}", file=sys.stderr)
        return None


def sync_prices_for_date(conn: sqlite3.Connection, target_date: date) -> tuple[int, int]:
    """Fetch and cache prices for all active tickers for target_date.

    Returns (upserted, skipped).
    """
    if yf is None:
        raise RuntimeError("yfinance not installed — add to requirements.txt and pip install")

    try:
        tickers = conn.execute(
            """SELECT DISTINCT ticker, currency FROM holdings
               WHERE is_active = 1 AND COALESCE(pricing_mode, 'market') = 'market'"""
        ).fetchall()
    except sqlite3.OperationalError:
        # pricing_mode column not migrated yet — sync everything as before
        tickers = conn.execute(
            "SELECT DISTINCT ticker, currency FROM holdings WHERE is_active = 1"
        ).fetchall()

    upserted = 0
    skipped = 0
    fx_cache: dict[str, float] = {"EUR": 1.0}

    for row in tickers:
        ticker = row["ticker"]
        native_currency_hint = row["currency"]

        result = _fetch_close(ticker, target_date)
        if result is None:
            skipped += 1
            continue
        close_native, currency = result

        # Prefer yfinance's reported currency; fall back to holdings hint
        currency = currency or native_currency_hint

        if currency not in fx_cache:
            rate, _ = _fx_to_eur(currency, target_date)
            fx_cache[currency] = rate
        fx_rate = fx_cache[currency]
        close_eur = close_native * fx_rate

        conn.execute(
            """INSERT INTO price_history (ticker, date, close_price, close_price_eur, currency, fx_rate, source)
               VALUES (?, ?, ?, ?, ?, ?, 'yfinance')
               ON CONFLICT(ticker, date) DO UPDATE SET
                   close_price = excluded.close_price,
                   close_price_eur = excluded.close_price_eur,
                   currency = excluded.currency,
                   fx_rate = excluded.fx_rate,
                   fetched_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')""",
            (ticker, target_date.isoformat(), close_native, close_eur, currency, fx_rate),
        )
        upserted += 1
        print(f"  [{ticker}] {target_date.isoformat()} {close_native:.4f} {currency} → €{close_eur:.4f}")

    conn.commit()
    return upserted, skipped


def snapshot_holdings_for_date(conn: sqlite3.Connection, target_date: date) -> int:
    """Write one holding_snapshots row per active holding using cached prices for target_date.

    Returns rows inserted.
    """
    rows = conn.execute(
        """SELECT h.id, h.ticker, h.quantity,
                  (SELECT close_price_eur FROM price_history
                   WHERE ticker = h.ticker AND date <= ?
                   ORDER BY date DESC LIMIT 1) AS price_eur
             FROM holdings h
             WHERE h.is_active = 1""",
        (target_date.isoformat(),),
    ).fetchall()

    inserted = 0
    for r in rows:
        if r["price_eur"] is None:
            continue
        value = r["quantity"] * r["price_eur"]
        conn.execute(
            """INSERT INTO holding_snapshots (date, holding_id, quantity, price_eur, value_eur)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(date, holding_id) DO UPDATE SET
                   quantity = excluded.quantity,
                   price_eur = excluded.price_eur,
                   value_eur = excluded.value_eur""",
            (target_date.isoformat(), r["id"], r["quantity"], r["price_eur"], value),
        )
        inserted += 1
    conn.commit()
    return inserted


def run(target_date: Optional[date] = None, backfill_days: int = 0) -> None:
    conn = get_money_connection()
    total_up = 0
    total_skip = 0
    error: Optional[str] = None

    try:
        base = target_date or (date.today() - timedelta(days=1))
        dates = [base - timedelta(days=i) for i in range(backfill_days + 1)]
        for d in sorted(dates):
            print(f"── Syncing prices for {d.isoformat()} ──")
            up, sk = sync_prices_for_date(conn, d)
            total_up += up
            total_skip += sk
            snap = snapshot_holdings_for_date(conn, d)
            print(f"  → {snap} holding snapshots written")
        status = "success" if total_skip == 0 else "partial"
    except Exception as e:
        error = str(e)
        status = "error"
        print(f"price_sync FAILED: {e}", file=sys.stderr)

    _log_run(conn, status, total_up, total_skip, error)
    conn.close()
    print(f"\nDone. upserted={total_up} skipped={total_skip} status={status}")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--date", help="YYYY-MM-DD to sync (default: yesterday)")
    p.add_argument("--backfill", type=int, default=0, help="Days back to also sync (0 = only target date)")
    args = p.parse_args()

    d = datetime.strptime(args.date, "%Y-%m-%d").date() if args.date else None
    run(target_date=d, backfill_days=args.backfill)
