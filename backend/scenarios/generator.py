"""Deterministic, seeded generator for the SIMULATED scenarios.

Bridge accelerometers are generated as short raw acceleration snippets per window
(25 Hz, 512 samples) and reduced to window features (RMS, peak, dominant frequency)
with a real FFT, so the detector works on computed features, not on labels.

The random stream depends only on (seed, asset). Scenario variants and environment
presets change deterministic components only, so a what-if comparison isolates the
effect of the change rather than re-rolling the noise.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timedelta
from functools import lru_cache
from typing import Optional

import numpy as np

from backend.scenarios.assets import (
    ASSETS, MONITOR_START, SIM_START, iso, reference_windows, window_count,
)

FS = 25.0
N_SAMPLES = 512
F1_REF = 3.20  # Hz, first vertical mode of the simulated bridge
F2_REF = 7.85
MODE_SHAPE = {"ACC-M1": 1.0, "ACC-Q1": 0.71, "ACC-P2": 0.22}
MODE2_SHAPE = {"ACC-M1": 0.15, "ACC-Q1": 0.9, "ACC-P2": 0.6}
DEV_AMP = {"ACC-M1": 0.45, "ACC-Q1": 0.30, "ACC-P2": 0.10}
TRUCK_WINDOW = 321
BRIDGE_DEV_ONSET = 352
BUILDING_DRIFT_ONSET = 102
BUILDING_DRIFT_RATE = 0.007  # mrad / hour
BRIDGE_MISSING = {"ACC-P2": {140, 141, 410}}
BUILDING_MISSING = {"TLT-N1": {80}}
BUILDING_IMPLAUSIBLE = {"TLT-E1": {118: 999.0}}

ENV_PRESETS = {
    "nominal": 0.0,
    "heatwave": 8.0,    # bounded preset: +8 °C during monitoring days
    "cold_snap": -8.0,  # bounded preset: -8 °C during monitoring days
}


def _rng(seed: int, *keys: str) -> np.random.Generator:
    h = hashlib.sha256(("|".join([str(seed), *keys])).encode()).digest()
    return np.random.default_rng(int.from_bytes(h[:8], "little"))


def _env_offset(t: datetime, environment: str) -> float:
    """Bounded environmental preset; ramps in over 6 h after monitoring starts."""
    amp = ENV_PRESETS[environment]
    if amp == 0.0 or t < MONITOR_START:
        return 0.0
    ramp = min(1.0, (t - MONITOR_START).total_seconds() / (6 * 3600))
    return amp * ramp


def _hour(t: datetime) -> float:
    return t.hour + t.minute / 60.0


# ---------------------------------------------------------------------------
# Bridge
# ---------------------------------------------------------------------------
def _traffic_factor(h: float) -> float:
    peaks = np.exp(-((h - 8.5) / 1.5) ** 2) + 0.85 * np.exp(-((h - 18.0) / 1.7) ** 2)
    day = 0.35 if 7.0 <= h <= 21.0 else 0.0
    return 0.25 + 0.75 * peaks + day


def _vib_features(a: np.ndarray) -> dict[str, float]:
    x = a - a.mean()
    rms = float(np.sqrt(np.mean(x ** 2)))
    peak = float(np.max(np.abs(x)))
    win = np.hanning(len(x))
    spec = np.abs(np.fft.rfft(x * win))
    freqs = np.fft.rfftfreq(len(x), 1.0 / FS)
    band = (freqs >= 1.5) & (freqs <= 5.0)  # first vertical mode band
    idx = np.flatnonzero(band)
    k = idx[np.argmax(spec[idx])]
    # parabolic interpolation around the spectral peak for sub-bin resolution
    if 0 < k < len(spec) - 1:
        y0, y1, y2 = np.log(spec[k - 1] + 1e-12), np.log(spec[k] + 1e-12), np.log(spec[k + 1] + 1e-12)
        denom = y0 - 2 * y1 + y2
        delta = 0.5 * (y0 - y2) / denom if denom != 0 else 0.0
    else:
        delta = 0.0
    dom = float((k + delta) * FS / len(x))
    return {"rms": round(rms, 4), "peak": round(peak, 4), "dom_freq": round(dom, 4)}


def _bridge_windows(seed: int, times: list[datetime], dev_ramp: list[float], truck: list[bool],
                    environment: str, stream: str) -> tuple[dict[str, list[dict]], list[dict]]:
    rng = _rng(seed, "BRG-017", stream)
    t = np.arange(N_SAMPLES) / FS
    day_offsets = rng.normal(0.0, 1.2, size=16)
    out: dict[str, list[dict]] = {s: [] for s in ("ACC-M1", "ACC-Q1", "ACC-P2", "TMP-B1")}
    env: list[dict] = []
    for i, ts in enumerate(times):
        h = _hour(ts + timedelta(minutes=7.5))
        d = min(int((ts - SIM_START).total_seconds() // 86400), 15)
        temp = 22.0 + 6.0 * np.sin(2 * np.pi * (h - 9.0) / 24.0) + day_offsets[d] \
            + 0.3 * rng.standard_normal() + _env_offset(ts, environment)
        tf = _traffic_factor(h) * float(np.exp(rng.normal(0.0, 0.15)))
        base_amp = 6.0 * tf + 0.8
        f1 = F1_REF * (1.0 - 0.0015 * (temp - 22.0)) * (1.0 - 0.06 * dev_ramp[i])
        f2 = F2_REF * (1.0 - 0.0015 * (temp - 22.0)) * (1.0 - 0.02 * dev_ramp[i])
        phases = rng.uniform(0, 2 * np.pi, size=3)
        mod = 1.0 + 0.3 * np.sin(2 * np.pi * 0.05 * t + phases[2])
        for sid in ("ACC-M1", "ACC-Q1", "ACC-P2"):
            noise = rng.normal(0.0, 0.8, size=N_SAMPLES)
            amp = base_amp * MODE_SHAPE[sid] * (1.0 + DEV_AMP[sid] * dev_ramp[i])
            a = amp * np.sin(2 * np.pi * f1 * t + phases[0]) * mod \
                + 0.25 * base_amp * MODE2_SHAPE[sid] * np.sin(2 * np.pi * f2 * t + phases[1]) + noise
            if truck[i]:
                t0 = 6.0
                burst = 38.0 * MODE_SHAPE[sid] * np.exp(-(t - t0) / 2.5) * (t >= t0) \
                    * np.sin(2 * np.pi * f1 * t)
                a = a + burst
            out[sid].append(_vib_features(a))
        out["TMP-B1"].append({"temp": round(float(temp), 3)})
        env.append({"temperature_c": round(float(temp), 2), "traffic_index": round(float(tf), 3),
                    "heavy_vehicle": bool(truck[i])})
    return out, env


# ---------------------------------------------------------------------------
# Building
# ---------------------------------------------------------------------------
def _building_windows(seed: int, times: list[datetime], drift: list[float], environment: str,
                      stream: str) -> tuple[dict[str, list[dict]], list[dict]]:
    rng = _rng(seed, "BLD-204", stream)
    day_offsets = rng.normal(0.0, 1.5, size=16)
    out: dict[str, list[dict]] = {s: [] for s in ("TLT-N1", "TLT-E1", "TMP-A1")}
    env: list[dict] = []
    for i, ts in enumerate(times):
        h = _hour(ts + timedelta(minutes=30))
        d = min(int((ts - SIM_START).total_seconds() // 86400), 15)
        temp = 18.0 + 7.0 * np.sin(2 * np.pi * (h - 10.0) / 24.0) + day_offsets[d] \
            + 0.25 * rng.standard_normal() + _env_offset(ts, environment)
        n1 = 0.40 + 0.018 * (temp - 18.0) + rng.normal(0.0, 0.006) + drift[i]
        e1 = -0.15 + 0.011 * (temp - 18.0) + rng.normal(0.0, 0.006) + 0.3 * drift[i]
        out["TLT-N1"].append({"tilt": round(float(n1), 5)})
        out["TLT-E1"].append({"tilt": round(float(e1), 5)})
        out["TMP-A1"].append({"temp": round(float(temp), 3)})
        env.append({"temperature_c": round(float(temp), 2), "wind_ms": round(float(abs(rng.normal(4, 1.5))), 1)})
    return out, env


# ---------------------------------------------------------------------------
# Retaining wall
# ---------------------------------------------------------------------------
def _wall_windows(seed: int, times: list[datetime], environment: str, stream: str):
    rng = _rng(seed, "RW-031", stream)
    day_offsets = rng.normal(0.0, 1.0, size=16)
    out: dict[str, list[dict]] = {s: [] for s in ("IN-01", "IN-02", "CM-01")}
    env: list[dict] = []
    for i, ts in enumerate(times):
        h = _hour(ts + timedelta(minutes=30))
        d = min(int((ts - SIM_START).total_seconds() // 86400), 15)
        temp = 15.0 + 5.0 * np.sin(2 * np.pi * (h - 10.0) / 24.0) + day_offsets[d] \
            + 0.3 * rng.standard_normal() + _env_offset(ts, environment)
        rain = float(max(0.0, rng.normal(-0.5, 0.8)))
        out["IN-01"].append({"tilt": round(float(1.10 + 0.004 * (temp - 15) + rng.normal(0, 0.01)), 5)})
        out["IN-02"].append({"tilt": round(float(0.85 + 0.003 * (temp - 15) + rng.normal(0, 0.01)), 5)})
        out["CM-01"].append({"width": round(float(0.42 - 0.002 * (temp - 15) + rng.normal(0, 0.003)), 5)})
        env.append({"temperature_c": round(float(temp), 2), "rain_mm": round(rain, 2)})
    return out, env


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def _times(asset_id: str, origin: datetime, n: int) -> list[datetime]:
    w = timedelta(minutes=ASSETS[asset_id].detection.window_minutes)
    return [origin + i * w for i in range(n)]


def _rows(asset_id: str, sensor_feats: dict[str, list[dict]], times: list[datetime], phase_fn,
          index_offset: int = 0) -> dict[str, list[dict]]:
    w = timedelta(minutes=ASSETS[asset_id].detection.window_minutes)
    rows: dict[str, list[dict]] = {}
    for sid, feats in sensor_feats.items():
        rows[sid] = [
            {"window_index": index_offset + i, "t_start": iso(ts), "t_end": iso(ts + w),
             "phase": phase_fn(index_offset + i), "features": dict(f)}
            for i, (ts, f) in enumerate(zip(times, feats))
        ]
    return rows


@lru_cache(maxsize=64)
def _generate_cached(seed: int, asset_id: str, variant: str, environment: str):
    asset = ASSETS[asset_id]
    n = window_count(asset)
    nref = reference_windows(asset)
    times = _times(asset_id, SIM_START, n)
    if asset_id == "BRG-017":
        dev = [0.0] * n
        truck = [False] * n
        if variant in ("persistent_deviation", "benign_transient"):
            truck[TRUCK_WINDOW] = True
        if variant == "persistent_deviation":
            for i in range(BRIDGE_DEV_ONSET, n):
                dev[i] = min(1.0, (i - BRIDGE_DEV_ONSET + 1) / 2.0)
        feats, env = _bridge_windows(seed, times, dev, truck, environment, "main")
        missing = BRIDGE_MISSING
        implausible: dict = {}
    elif asset_id == "BLD-204":
        drift = [0.0] * n
        if variant == "gradual_drift":
            drift = [max(0.0, (i - BUILDING_DRIFT_ONSET)) * BUILDING_DRIFT_RATE for i in range(n)]
        feats, env = _building_windows(seed, times, drift, environment, "main")
        missing = BUILDING_MISSING
        implausible = BUILDING_IMPLAUSIBLE
    else:
        feats, env = _wall_windows(seed, times, environment, "main")
        missing, implausible = {}, {}

    for sid, idxs in missing.items():
        for i in idxs:
            feats[sid][i] = {k: None for k in feats[sid][i]}
    for sid, spec in implausible.items():
        for i, val in spec.items():
            feats[sid][i] = {k: val for k in feats[sid][i]}

    rows = _rows(asset_id, feats, times, lambda i: "reference" if i < nref else "monitoring")
    env_rows = [{"window_index": i, "t_start": iso(ts), **e} for i, (ts, e) in enumerate(zip(times, env))]
    return rows, env_rows


def generate(seed: int, asset_id: str, variant: str, environment: str = "nominal",
             interventions: Optional[list[dict]] = None) -> tuple[dict[str, list[dict]], list[dict]]:
    """Full scenario for one asset: per-sensor window rows (features may be None = missing)."""
    rows, env = _generate_cached(seed, asset_id, variant, environment)
    rows = {sid: [dict(r, features=dict(r["features"])) for r in rs] for sid, rs in rows.items()}
    for iv in interventions or []:
        apply_intervention(rows, iv)
    return rows, [dict(e) for e in env]


def apply_intervention(rows: dict[str, list[dict]], iv: dict) -> None:
    sid = iv["sensor_id"]
    if sid not in rows:
        return
    series = rows[sid]
    start = next((i for i, r in enumerate(series) if r["t_start"] >= iv["from_time"]), None)
    if start is None:
        return
    if iv["type"] == "frozen_sensor":
        # A frozen logger keeps re-sending its last record unchanged.
        last = next((series[j]["features"] for j in range(start - 1, -1, -1)
                     if all(v is not None for v in series[j]["features"].values())), None)
        if last is None:
            return
        for r in series[start:]:
            r["features"] = dict(last)
    elif iv["type"] == "stale_sensor":
        for r in series[start:]:
            r["features"] = {k: None for k in r["features"]}


def generate_follow_up(seed: int, asset_id: str, follow_up_set: str, start: datetime,
                       n_windows: int, environment: str = "nominal",
                       context: Optional[dict] = None) -> dict[str, list[dict]]:
    """Predefined follow-up reading sets (SIMULATED), generated deterministically."""
    times = _times(asset_id, start, n_windows)
    stream = f"follow_up:{start.isoformat()}"
    context = context or {}
    if asset_id == "BRG-017":
        ramp = 1.0 if follow_up_set in ("persists", "insufficient") else 0.0
        feats, _ = _bridge_windows(seed, times, [ramp] * n_windows, [False] * n_windows, environment, stream)
    elif asset_id == "BLD-204":
        level = float(context.get("drift_level", 0.25))
        if follow_up_set == "improves":
            drift = [0.004] * n_windows
        else:
            drift = [level + BUILDING_DRIFT_RATE * i for i in range(n_windows)]
        feats, _ = _building_windows(seed, times, drift, environment, stream)
    else:
        feats, _ = _wall_windows(seed, times, environment, stream)
    if follow_up_set == "insufficient":
        # Logger outage: only every 4th window is delivered.
        for sid in feats:
            for i in range(n_windows):
                if i % 4 != 0:
                    feats[sid][i] = {k: None for k in feats[sid][i]}
    return _rows(asset_id, feats, times, lambda i: "follow_up", index_offset=100000)
