"""
Fix EDDB airport entry: Schönefeld (SXF) was replaced by Berlin Brandenburg (BER)
which uses ICAO EDDB since October 2020.

Also backfills dep_icao/arr_icao for flights where IATA='BER' but ICAO is NULL.

Run on Pi:
    python -m infrastructure.db.migrate_eddb_ber
"""

import logging
from infrastructure.db.connection import get_connection

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger(__name__)


def run():
    conn = get_connection()

    # 1. Update the EDDB airport record to Berlin Brandenburg
    conn.execute("""
        UPDATE airports SET
            iata      = 'BER',
            name      = 'Berlin Brandenburg Airport',
            city      = 'Berlin',
            country   = 'Germany',
            latitude  = 52.366667,
            longitude = 13.503333,
            elevation_ft = 151,
            timezone  = 'Europe/Berlin'
        WHERE icao = 'EDDB'
    """)
    log.info("Updated EDDB → Berlin Brandenburg (BER)")

    # 2. Backfill dep_icao for flights departing BER
    r = conn.execute("""
        UPDATE flights
        SET dep_icao = 'EDDB'
        WHERE dep_iata = 'BER' AND dep_icao IS NULL
    """)
    log.info("Backfilled dep_icao=EDDB on %d flights", r.rowcount)

    # 3. Backfill arr_icao for flights arriving BER
    r = conn.execute("""
        UPDATE flights
        SET arr_icao = 'EDDB'
        WHERE arr_iata = 'BER' AND arr_icao IS NULL
    """)
    log.info("Backfilled arr_icao=EDDB on %d flights", r.rowcount)

    conn.commit()
    conn.close()
    log.info("Done")


if __name__ == "__main__":
    run()
