"""
EASA Part-FCL.050 logbook — PDF export.

Landscape A4, font size 7, all 26 EASA columns.
Requires: reportlab  (pip install reportlab)
"""

import io
import sqlite3
from datetime import date

from domains.aviation.aviation_config import EASA_COLUMNS


_AIRCRAFT_PREFIXES = (
    "DIAMOND AIRCRAFT ", "ELITE SIMULATION ", "BOEING ", "AIRBUS ",
    "PIPER ", "CESSNA ", "CIRRUS ", "ROBINSON ", "BELL ",
)

# Canonical display names: stored value → logbook name
_AIRCRAFT_ALIASES: dict[str, str] = {
    "Boeing 737 MAX 8-200": "Boeing 737 MAX 8",
    "Boeing 737-8AS": "Boeing 737-800",
}


def _short_aircraft_type(raw: str | None) -> str:
    """Normalize and strip manufacturer prefix for logbook display."""
    if not raw:
        return ""
    s = " ".join(raw.split())  # collapse \n and multiple spaces
    # Apply canonical alias first (before prefix stripping)
    if s in _AIRCRAFT_ALIASES:
        s = _AIRCRAFT_ALIASES[s]
    upper = s.upper()
    for prefix in _AIRCRAFT_PREFIXES:
        if upper.startswith(prefix):
            return s[len(prefix):]
    return s


def _sec_to_hhmm(seconds: int | None) -> str:
    if not seconds:
        return ""
    h = seconds // 3600
    m = (seconds % 3600) // 60
    return f"{h}:{m:02d}"


def _format_pic_name(raw: str | None, is_pic: bool) -> str:
    if raw:
        s = raw.strip()
        if len(s) == 6 and s.isalpha():
            return s.upper()
        parts = s.split()
        if len(parts) == 1:
            return parts[0].upper()
        return f"{parts[0][0].upper()}.{' '.join(parts[1:]).upper()}"
    if is_pic:
        return "SELF"
    return ""


def generate_pdf(conn: sqlite3.Connection, theme: str = "dark") -> bytes:
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
        dep_time = (r["off_block_utc"][11:16] if len(r["off_block_utc"] or "") > 5 else r["off_block_utc"]) if r["off_block_utc"] else ""
        arr_time = (r["on_block_utc"][11:16] if len(r["on_block_utc"] or "") > 5 else r["on_block_utc"]) if r["on_block_utc"] else ""
        is_pic = r["crew_role"] == "pic"
        total = _sec_to_hhmm(r["block_seconds"])

        data.append([
            r["date"],
            r["dep_icao"] or "",
            dep_time,
            r["arr_icao"] or "",
            arr_time,
            _short_aircraft_type(r["aircraft_type"]),
            r["aircraft_reg"] or "",
            "", "",
            total, total,
            _format_pic_name(r["pic_name"] if "pic_name" in r.keys() else None, is_pic),
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
            r["remarks"] if "remarks" in r.keys() else (r["notes"] or ""),
        ])

    for r in sim_rows:
        data.append([
            r["date"], "", "", "", "", "", "", "", "", "", "", "",
            "", "", "", "", "", "", "", "", "", "",
            r["date"], r["sim_type"] or "", _sec_to_hhmm(r["block_seconds"]),
            r["remarks"] if "remarks" in r.keys() and r["remarks"] else (r["notes"] or ""),
        ])

    FONT_SIZE = 6

    if theme == "light":
        HDR_COLOR  = colors.HexColor("#1E3A5F")
        PIC_COLOR  = colors.HexColor("#EEF2FF")  # pale indigo
        SIM_COLOR  = colors.HexColor("#FFF8EC")  # pale amber
        ALT_COLOR  = colors.HexColor("#F5F5F5")
        BASE_COLOR = colors.white
        TEXT_COLOR = colors.HexColor("#111111")
        HDR_TEXT   = colors.white
        GRID_COLOR = colors.HexColor("#CCCCCC")
        PIC_TEXT   = colors.HexColor("#312E81")
        SIM_TEXT   = colors.HexColor("#92400E")
    else:
        HDR_COLOR  = colors.HexColor("#0B3D5E")
        PIC_COLOR  = colors.HexColor("#1A0D3D")
        SIM_COLOR  = colors.HexColor("#3D2200")
        ALT_COLOR  = colors.HexColor("#111111")
        BASE_COLOR = colors.black
        TEXT_COLOR = colors.HexColor("#D4D4D4")
        HDR_TEXT   = colors.white
        GRID_COLOR = colors.HexColor("#27272A")
        PIC_TEXT   = colors.HexColor("#C4B5FD")
        SIM_TEXT   = colors.HexColor("#FCD34D")

    style_cmds = [
        ("FONTSIZE", (0, 0), (-1, -1), FONT_SIZE),
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("BACKGROUND", (0, 0), (-1, 0), HDR_COLOR),
        ("TEXTCOLOR", (0, 0), (-1, 0), HDR_TEXT),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [BASE_COLOR, ALT_COLOR]),
        ("TEXTCOLOR", (0, 1), (-1, -1), TEXT_COLOR),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("ALIGN", (5, 1), (5, -1), "LEFT"),   # Aircraft model
        ("ALIGN", (25, 1), (25, -1), "LEFT"),  # Remarks
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.25, GRID_COLOR),
        ("ROWHEIGHT", (0, 0), (-1, -1), 9),
        ("ROWHEIGHT", (0, 0), (-1, 0), 14),
    ]

    # Colour PIC rows and sim rows
    pic_offset = 1  # header is row 0
    for idx, r in enumerate(flight_rows):
        row_i = idx + pic_offset
        if r["crew_role"] == "pic":
            style_cmds.append(("BACKGROUND", (0, row_i), (-1, row_i), PIC_COLOR))
            style_cmds.append(("TEXTCOLOR", (0, row_i), (-1, row_i), PIC_TEXT))
    sim_start = len(flight_rows) + 1
    for idx in range(len(sim_rows)):
        row_i = sim_start + idx
        style_cmds.append(("BACKGROUND", (0, row_i), (-1, row_i), SIM_COLOR))
        style_cmds.append(("TEXTCOLOR", (0, row_i), (-1, row_i), SIM_TEXT))

    table = Table(data, colWidths=col_w_pt, repeatRows=1)
    table.setStyle(TableStyle(style_cmds))

    today_str = date.today().isoformat()
    title_style = styles["Normal"].clone("title_style")
    title_style.textColor = colors.black if theme == "light" else colors.HexColor("#D4D4D4")
    title = Paragraph(
        f"<b>EASA Part-FCL.050 Flight Crew Logbook</b> — exported {today_str}",
        title_style,
    )

    if theme == "light":
        doc.build([title, Spacer(1, 4 * mm), table])
    else:
        # Dark mode: set page background to near-black
        from reportlab.platypus import HRFlowable
        doc.build([title, Spacer(1, 4 * mm), table])

    return buf.getvalue()
