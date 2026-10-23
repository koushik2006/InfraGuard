"""Per-asset configuration for the three SIMULATED demo assets.

There is no universal threshold: every asset has its own detection parameters,
reference period and (optional) owner-supplied criteria.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from backend.contracts import (
    AssetConfig, DetectionParams, EngineeringThreshold, ReferencePeriod,
    SchematicPoint, SensorConfig,
)

SIM_START = datetime(2026, 3, 2, tzinfo=timezone.utc)
SIM_DAYS = 6
REFERENCE_HOURS = 72
SIM_END = SIM_START + timedelta(days=SIM_DAYS)
MONITOR_START = SIM_START + timedelta(hours=REFERENCE_HOURS)


def iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(s: str) -> datetime:
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


_REF = dict(start=iso(SIM_START), end=iso(MONITOR_START))

BRIDGE = AssetConfig(
    asset_id="BRG-017",
    name="Bridge Alpha",
    type="bridge",
    location_text="Simulated cable-stayed bridge, 280 m",
    criticality="high",
    description="Simulated cable-stayed road bridge: deck accelerometers, girder and stay-cable strain, tower tilt, wind and temperature.",
    sensors=[
        SensorConfig(
            sensor_id="ACC-M1", asset_id="BRG-017", kind="accelerometer",
            location="Main span, midspan, downstream girder", sampling_rate_hz=25.0,
            features=["rms", "peak", "dom_freq"], detection_features=["rms", "peak", "dom_freq"],
            units={"rms": "mg", "peak": "mg", "dom_freq": "Hz"}, primary=True,
            schematic=SchematicPoint(x=480, y=150, label="Midspan"),
            component_id="deck_mid", component_name="Deck — main span, midspan",
        ),
        SensorConfig(
            sensor_id="ACC-Q1", asset_id="BRG-017", kind="accelerometer",
            location="Main span, quarter point, downstream girder", sampling_rate_hz=25.0,
            features=["rms", "peak", "dom_freq"], detection_features=["rms", "peak", "dom_freq"],
            units={"rms": "mg", "peak": "mg", "dom_freq": "Hz"},
            schematic=SchematicPoint(x=390, y=150, label="Quarter span"),
            component_id="deck_q1", component_name="Deck — main span, quarter point",
        ),
        SensorConfig(
            sensor_id="ACC-P2", asset_id="BRG-017", kind="accelerometer",
            location="Main span near Pier 2", sampling_rate_hz=25.0,
            features=["rms", "peak", "dom_freq"], detection_features=["rms", "peak", "dom_freq"],
            units={"rms": "mg", "peak": "mg", "dom_freq": "Hz"},
            schematic=SchematicPoint(x=750, y=150, label="Near Pier 2"),
            component_id="deck_p2", component_name="Deck — main span near Pier 2",
        ),
        SensorConfig(
            sensor_id="TMP-B1", asset_id="BRG-017", kind="temperature",
            location="Deck soffit, span 1", sampling_rate_hz=1 / 60,
            features=["temp"], units={"temp": "°C"},
            schematic=SchematicPoint(x=160, y=150, label="Deck temp"),
            component_id="deck_s1", component_name="Deck soffit — span 1",
        ),
        SensorConfig(
            sensor_id="STR-G1", asset_id="BRG-017", kind="strain_gauge",
            location="Main span, midspan girder soffit", sampling_rate_hz=1 / 60,
            features=["strain"], units={"strain": "µε"},
            schematic=SchematicPoint(x=570, y=150, label="Girder strain"),
            component_id="girder_mid", component_name="Girder — main span midspan (soffit)",
        ),
        SensorConfig(
            sensor_id="STR-C1", asset_id="BRG-017", kind="strain_gauge",
            location="Stay cable C-6, tower 2, downstream plane", sampling_rate_hz=1 / 60,
            features=["strain"], units={"strain": "µε"},
            schematic=SchematicPoint(x=660, y=150, label="Cable strain"),
            component_id="cable_c6", component_name="Stay cable C-6 (tower 2, downstream)",
        ),
        SensorConfig(
            sensor_id="TLT-T1", asset_id="BRG-017", kind="tiltmeter",
            location="Tower 2, upper shaft", sampling_rate_hz=1 / 60,
            features=["tilt"], units={"tilt": "mrad"},
            schematic=SchematicPoint(x=850, y=150, label="Tower tilt"),
            component_id="tower_2", component_name="Tower 2 — upper shaft",
        ),
        SensorConfig(
            sensor_id="TLT-P2", asset_id="BRG-017", kind="tiltmeter",
            location="Pier 2 shaft (tower support), upstream face", sampling_rate_hz=1 / 60,
            features=["tilt"], units={"tilt": "mrad"},
            schematic=SchematicPoint(x=930, y=150, label="Pier tilt"),
            component_id="pier_2", component_name="Pier 2 — shaft",
        ),
        SensorConfig(
            sensor_id="WND-1", asset_id="BRG-017", kind="anemometer",
            location="Tower 1 top, 24 m above deck", sampling_rate_hz=1 / 60,
            features=["wind"], units={"wind": "m/s"},
            schematic=SchematicPoint(x=290, y=150, label="Wind"),
            component_id="tower_1_top", component_name="Tower 1 — top (anemometer mount)",
        ),
    ],
    reference_period=ReferencePeriod(
        **_REF, reviewed=False,
        note="Learned automatically from the first 72 h of simulated data. Not reviewed by an engineer: "
             "a learned baseline is not a safe-state baseline.",
    ),
    detection=DetectionParams(
        z_threshold=3.5, persistence_windows=3, min_exceedances=3, window_minutes=15,
        min_reference_windows=96,
        min_scale={"rms": 0.05, "peak": 0.2, "dom_freq": 0.005, "strain": 0.05, "tilt": 0.002, "wind": 0.05},
        plausible_range={"rms": (0.0, 500.0), "peak": (0.0, 3000.0), "dom_freq": (0.5, 12.0), "temp": (-30.0, 70.0),
                        "strain": (-3000.0, 3000.0), "tilt": (-20.0, 20.0), "wind": (0.0, 80.0)},
    ),
    thresholds=[],
)

BUILDING = AssetConfig(
    asset_id="BLD-204",
    name="Civic Annex Building",
    type="building",
    location_text="Simulated 9-storey RC frame office building",
    criticality="medium",
    description="Simulated reinforced-concrete frame building with roof-level tiltmeters.",
    sensors=[
        SensorConfig(
            sensor_id="TLT-N1", asset_id="BLD-204", kind="tiltmeter",
            location="Roof level, north core wall", sampling_rate_hz=1 / 60,
            features=["tilt"], detection_features=["tilt_resid", "tilt_slope"],
            units={"tilt": "mrad", "tilt_resid": "mrad", "tilt_slope": "mrad/day"}, primary=True,
        ),
        SensorConfig(
            sensor_id="TLT-E1", asset_id="BLD-204", kind="tiltmeter",
            location="Roof level, east facade column line", sampling_rate_hz=1 / 60,
            features=["tilt"], detection_features=["tilt_resid", "tilt_slope"],
            units={"tilt": "mrad", "tilt_resid": "mrad", "tilt_slope": "mrad/day"},
        ),
        SensorConfig(
            sensor_id="TMP-A1", asset_id="BLD-204", kind="temperature",
            location="Roof level, shaded facade", sampling_rate_hz=1 / 60,
            features=["temp"], units={"temp": "°C"},
        ),
    ],
    reference_period=ReferencePeriod(
        **_REF, reviewed=True, reviewed_by="Simulated reviewer persona (fixture REV-BLD-01)",
        note="Reference period marked as reviewed in a SIMULATED review record. Review confirms data "
             "completeness only; it does not certify structural condition.",
    ),
    detection=DetectionParams(
        z_threshold=3.5, persistence_windows=4, min_exceedances=4, window_minutes=60,
        min_reference_windows=48, temperature_compensation=True, temperature_sensor_id="TMP-A1",
        slope_window=12,
        min_scale={"tilt_resid": 0.002, "tilt_slope": 0.005, "tilt": 0.002},
        plausible_range={"tilt": (-20.0, 20.0), "temp": (-30.0, 70.0)},
    ),
    thresholds=[
        EngineeringThreshold(
            sensor_id="TLT-N1", feature="tilt_resid", limit=0.25, direction="abs_above",
            kind="demo_criterion", label="Demo criterion (not an engineering limit)",
            source="Hackathon demo configuration — illustrates the escalation path only",
        )
    ],
)

RETAINING_WALL = AssetConfig(
    asset_id="RW-031",
    name="Hillside Retaining Wall",
    type="retaining_wall",
    location_text="Simulated 120 m cantilever retaining wall",
    criticality="medium",
    description="Simulated cantilever retaining wall with in-place inclinometers and a crack meter.",
    sensors=[
        SensorConfig(
            sensor_id="IN-01", asset_id="RW-031", kind="tiltmeter",
            location="Panel 4, crest", sampling_rate_hz=1 / 60,
            features=["tilt"], detection_features=["tilt"], units={"tilt": "mrad"}, primary=True,
        ),
        SensorConfig(
            sensor_id="IN-02", asset_id="RW-031", kind="tiltmeter",
            location="Panel 9, crest", sampling_rate_hz=1 / 60,
            features=["tilt"], detection_features=["tilt"], units={"tilt": "mrad"},
        ),
        SensorConfig(
            sensor_id="CM-01", asset_id="RW-031", kind="crackmeter",
            location="Joint between panels 6 and 7", sampling_rate_hz=1 / 60,
            features=["width"], detection_features=["width"], units={"width": "mm"},
        ),
    ],
    reference_period=ReferencePeriod(
        **_REF, reviewed=False,
        note="Learned automatically from simulated data; not reviewed.",
    ),
    detection=DetectionParams(
        z_threshold=4.0, persistence_windows=4, min_exceedances=3, window_minutes=60,
        min_reference_windows=48,
        min_scale={"tilt": 0.004, "width": 0.002},
        plausible_range={"tilt": (-20.0, 20.0), "width": (0.0, 25.0)},
    ),
    thresholds=[],
)

ASSETS: dict[str, AssetConfig] = {a.asset_id: a for a in (BRIDGE, BUILDING, RETAINING_WALL)}

# Assets that are monitored and shown in this version. The building and retaining wall stay defined (config,
# generators, tests) but are inactive; enabling one is a change to this list, not a redesign.
ACTIVE_ASSET_IDS: list[str] = ["BRG-017"]

# Labelled simulated events used for detection metrics (ground truth of the simulation only).
LABELLED_EVENTS = {
    "BRG-017": {
        "persistent_deviation": [{"kind": "anomaly", "onset_window": 352, "sensor": "ACC-M1"},
                                 {"kind": "benign_transient", "window": 321}],
        "benign_transient": [{"kind": "benign_transient", "window": 321}],
        "normal": [],
    },
    "BLD-204": {
        "gradual_drift": [{"kind": "anomaly", "onset_window": 102, "sensor": "TLT-N1"}],
        "normal": [],
    },
    "RW-031": {"normal": []},
}

VARIANTS = {
    "BRG-017": ["persistent_deviation", "benign_transient", "normal"],
    "BLD-204": ["gradual_drift", "normal"],
    "RW-031": ["normal"],
}
DEFAULT_VARIANTS = {"BRG-017": "persistent_deviation", "BLD-204": "gradual_drift", "RW-031": "normal"}


def window_count(asset: AssetConfig) -> int:
    return SIM_DAYS * 24 * 60 // asset.detection.window_minutes


def reference_windows(asset: AssetConfig) -> int:
    return REFERENCE_HOURS * 60 // asset.detection.window_minutes


def window_bounds(asset: AssetConfig, idx: int, origin: datetime = SIM_START) -> tuple[datetime, datetime]:
    w = timedelta(minutes=asset.detection.window_minutes)
    return origin + idx * w, origin + (idx + 1) * w
