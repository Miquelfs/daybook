"""Aviation domain constants."""

# The pilot's own crew code in source data.
PILOT_CODE = "FARMIQ"

# Date from which FARMIQ started acting as PIC (previously always SIC).
PIC_START_DATE = "2024-09-01"

# Default operator for Full.csv data.
DEFAULT_OPERATOR = "Ryanair"

# EASA Part-FCL.050 column order (exact).
EASA_COLUMNS = [
    "Date",
    "Departure Place",
    "Departure Time",
    "Arrival Place",
    "Arrival Time",
    "Aircraft Model",
    "Registration",
    "SP SE",
    "SP ME",
    "MP",
    "Total Time",
    "Name of PIC",
    "T/O Day",
    "T/O Night",
    "Ldg Day",
    "Ldg Night",
    "Night",
    "IFR",
    "PIC",
    "CoPilot",
    "Dual",
    "Instructor",
    "FSTD Date",
    "FSTD Type",
    "FSTD Total",
    "Remarks",
]

# Aircraft in Full.csv are all B737 variants (multi-pilot ops → MP column).
MULTI_PILOT_TYPES = {"B737", "B737 MAX", "Boeing 737", "Boeing 737 MAX 8-200"}

CREW_ROLES = ("pic", "first_officer", "other")

# Airports where the pilot has been based — shown in green on the map.
BASE_AIRPORTS = {
    "LIME": "Bergamo (Ryanair base)",
    "GCTS": "Tenerife South (Ryanair base)",
    "LELL": "Sabadell (training base)",
    "LEPA": "Palma de Mallorca (Norwegian base)",
}
