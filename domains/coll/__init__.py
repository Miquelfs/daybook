"""
Coll — the DIY bike computer (~/Desktop/ciclocomputer). Daybook is its only backend:
courses → .coll course packs, the settings it rides with, and the rides it uploads.
The contract is ciclocomputer/docs/DAYBOOK.md.

coursepack/ and collog.py are VENDORED from ciclocomputer/tools/ — the pack and ride-log
formats are shared with the device firmware. Change them there and copy them here (never
edit only this copy):
    cp -r ~/Desktop/ciclocomputer/tools/coursepack domains/coll/
    cp ~/Desktop/ciclocomputer/tools/collog.py domains/coll/collog.py   (keep the first docstring line)

device.py plays the device's side of the sync, for testing without the hardware.
"""
