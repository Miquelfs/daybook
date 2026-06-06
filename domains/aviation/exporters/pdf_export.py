"""
EASA Part-FCL.050 logbook — PDF export.

Landscape A4, font size 7, all 26 EASA columns.
Requires: reportlab  (pip install reportlab)
"""

import io
import sqlite3
from datetime import date

from domains.aviation.aviation_config import EASA_COLUMNS


def _sec_to_hhmm(seconds: int | None) -> str:
    if not seconds:
        return ""
    h = seconds // 3600
    m = (seconds % 3600) // 60
    return f"{h}:{m:02d}"


def generate_pdf(conn: sqlite3.Connection) -> bytes:
    try:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4, landscape
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.lib.units import mm
        from reportlab.platypus import (
            Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle,
        )
    except ImportError:
        raise RuntimeError("reportlab is required: pip install reportlab")

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=landscape(A4),
        leftMargin=8 * mm,
        rightMargin=8 * mm,
        topMargin=12 * mm,
        bottomMargin=12 * mm,
    )

    styles = getSampleStyleSheet()
    page_w = landscape(A4)[0] - 16 * mm  # usable width

    # Column widths (proportional, sum = page_w roughly)
    # 26 columns — tight layout at font 6
    col_w = [
        20, 14, 11, 14, 11, 22, 16,
        8, 8, 10, 10, 14,
        9, 9, 9, 9,
        10, 10, 10, 12, 8, 8,
        16, 16, 12, 28,
    ]
    # Scale to fill page
    total_raw = sum(col_w)
    col_w_pt = [w / total_raw * page_w for w in col_w]

    # Header row
    data = [EASA_COLUMNS[:]]

    flight_rows = conn.execute("""
        SELECT f.*
        FROM flights f
        WHERE f.is_sim = 0
        ORDER BY f.date, f.off_block_utc
    """).fetchall()

    sim_rows = conn.execute(
        "SELECT * FROM flights WHERE is_sim = 1 ORDER BY date"
    ).fetchall()

    for r in flight_rows:
        dep_time = r["off_block_utc"][11:16] if r["off_block_utc"] else ""
        arr_time = r["on_block_utc"][11:16] if r["on_block_utc"] else ""
        is_pic = r["crew_role"] == "pic"
        total = _sec_to_hhmm(r["block_seconds"])

        data.append([
            r["date"],
            r["dep_icao"] or "",
            dep_time,
            r["arr_icao"] or "",
            arr_time,
            r["aircraft_type"] or "",
            r["aircraft_reg"] or "",
            "", "",
            total, total,
            "SELF" if is_pic else "",
            r["takeoffs_day"] or "",
            r["takeoffs_night"] or "",
            r["landings_day"] or "",
            r["landings_night"] or "",
            _sec_to_hhmm(r["night_seconds"]),
            total,
            _sec_to_hhmm(r["pic_seconds"]),
            _sec_to_hhmm(r["sic_seconds"]),
            "", "",
            "", "", "",
            r["notes"] or "",
        ])

    for r in sim_rows:
        data.append([
            r["date"], "", "", "", "", "", "", "", "", "", "", "",
            "", "", "", "", "", "", "", "", "", "",
            r["date"], r["sim_type"] or "", _sec_to_hhmm(r["block_seconds"]),
            r["notes"] or "",
        ])

    FONT_SIZE = 6
    HDR_COLOR = colors.HexColor("#0B3D5E")
    PIC_COLOR = colors.HexColor("#1A0D3D")
    SIM_COLOR = colors.HexColor("#3D2200")
    ALT_COLOR = colors.HexColor("#111111")

    style_cmds = [
        ("FONTSIZE", (0, 0), (-1, -1), FONT_SIZE),
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("BACKGROUND", (0, 0), (-1, 0), HDR_COLOR),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.black, ALT_COLOR]),
        ("TEXTCOLOR", (0, 1), (-1, -1), colors.HexColor("#D4D4D4")),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("ALIGN", (5, 1), (5, -1), "LEFT"),   # Aircraft model
        ("ALIGN", (25, 1), (25, -1), "LEFT"),  # Remarks
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#27272A")),
        ("ROWHEIGHT", (0, 0), (-1, -1), 9),
        ("ROWHEIGHT", (0, 0), (-1, 0), 14),
    ]

    # Colour PIC rows and sim rows
    pic_offset = 1  # header is row 0
    for idx, r in enumerate(flight_rows):
        row_i = idx + pic_offset
        if r["crew_role"] == "pic":
            style_cmds.append(("BACKGROUND", (0, row_i), (-1, row_i), PIC_COLOR))
    sim_start = len(flight_rows) + 1
    for idx in range(len(sim_rows)):
        row_i = sim_start + idx
        style_cmds.append(("BACKGROUND", (0, row_i), (-1, row_i), SIM_COLOR))

    table = Table(data, colWidths=col_w_pt, repeatRows=1)
    table.setStyle(TableStyle(style_cmds))

    today_str = date.today().isoformat()
    title = Paragraph(
        f"<b>EASA Part-FCL.050 Flight Crew Logbook</b> — exported {today_str}",
        styles["Normal"],
    )

    doc.build([title, Spacer(1, 4 * mm), table])
    return buf.getvalue()
