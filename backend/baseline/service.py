"""Per-asset baseline service: robust statistics over the asset's own reference period.

A learned baseline is NOT a safe-state baseline. Whether the reference period was
reviewed is stored with every baseline version.
"""
from __future__ import annotations

import hashlib
import json
from typing import Optional

import numpy as np

from backend.contracts import AssetConfig, BaselineConfig, FeatureBaseline, QualityFlag, TempModel

MAD_K = 1.4826


def robust_stats(values: list[float], min_scale: float) -> dict:
    x = np.asarray(values, dtype=float)
    med = float(np.median(x))
    mad = float(np.median(np.abs(x - med)))
    scale = MAD_K * mad
    fallback, detail = False, ""
    if scale < min_scale:
        fallback = True
        mean_abs = float(np.mean(np.abs(x - med))) * 1.2533
        if mean_abs >= min_scale:
            scale, detail = mean_abs, "MAD below floor; used 1.2533 x mean absolute deviation"
        else:
            scale, detail = min_scale, f"MAD and mean absolute deviation below floor; used configured floor {min_scale}"
    return {
        "median": med, "mad": mad, "scale": float(scale), "n": int(len(x)),
        "p05": float(np.percentile(x, 5)), "p95": float(np.percentile(x, 95)),
        "zero_mad_fallback": fallback, "fallback_detail": detail,
    }


def rolling_slope_per_day(values: list[Optional[float]], idx: int, window: int, window_minutes: int) -> Optional[float]:
    """Least-squares slope of the last `window` values ending at idx (causal), in units/day."""
    lo = idx - window + 1
    if lo < 0:
        return None
    seg = values[lo: idx + 1]
    pts = [(i, v) for i, v in enumerate(seg) if v is not None]
    if len(pts) < max(3, int(0.75 * window)):
        return None
    t = np.array([p[0] for p in pts], dtype=float)
    y = np.array([p[1] for p in pts], dtype=float)
    t = t - t.mean()
    denom = float(np.sum(t * t))
    if denom == 0:
        return None
    slope_per_window = float(np.sum(t * (y - y.mean())) / denom)
    return slope_per_window * (24 * 60 / window_minutes)


def fit_temp_model(tilt: list[Optional[float]], temp: list[Optional[float]], ok: list[bool]) -> Optional[dict]:
    pairs = [(a, b) for a, b, g in zip(tilt, temp, ok) if g and a is not None and b is not None]
    if len(pairs) < 10:
        return None
    y = np.array([p[0] for p in pairs])
    x = np.array([p[1] for p in pairs])
    slope, intercept = np.polyfit(x, y, 1)
    return {"intercept": float(intercept), "slope": float(slope), "n": len(pairs),
            "temp_min": float(x.min()), "temp_max": float(x.max())}


def derive_features(asset: AssetConfig, rows: dict[str, list[dict]], flags: dict[str, list[QualityFlag]],
                    temp_models: list[TempModel]) -> None:
    """Adds temperature-compensated residual and causal trend slope to tilt rows in place."""
    if not asset.detection.temperature_compensation:
        return
    p = asset.detection
    temp_rows = rows[p.temperature_sensor_id]
    temp_flags = flags[p.temperature_sensor_id]
    for m in temp_models:
        series = rows[m.sensor_id]
        sflags = flags[m.sensor_id]
        resid: list[Optional[float]] = []
        for r, fl, tr, tfl in zip(series, sflags, temp_rows, temp_flags):
            v = r["features"].get("tilt")
            t = tr["features"].get("temp")
            if fl.status == "ok" and tfl.status == "ok" and v is not None and t is not None:
                resid.append(v - (m.intercept + m.slope_per_degC * t))
            else:
                resid.append(None)
        for i, r in enumerate(series):
            r["features"]["tilt_resid"] = None if resid[i] is None else round(resid[i], 6)
            sl = rolling_slope_per_day(resid, i, p.slope_window, p.window_minutes) if resid[i] is not None else None
            r["features"]["tilt_slope"] = None if sl is None else round(sl, 6)


