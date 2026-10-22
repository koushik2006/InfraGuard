"""Deterministic data-quality checks: missing, stale, frozen and implausible readings.

Checks are causal (each window is judged only from itself and earlier windows), so the
live sentinel and an offline replay produce identical flags.
"""
from __future__ import annotations

from backend.contracts import AssetConfig, QualityFlag, SensorConfig


def _all_none(f: dict) -> bool:
    return all(v is None for v in f.values())


def assess_series(asset: AssetConfig, sensor: SensorConfig, rows: list[dict]) -> list[QualityFlag]:
    p = asset.detection
    flags: list[QualityFlag] = []
    missing_run = 0
    identical_run = 1
    last_seen: str | None = None
    for i, r in enumerate(rows):
        f = r["features"]
        if _all_none(f):
            missing_run += 1
            if missing_run >= p.stale_after_windows:
                since = last_seen or "start of record"
                flags.append(QualityFlag(status="stale", detail=f"No data received since {since} "
                                                                f"({missing_run} consecutive windows)"))
            else:
                flags.append(QualityFlag(status="missing", detail="Window has no readings"))
            identical_run = 1
            continue
        missing_run = 0
        last_seen = r["t_end"]
        bad = []
        for k, v in f.items():
            if v is None:
                bad.append(f"{k} missing")
                continue
            lo, hi = p.plausible_range.get(k, (float("-inf"), float("inf")))
            if not (lo <= v <= hi):
                bad.append(f"{k}={v} outside plausible range [{lo}, {hi}]")
        if bad:
            flags.append(QualityFlag(status="implausible", detail="; ".join(bad)))
            identical_run = 1
            continue
        prev = rows[i - 1]["features"] if i > 0 else None
        if prev is not None and not _all_none(prev) and prev == f:
            identical_run += 1
        else:
            identical_run = 1
        if identical_run >= p.frozen_windows:
            flags.append(QualityFlag(status="frozen", detail=f"Identical values for {identical_run} consecutive "
                                                             f"windows (frozen-sensor rule: ≥{p.frozen_windows})"))
        else:
            flags.append(QualityFlag(status="ok"))
    return flags


def sensor_health(flags: list[QualityFlag], lookback: int = 8) -> dict:
    """Summary of the most recent windows: ok / degraded / failed."""
    recent = flags[-lookback:]
    if not recent:
        return {"health": "unavailable", "latest": "missing", "issues": 0, "detail": "No windows ingested"}
    issues = [f for f in recent if f.status != "ok"]
    latest = recent[-1]
    if latest.status in ("stale", "frozen"):
        health = "failed"
    elif latest.status != "ok" or len(issues) >= 2:
        health = "degraded"
    else:
        health = "ok"
    return {"health": health, "latest": latest.status, "issues": len(issues), "detail": latest.detail}
