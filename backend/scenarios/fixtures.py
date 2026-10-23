"""SIMULATED maintenance records, inspection notes and logs. Every record is fictional and
tagged simulated. The Investigator may only cite records that exist here or computed data."""
from __future__ import annotations

FIXTURES: dict[str, dict[str, list[dict]]] = {
    "BRG-017": {
        "maintenance": [
            {"id": "MR-BRG-0141", "date": "2025-11-18", "title": "Expansion joint EJ-2 resealed",
             "text": "Expansion joint EJ-2 at Pier 2 resealed; joint gap measured within the maintenance tolerance.",
             "tags": ["EJ-2", "pier2"], "category": "joint"},
            {"id": "MR-BRG-0152", "date": "2026-01-22", "title": "Bearing B2-D lubrication and visual check",
             "text": "Bearing B2-D lubricated. Minor corrosion noted on the bearing top plate; flagged for review at "
                     "next inspection.", "tags": ["bearing", "pier2"], "category": "structural_condition"},
            {"id": "MR-BRG-0157", "date": "2026-02-10", "title": "ACC-M1 recalibrated after logger firmware update",
             "text": "Midspan accelerometer ACC-M1 recalibrated after data-logger firmware update; calibration "
                     "check passed.", "tags": ["ACC-M1"], "category": "sensor"},
        ],
        "inspections": [
            {"id": "IN-BRG-2025-09", "date": "2025-09-14", "title": "Principal inspection (simulated)",
             "text": "No significant defects recorded at the main span. Hairline cracking in deck soffit of span 1 "
                     "noted for monitoring.", "tags": ["span1"], "category": "inspection"},
            {"id": "IN-BRG-2026-02", "date": "2026-02-20", "title": "General inspection (simulated)",
             "text": "Drainage outlet near Pier 2 partially blocked; debris accumulation on the Pier 2 bearing "
                     "shelf. Recommended clearance at next maintenance visit.",
             "tags": ["pier2", "bearing"], "category": "structural_condition"},
        ],
        "logs": [
            {"id": "TM-BRG-0305", "date": "2026-03-05T08:10:00Z", "end": "2026-03-05T08:30:00Z",
             "title": "Heavy-load permit crossing (simulated traffic log)",
             "text": "Permitted abnormal-load vehicle crossed the bridge, 08:10-08:30.",
             "tags": ["load"], "category": "load_event"},
        ],
    },
    "BLD-204": {
        "maintenance": [
            {"id": "MR-BLD-0088", "date": "2026-02-27", "title": "Basement dewatering pump P-3 replaced",
             "text": "Dewatering pump P-3 replaced; groundwater pumping interrupted for approx. 6 hours.",
             "tags": ["groundwater"], "category": "ground"},
            {"id": "MR-BLD-0091", "date": "2026-03-04", "title": "Roof plant installation",
             "text": "New chiller unit (approx. 6 t) installed on the north roof area.",
             "tags": ["roof", "north", "load"], "category": "load_change"},
        ],
        "inspections": [
            {"id": "IN-BLD-2025-12", "date": "2025-12-03", "title": "Annual inspection (simulated)",
             "text": "No visible cracking recorded at the north core walls. Tiltmeter brackets checked and secure.",
             "tags": ["north", "TLT-N1"], "category": "inspection"},
            {"id": "REV-BLD-01", "date": "2026-03-05", "title": "Reference-period data review (simulated)",
             "text": "Reference period 2026-03-02 to 2026-03-05 reviewed for completeness and sensor function. "
                     "Review does not assess structural condition.", "tags": ["baseline"], "category": "review"},
        ],
        "logs": [],
    },
    "RW-031": {
        "maintenance": [
            {"id": "MR-RW-0012", "date": "2026-01-15", "title": "Weep holes cleared",
             "text": "Weep holes on panels 3-10 cleared of vegetation and silt.", "tags": ["drainage"],
             "category": "drainage"},
        ],
        "inspections": [
            {"id": "IN-RW-2025-10", "date": "2025-10-08", "title": "Routine inspection (simulated)",
             "text": "Panel joints in fair condition. Crack meter CM-01 installed across joint 6/7.",
             "tags": ["CM-01"], "category": "inspection"},
        ],
        "logs": [],
    },
}

SENSOR_FEATURE_LABELS = {
    "rms": "RMS acceleration", "peak": "peak acceleration", "dom_freq": "dominant frequency (1.5-5 Hz band)",
    "tilt": "tilt", "tilt_resid": "temperature-compensated tilt residual", "tilt_slope": "tilt trend slope",
    "width": "crack width", "temp": "temperature", "strain": "strain", "wind": "wind speed",
}
