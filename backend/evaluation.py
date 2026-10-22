"""Detection metrics on the LABELLED SIMULATED events (false alerts, missed events, detection delay).

Results on simulated scenarios do not demonstrate real-world generalisation."""
from __future__ import annotations

from functools import lru_cache

from backend.contracts import RunConfig
from backend.detector.detector import prepare_asset, scan_all_events
from backend.scenarios.assets import ASSETS, DEFAULT_VARIANTS, LABELLED_EVENTS, VARIANTS
from backend.version import SCENARIO_ID, versions

SEEDS = [4242, 1, 2, 3, 4, 5, 6, 7, 8, 9]
MATCH_WINDOWS = 24  # an event counts as a detection if it fires within 24 windows after labelled onset


def evaluate_case(seed: int, asset_id: str, variant: str, environment: str = "nominal") -> dict:
    v = dict(DEFAULT_VARIANTS)
    v[asset_id] = variant
    data = prepare_asset(RunConfig(scenario_id=SCENARIO_ID, seed=seed, variants=v, environment=environment), asset_id)
    events = scan_all_events(data)
    labels = LABELLED_EVENTS[asset_id][variant]
    anomalies = [l for l in labels if l["kind"] == "anomaly"]
    matched, delays, false_alerts = set(), [], []
    for e in events:
        hit = next((k for k, l in enumerate(anomalies)
                    if l["onset_window"] <= e.detected_window <= l["onset_window"] + MATCH_WINDOWS), None)
        if hit is None:
            false_alerts.append(e.detected_window)
        elif hit not in matched:
            matched.add(hit)
            delays.append(e.detected_window - anomalies[hit]["onset_window"])
    transient_alerted = any(abs(e.detected_window - l["window"]) <= ASSETS[asset_id].detection.persistence_windows
                            for e in events for l in labels if l["kind"] == "benign_transient")
    return {"seed": seed, "asset_id": asset_id, "variant": variant, "environment": environment,
            "labelled_anomalies": len(anomalies), "detected": len(matched), "missed": len(anomalies) - len(matched),
            "false_alerts": len(false_alerts), "false_alert_windows": false_alerts, "delays_windows": delays,
            "window_minutes": ASSETS[asset_id].detection.window_minutes, "benign_transient_alerted": transient_alerted}


@lru_cache(maxsize=1)
def detection_metrics() -> dict:
    cases = []
    for seed in SEEDS:
        for a in ASSETS:
            for var in VARIANTS[a]:
                cases.append(evaluate_case(seed, a, var))
    for seed in SEEDS[:3]:
        for a in ASSETS:
            cases.append(evaluate_case(seed, a, DEFAULT_VARIANTS[a], "heatwave"))
    summary = {}
    for a in ASSETS:
        cs = [c for c in cases if c["asset_id"] == a]
        delays = [d for c in cs for d in c["delays_windows"]]
        wm = ASSETS[a].detection.window_minutes
        summary[a] = {
            "cases": len(cs), "labelled_anomalies": sum(c["labelled_anomalies"] for c in cs),
            "detected": sum(c["detected"] for c in cs), "missed": sum(c["missed"] for c in cs),
            "false_alerts": sum(c["false_alerts"] for c in cs),
            "benign_transient_alerts": sum(c["benign_transient_alerted"] for c in cs),
            "delay_windows_median": sorted(delays)[len(delays) // 2] if delays else None,
            "delay_windows_max": max(delays) if delays else None,
            "delay_minutes_median": sorted(delays)[len(delays) // 2] * wm if delays else None,
            "within_3_windows": sum(d <= 3 for d in delays), "window_minutes": wm,
        }
    return {"summary": summary, "cases": cases, "seeds": SEEDS, "versions": versions(),
            "targets": {"false_alerts_on_normal_replay": 0, "work_orders_with_evidence_and_approval": "100%",
                        "detection_within_windows": 3},
            "caveat": "Measured on labelled SIMULATED scenarios only. These numbers do not show real-world "
                      "generalisation; real structures, sensors and environments behave differently."}
