import numpy as np
import pytest

from backend.baseline.service import robust_stats
from backend.contracts import Intervention
from backend.detector.detector import find_event, prepare_asset, scan_all_events, transient_exceedances
from backend.detector.quality import assess_series
from backend.scenarios.assets import ASSETS
from tests.conftest import make_run


def events(asset, seed=4242, **v):
    d = prepare_asset(make_run(seed, **v), asset)
    return d, scan_all_events(d)


@pytest.mark.parametrize("seed", [4242, 1, 2, 3])
def test_normal_variation_no_alerts(seed):
    for a, v in [("BRG-017", "normal"), ("BLD-204", "normal"), ("RW-031", "normal")]:
        _, evs = events(a, seed, **{a: v})
        assert evs == [], f"{a} seed {seed}"


@pytest.mark.parametrize("seed", [4242, 1, 2])
def test_benign_transient_does_not_alert(seed):
    d, evs = events("BRG-017", seed, **{"BRG-017": "benign_transient"})
    assert evs == []
    tr = transient_exceedances(d, d.n_ref, d.n - 1)
    assert any(t["window_index"] == 321 for t in tr), "transient must be logged, just not alerted"


def test_persistent_anomaly_detected_within_3_windows():
    d, evs = events("BRG-017")
    assert len(evs) == 1
    e = evs[0]
    assert 352 <= e.detected_window <= 354
    assert e.primary_sensor_id == "ACC-M1" and e.corroborating_sensors
    assert e.deviations[0].feature == "dom_freq" and e.deviations[0].z < 0
    assert e.data_quality.passed


def test_sudden_change_change_point():
    d, evs = events("BRG-017")
    assert evs[0].change_point_window == 352


def test_gradual_drift_with_temperature_component():
    d, evs = events("BLD-204")
    assert len(evs) == 1 and evs[0].primary_sensor_id == "TLT-N1"
    assert any(m.sensor_id == "TLT-N1" and m.slope_per_degC > 0.01 for m in d.temp_models)
    # heatwave must not cause an alert on the normal variant: temperature is compensated
    d2 = prepare_asset(make_run(**{"BLD-204": "normal"}).model_copy(update={"environment": "heatwave"}), "BLD-204")
    assert scan_all_events(d2) == []


def test_missing_stale_frozen_implausible():
    d = prepare_asset(make_run(), "BLD-204")
    assert d.flags["TLT-N1"][80].status == "missing"
    assert d.flags["TLT-E1"][118].status == "implausible"
    run = make_run().model_copy(update={"interventions": [
        Intervention(type="frozen_sensor", sensor_id="IN-02", from_time="2026-03-05T06:00:00Z"),
        Intervention(type="stale_sensor", sensor_id="IN-01", from_time="2026-03-05T06:00:00Z")]})
    d = prepare_asset(run, "RW-031")
    assert d.flags["IN-02"][130].status == "frozen"
    assert d.flags["IN-01"][130].status == "stale"


def test_frozen_sensor_cannot_trigger_anomaly():
    run = make_run().model_copy(update={"interventions": [
        Intervention(type="frozen_sensor", sensor_id="ACC-M1", from_time="2026-03-05T12:00:00Z")]})
    d = prepare_asset(run, "BRG-017")
    ev = find_event(d, d.n_ref, d.n - 1)
    assert ev is not None and ev.primary_sensor_id != "ACC-M1"
    assert all(d.exceed["ACC-M1"][i] is False for i in range(340, d.n))


def test_zero_or_tiny_mad_is_handled():
    st = robust_stats([1.0] * 50, 0.01)
    assert st["scale"] == 0.01 and st["zero_mad_fallback"]
    st = robust_stats(list(np.random.default_rng(0).normal(0, 1, 100)), 0.01)
    assert st["scale"] > 0.5 and not st["zero_mad_fallback"]


def test_insufficient_baseline_disables_detection():
    a = ASSETS["RW-031"].model_copy(deep=True)
    a.detection = a.detection.model_copy(update={"min_reference_windows": 500})
    d = prepare_asset(make_run(), "RW-031", asset_override=a)
    assert d.baseline.status == "insufficient_data" and d.baseline.insufficient_sensors
    assert d.detection_sensors() == [] and scan_all_events(d) == []


def test_per_asset_configs_are_distinct():
    p = {a: ASSETS[a].detection for a in ASSETS}
    assert len({(x.z_threshold, x.window_minutes, x.persistence_windows) for x in p.values()}) == 3
    assert ASSETS["RW-031"].thresholds == [] and ASSETS["BRG-017"].thresholds == []
    assert ASSETS["BLD-204"].thresholds[0].kind == "demo_criterion"


def test_deterministic_given_seed():
    a = prepare_asset(make_run(), "BRG-017")
    b = prepare_asset(make_run(), "BRG-017")
    assert a.baseline.config_hash == b.baseline.config_hash and a.z == b.z


def test_quality_causal():
    d = prepare_asset(make_run(), "BLD-204")
    s = next(x for x in d.asset.sensors if x.sensor_id == "TLT-N1")
    full = assess_series(d.asset, s, d.rows["TLT-N1"])
    part = assess_series(d.asset, s, d.rows["TLT-N1"][:100])
    assert [f.status for f in full[:100]] == [f.status for f in part]