def compute_baseline(asset: AssetConfig, rows: dict[str, list[dict]], flags: dict[str, list[QualityFlag]],
                     n_reference: int) -> tuple[BaselineConfig, list[TempModel]]:
    p = asset.detection
    notes: list[str] = []
    temp_models: list[TempModel] = []
    if p.temperature_compensation:
        trows = rows[p.temperature_sensor_id][:n_reference]
        tflags = flags[p.temperature_sensor_id][:n_reference]
        for s in asset.sensors:
            if s.kind != "tiltmeter":
                continue
            srows = rows[s.sensor_id][:n_reference]
            sflags = flags[s.sensor_id][:n_reference]
            ok = [a.status == "ok" and b.status == "ok" for a, b in zip(sflags, tflags)]
            fit = fit_temp_model([r["features"].get("tilt") for r in srows],
                                 [r["features"].get("temp") for r in trows], ok)
            if fit:
                temp_models.append(TempModel(
                    sensor_id=s.sensor_id, temperature_sensor_id=p.temperature_sensor_id,
                    intercept=round(fit["intercept"], 6), slope_per_degC=round(fit["slope"], 6), n=fit["n"],
                    temp_min=round(fit["temp_min"], 2), temp_max=round(fit["temp_max"], 2)))
                notes.append(f"{s.sensor_id}: temperature model tilt = {fit['intercept']:.4f} + "
                             f"{fit['slope']:.4f} x T (fitted on {fit['n']} reference windows)")
        derive_features(asset, rows, flags, temp_models)

    feats: list[FeatureBaseline] = []
    insufficient: list[str] = []
    used = 0
    for s in asset.sensors:
        names = list(dict.fromkeys(s.detection_features + s.features))
        srows = rows[s.sensor_id][:n_reference]
        sflags = flags[s.sensor_id][:n_reference]
        for name in names:
            vals = [r["features"].get(name) for r, f in zip(srows, sflags) if f.status == "ok"]
            vals = [v for v in vals if v is not None]
            if len(vals) < p.min_reference_windows:
                if name in s.detection_features and s.sensor_id not in insufficient:
                    insufficient.append(s.sensor_id)
                    notes.append(f"{s.sensor_id}.{name}: only {len(vals)} valid reference windows "
                                 f"(< {p.min_reference_windows}); detection disabled for this sensor")
                if not vals:
                    continue
            st = robust_stats(vals, p.min_scale.get(name, 1e-6))
            used = max(used, st["n"])
            feats.append(FeatureBaseline(sensor_id=s.sensor_id, feature=name, unit=s.units.get(name, ""),
                                         **{k: (round(v, 6) if isinstance(v, float) else v) for k, v in st.items()}))
            if st["zero_mad_fallback"]:
                notes.append(f"{s.sensor_id}.{name}: {st['fallback_detail']}")
    primary = next(s.sensor_id for s in asset.sensors if s.primary)
    if primary in insufficient:
        status = "insufficient_data"
    else:
        status = "validated" if asset.reference_period.reviewed else "provisional"
    payload = {
        "asset": asset.asset_id, "detection": p.model_dump(), "ref": asset.reference_period.model_dump(),
        "features": [f.model_dump() for f in feats], "temp": [t.model_dump() for t in temp_models],
    }
    h = hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()
    baseline = BaselineConfig(
        asset_id=asset.asset_id, version=f"{asset.asset_id}-BL-{h[:8]}", status=status,
        reference_reviewed=asset.reference_period.reviewed, reference_period=asset.reference_period,
        computed_from_windows=used, features=feats, temp_models=temp_models, detection=p,
        config_hash=h, insufficient_sensors=insufficient, notes=notes,
    )
    return baseline, temp_models


def feature_baseline(baseline: BaselineConfig, sensor_id: str, feature: str) -> Optional[FeatureBaseline]:
    return next((f for f in baseline.features if f.sensor_id == sensor_id and f.feature == feature), None)
