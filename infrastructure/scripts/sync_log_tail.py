"""Print the last 10 sync_log entries. Used by make verify."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parents[2]))
from infrastructure.db.connection import get_connection

conn = get_connection()
rows = conn.execute(
    "SELECT run_at, source, data_type, status, records_synced "
    "FROM sync_log ORDER BY run_at DESC LIMIT 10"
).fetchall()
for r in rows:
    print(f"  {r[0]}  {r[1]}/{r[2]:<14} {r[3]:<8} {r[4]} records")
conn.close()
