"""Robust z-score detector with persistence, corroboration and change-point estimate.

z = (x - median) / (1.4826 x MAD), computed on window features against the asset's own
baseline. The score is an anomaly indicator, never a probability of failure. An anomaly
event requires >= k exceeding windows out of the last N (per-asset config) AND a passing
data-quality gate on all N windows of the triggering sensor.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Optional

from backend.baseline.service import compute_baseline, derive_features, feature_baseline
from backend.contracts import (
    AnomalyEvent, AssetConfig, BaselineConfig, DataQualityGate, FeatureDeviation,
    OwnerCriterionCheck, QualityFlag, RunConfig, TempModel,
)
from backend.detector.quality import assess_series
from backend.scenarios.assets import ASSETS, reference_windows
from backend.scenarios.datasource import get_datasource


@dataclass
class AssetData:
    asset: AssetConfig
    run: RunConfig
    rows: dict[str, list[dict]]
    flags: dict[str, list[QualityFlag]]
    env: list[dict]
    baseline: BaselineConfig
    temp_models: list[TempModel]
    n_ref: int
    z: dict[str, list[dict[str, Optional[float]]]] = field(default_factory=dict)
    exceed: dict[str, list[bool]] = field(default_factory=dict)

    @property
    def n(self) -> int:
        return len(next(iter(self.rows.values())))

    def detection_sensors(self) -> list[str]:
        return [s.sensor_id for s in self.asset.sensors
                if s.detection_features and s.sensor_id not in self.baseline.insufficient_sensors]


def prepare_asset(run: RunConfig, asset_id: str, asset_override: Optional[AssetConfig] = None,
                  rows_override: Optional[dict[str, list[dict]]] = None) -> AssetData:
    asset = asset_override or ASSETS[asset_id]
    if rows_override is not None:
        rows, env = rows_override, []
    else:
        ivs = [iv.model_dump() for iv in run.interventions]
        ivs = [iv for iv in ivs if iv["sensor_id"] in {s.sensor_id for s in asset.sensors}]
        rows, env = get_datasource().windows(run.seed, asset_id, run.variants[asset_id], run.environment, ivs)
    flags = {s.sensor_id: assess_series(asset, s, rows[s.sensor_id]) for s in asset.sensors}
    n_ref = reference_windows(asset)
    baseline, temp_models = compute_baseline(asset, rows, flags, n_ref)
    data = AssetData(asset=asset, run=run, rows=rows, flags=flags, env=env, baseline=baseline,
                     temp_models=temp_models, n_ref=n_ref)
    score_all(data)
    return data


def score_rows(asset: AssetConfig, baseline: BaselineConfig, sensor_id: str, rows: list[dict],
               flags: list[QualityFlag]) -> tuple[list[dict[str, Optional[float]]], list[bool]]:
    s = next(x for x in asset.sensors if x.sensor_id == sensor_id)
    thr = asset.detection.z_threshold
    zs, ex = [], []
    for r, fl in zip(rows, flags):
        zrow: dict[str, Optional[float]] = {}
        for feat in s.detection_features or s.features:
            fb = feature_baseline(baseline, sensor_id, feat)
            v = r["features"].get(feat)
            if fb is None or v is None or fl.status != "ok" or sensor_id in baseline.insufficient_sensors:
                zrow[feat] = None
            else:
                zrow[feat] = round((v - fb.median) / fb.scale, 4)
        zs.append(zrow)
        ex.append(bool(s.detection_features) and fl.status == "ok"
                  and any(z is not None and abs(z) >= thr for f, z in zrow.items() if f in s.detection_features))
    return zs, ex


def score_all(data: AssetData) -> None:
    for s in data.asset.sensors:
        data.z[s.sensor_id], data.exceed[s.sensor_id] = score_rows(
            data.asset, data.baseline, s.sensor_id, data.rows[s.sensor_id], data.flags[s.sensor_id])


def _window_ok(data: AssetData, sid: str, lo: int, hi: int) -> bool:
    return all(data.flags[sid][j].status == "ok" for j in range(lo, hi + 1))


def sensor_triggers(data: AssetData, sid: str, i: int) -> bool:
    p = data.asset.detection
    lo = i - p.persistence_windows + 1
    if lo < data.n_ref:
        return False
    if not _window_ok(data, sid, lo, i):
        return False
    return sum(data.exceed[sid][lo: i + 1]) >= p.min_exceedances


def owner_criterion(data: AssetData, i: int) -> OwnerCriterionCheck:
    if not data.asset.thresholds:
        return OwnerCriterionCheck(configured=False, exceeded=False,
                                   label="No engineering safety threshold configured")
    worst: Optional[OwnerCriterionCheck] = None
    for th in data.asset.thresholds:
        v = data.rows[th.sensor_id][i]["features"].get(th.feature)
        if data.flags[th.sensor_id][i].status != "ok":
            v = None
        exceeded = False
        if v is not None:
            exceeded = (v > th.limit if th.direction == "above" else
                        v < th.limit if th.direction == "below" else abs(v) > th.limit)
        chk = OwnerCriterionCheck(configured=True, exceeded=exceeded, kind=th.kind, label=th.label,
                                  value=None if v is None else round(v, 5), limit=th.limit)
        if worst is None or (exceeded and not worst.exceeded):
            worst = chk
    return worst  # type: ignore[return-value]


def change_point(data: AssetData, sid: str, feat: str, i: int) -> Optional[int]:
    """Single mean-shift change-point on z over [monitoring start, i] (max standardized mean difference)."""
    pts = [(j, data.z[sid][j].get(feat)) for j in range(data.n_ref, i + 1)]
    pts = [(j, z) for j, z in pts if z is not None]
    if len(pts) < 4:
        return None
    zs = [z for _, z in pts]
    n = len(zs)
    total = sum(zs)
    best, best_j, left = 0.0, None, 0.0
    for k in range(1, n - 1):
        left += zs[k - 1]
        n1, n2 = k, n - k
        stat = abs(left / n1 - (total - left) / n2) * (n1 * n2 / n) ** 0.5
        if stat > best:
            best, best_j = stat, pts[k][0]
    return best_j


def input_hash(data: AssetData, upto: int) -> str:
    payload = {sid: [r["features"] for r in rs[: upto + 1]] for sid, rs in sorted(data.rows.items())}
    payload["_flags"] = {sid: [f.status for f in fl[: upto + 1]] for sid, fl in sorted(data.flags.items())}
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()[:16]


def build_event(data: AssetData, i: int, candidates: list[str], event_id: str, run_id: str) -> AnomalyEvent:
    p = data.asset.detection
    cfg_primary = next(s.sensor_id for s in data.asset.sensors if s.primary)

    def max_abs_z(sid: str) -> float:
        return max((abs(z) for z in data.z[sid][i].values() if z is not None), default=0.0)

    primary = cfg_primary if cfg_primary in candidates else max(candidates, key=max_abs_z)
    sensor = next(s for s in data.asset.sensors if s.sensor_id == primary)
    devs = []
    for feat in sensor.detection_features:
        z = data.z[primary][i].get(feat)
        fb = feature_baseline(data.baseline, primary, feat)
        v = data.rows[primary][i]["features"].get(feat)
        if z is None or fb is None or v is None:
            continue
        devs.append(FeatureDeviation(feature=feat, unit=fb.unit, value=round(v, 5), median=round(fb.median, 5),
                                     scale=round(fb.scale, 5), z=round(z, 2)))
    devs.sort(key=lambda d: -abs(d.z))
    onset = i
    while onset - 1 >= data.n_ref and data.exceed[primary][onset - 1]:
        onset -= 1
    lo = i - p.persistence_windows + 1
    corroborating = [sid for sid in candidates if sid != primary]
    issues = []
    for s in data.asset.sensors:
        bad = [data.flags[s.sensor_id][j] for j in range(lo, i + 1) if data.flags[s.sensor_id][j].status != "ok"]
        if bad:
            issues.append(f"{s.sensor_id}: {bad[-1].status} ({bad[-1].detail})")
    top = devs[0].feature if devs else sensor.detection_features[0]
    cp = change_point(data, primary, top, i)
    rows = data.rows[primary]
    return AnomalyEvent(
        event_id=event_id, asset_id=data.asset.asset_id, primary_sensor_id=primary, deviations=devs,
        onset_window=onset, onset_time=rows[onset]["t_start"], detected_window=i, detected_time=rows[i]["t_end"],
        last_window=i, last_time=rows[i]["t_end"], persistence_count=sum(data.exceed[primary][onset: i + 1]),
        persistence_required=p.min_exceedances, persistence_window=p.persistence_windows,
        corroborating_sensors=corroborating,
        data_quality=DataQualityGate(passed=True, checked_windows=p.persistence_windows, issues=issues),
        change_point_window=cp, change_point_time=rows[cp]["t_start"] if cp is not None else None,
        method=f"Robust z-score (median / 1.4826·MAD) on {', '.join(sensor.detection_features)}",
        z_threshold=p.z_threshold, window_minutes=p.window_minutes, baseline_version=data.baseline.version,
        detection_params=p, owner_criterion=owner_criterion(data, i), scenario_seed=data.run.seed,
        run_id=run_id, input_hash=input_hash(data, i),
    )


def find_event(data: AssetData, start: int, end: int, event_id: str = "EV-TMP", run_id: str = "run") -> Optional[AnomalyEvent]:
    """First window in [start, end] at which the persistence + quality-gate rule holds."""
    sensors = data.detection_sensors()
    for i in range(max(start, data.n_ref), min(end, data.n - 1) + 1):
        cands = [sid for sid in sensors if sensor_triggers(data, sid, i)]
        if cands:
            return build_event(data, i, cands, event_id, run_id)
    return None


def transient_exceedances(data: AssetData, start: int, end: int) -> list[dict]:
    """Single/short exceedances that did NOT meet persistence — shown so users see not every change alerts."""
    out = []
    p = data.asset.detection
    for sid in data.detection_sensors():
        for i in range(max(start, data.n_ref), min(end, data.n - 1) + 1):
            if data.exceed[sid][i]:
                # part of a persistent run if any trigger window [j-N+1, j] containing i fired
                hi = min(data.n - 1, end, i + p.persistence_windows - 1)
                if not any(sensor_triggers(data, sid, j) for j in range(i, hi + 1)):
                    zrow = data.z[sid][i]
                    feat, z = max(((f, v) for f, v in zrow.items() if v is not None), key=lambda t: abs(t[1]))
                    out.append({"sensor_id": sid, "window_index": i, "t_start": data.rows[sid][i]["t_start"],
                                "feature": feat, "z": z,
                                "reason": f"Exceeded |z| ≥ {p.z_threshold} in 1 window; persistence rule needs "
                                          f"{p.min_exceedances} of {p.persistence_windows} windows"})
    return out


def scan_all_events(data: AssetData, run_id: str = "eval") -> list[AnomalyEvent]:
    """Offline evaluation helper: events over the whole monitoring period, one per persistent run."""
    events = []
    i = data.n_ref
    k = 0
    while i < data.n:
        ev = find_event(data, i, data.n - 1, event_id=f"EVAL-{k}", run_id=run_id)
        if ev is None:
            break
        events.append(ev)
        k += 1
        # skip to the end of this exceedance run on the primary sensor
        j = ev.detected_window
        while j < data.n and any(data.exceed[s][j] for s in data.detection_sensors()):
            j += 1
        i = j + 1
    return events


def rederive_follow_up(data: AssetData, rows: dict[str, list[dict]]) -> dict[str, list[QualityFlag]]:
    flags = {s.sensor_id: assess_series(data.asset, s, rows[s.sensor_id]) for s in data.asset.sensors}
    derive_features(data.asset, rows, flags, data.temp_models)
    return flags
