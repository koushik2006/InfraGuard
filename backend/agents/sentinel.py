"""Agent 1 — Sentinel. Runs data-quality checks and the detector on newly ingested windows and
emits a structured AnomalyEvent when the persistence + quality-gate rule holds."""
from __future__ import annotations

from typing import Optional

from backend.agents.base import ToolRecorder
from backend.contracts import AnomalyEvent
from backend.detector.detector import AssetData, find_event, owner_criterion, transient_exceedances


def run_sentinel(data: AssetData, start: int, end: int, event_id: str, run_id: str
                 ) -> tuple[Optional[AnomalyEvent], ToolRecorder, dict]:
    rec = ToolRecorder()
    p = data.asset.detection
    quality = rec.call(
        "run_quality_checks", {"asset_id": data.asset.asset_id, "windows": [start, end]},
        lambda: {sid: [f.status for f in fl[start: end + 1] if f.status != "ok"] for sid, fl in data.flags.items()},
        lambda r: "; ".join(f"{k}: {len(v)} issue(s)" for k, v in r.items()) or "no issues",
    )
    rec.call("compute_robust_z", {"method": "robust_z", "baseline_version": data.baseline.version,
                                  "threshold": p.z_threshold},
             lambda: [i for i in range(start, end + 1) for s in data.detection_sensors() if data.exceed[s][i]],
             lambda r: f"{len(r)} sensor-window exceedance(s) of |z| ≥ {p.z_threshold}")
    event = rec.call("evaluate_persistence_and_gate",
                     {"rule": f"≥{p.min_exceedances} of {p.persistence_windows} windows, all passing quality gate"},
                     lambda: find_event(data, start, end, event_id=event_id, run_id=run_id),
                     lambda r: f"event at window {r.detected_window} ({r.primary_sensor_id})" if r else "no event")
    transients = transient_exceedances(data, start, end)
    if event:
        rec.call("check_corroboration", {"asset_id": data.asset.asset_id},
                 lambda: event.corroborating_sensors,
                 lambda r: f"corroborated by {', '.join(r)}" if r else "no corroborating sensor")
        rec.call("check_owner_criteria", {"asset_id": data.asset.asset_id},
                 lambda: owner_criterion(data, event.detected_window),
                 lambda r: f"{r.label}: {'EXCEEDED' if r.exceeded else 'not exceeded'}" if r.configured else r.label)
    return event, rec, {"quality_issues": quality, "transients": transients}
