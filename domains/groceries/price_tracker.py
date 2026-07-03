"""
Fetch current Mercadona prices for all active pantry items with a mercadona_id.
Called manually (POST /groceries/prices/sync) or from a cron.
"""

import json
import logging
from datetime import date

from domains.groceries.pantry import list_pantry, upsert_price
from domains.groceries import mercadona_client

log = logging.getLogger(__name__)


def sync_prices() -> dict:
    """
    Fetch prices for all active pantry items that have a mercadona_id.
    Returns a summary dict: {synced, skipped, errors}.
    """
    items = [i for i in list_pantry() if i.get("mercadona_id")]
    if not items:
        return {"synced": 0, "skipped": 0, "errors": 0, "message": "No pantry items with mercadona_id"}

    ids = [i["mercadona_id"] for i in items]
    products = mercadona_client.get_prices(ids)

    if products is None:
        return {"synced": 0, "skipped": len(items), "errors": 0, "message": "mercadona-cli not available"}

    id_to_product = {str(p.get("id")): p for p in products if p.get("id")}
    today = date.today().isoformat()

    synced, skipped, errors = 0, 0, 0
    for item in items:
        mid = item["mercadona_id"]
        product = id_to_product.get(str(mid))
        if not product:
            log.warning("No price data returned for mercadona_id=%s (%s)", mid, item["name"])
            skipped += 1
            continue
        try:
            price = float(product.get("price", 0))
            unit_price = float(product.get("unit_price", 0)) or None
            upsert_price(
                item_id=item["id"],
                price_eur=price,
                unit_price=unit_price,
                store="mercadona",
                raw_payload=json.dumps(product),
                on_date=today,
            )
            synced += 1
        except Exception as e:
            log.warning("Failed to store price for %s: %s", item["name"], e)
            errors += 1

    return {"synced": synced, "skipped": skipped, "errors": errors}
