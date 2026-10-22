"""FastAPI application. Run: python -m uvicorn backend.api.main:app --port 8000"""
from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager
from typing import Any, Literal, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from backend.agents.investigator import HYPOTHESIS_RULES
from backend.agents.prioritiser import PRIORITY_TABLE, TRIAGE_RULES
from backend.agents.verifier import VERIFIER_RULES
from backend.baseline.service import feature_baseline
from backend.contracts import ApprovalRequest
from backend.db.database import Database, loads
from backend.detector.detector import transient_exceedances
from backend.llm import client as llm
from backend.orchestrator.engine import Engine, WorkflowError
from backend.orchestrator.replay import replay_incident
from backend.orchestrator.whatif import replay_whatif, run_whatif
from backend.scenarios.assets import ASSETS, LABELLED_EVENTS, VARIANTS, iso
from backend.scenarios.datasource import get_datasource
from backend.scenarios.fixtures import SENSOR_FEATURE_LABELS
from backend.version import versions

db = Database()
engine = Engine(db)


async def _ticker() -> None:
    while True:
        if engine.running:
            await asyncio.to_thread(engine.tick, 1)
            await asyncio.sleep(1.0 / engine.speed)
        else:
            await asyncio.sleep(0.1)


@asynccontextmanager
async def lifespan(_: FastAPI):
    task = asyncio.create_task(_ticker()) if os.environ.get("INFRAGUARD_NO_TICKER") != "1" else None
    yield
    if task:
        task.cancel()


app = FastAPI(title="InfraGuard API", version=versions()["software"], lifespan=lifespan,
              description="Decision support for structural-health monitoring. SIMULATED DATA. "
                          "Not a structural-safety certification.")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.exception_handler(WorkflowError)
async def _wf(_: Request, exc: WorkflowError):
    return JSONResponse(status_code=exc.status_code, content={"detail": str(exc)})


@app.exception_handler(ValueError)
async def _ve(_: Request, exc: ValueError):
    return JSONResponse(status_code=400, content={"detail": str(exc)})


class Actor(BaseModel):
    actor: str = "Demo Engineer (simulated user)"
    role: Literal["viewer", "engineer", "asset_owner"] = "engineer"


class SpeedBody(BaseModel):
    speed: float


class StepBody(BaseModel):
    ticks: int = 1


class ResetBody(Actor):
    seed: int = 4242
    variants: Optional[dict[str, str]] = None
    environment: Literal["nominal", "heatwave", "cold_snap"] = "nominal"


class FaultBody(Actor):
    sensor_id: str
    kind: Literal["frozen_sensor", "stale_sensor"] = "frozen_sensor"


class FollowUpBody(Actor):
    set: Literal["persists", "improves", "insufficient"]


class CloseBody(Actor):
    note: str


class WOStatusBody(Actor):
    status: Literal["assigned", "in_progress", "completed"]
    note: str = ""


class WhatIfBody(Actor):
    asset_id: str
    interventions: list[dict[str, Any]]
    horizon: Literal["cursor", "end"] = "cursor"
    focus_sensor: Optional[str] = None


# ----------------------------------------------------------------------------- meta
@app.get("/api/health")
def health():
    return {"ok": True, "versions": versions(), "llm": llm.status(), "data_source": get_datasource().label,
            "simulated": True}


@app.get("/api/state")
def state():
    s = engine.snapshot()
    s["llm"] = llm.status()
    s["data_source"] = get_datasource().label
    return s


# ----------------------------------------------------------------------------- simulation controls
@app.post("/api/sim/play")
def play():
    engine.set_running(True)
    return engine.snapshot()["sim"]


@app.post("/api/sim/pause")
def pause():
    engine.set_running(False)
    return engine.snapshot()["sim"]


@app.post("/api/sim/speed")
def speed(b: SpeedBody):
    engine.set_speed(b.speed)
    return engine.snapshot()["sim"]


@app.post("/api/sim/step")
def step(b: StepBody):
    engine.tick(max(1, min(b.ticks, 600)))
    return engine.snapshot()["sim"]


@app.post("/api/sim/advance-to-event")
def advance_to_event():
    return engine.advance_until_event()


@app.post("/api/sim/reset")
def reset(b: ResetBody):
    engine.reset(seed=b.seed, variants=b.variants, environment=b.environment, actor=b.actor)
    return engine.snapshot()


@app.post("/api/sim/inject-fault")
def inject(b: FaultBody):
    return engine.inject_fault(b.sensor_id, b.kind, b.actor)["sim"]


@app.get("/api/scenario")
def scenario():
    return {"run": engine.run.model_dump(), "run_id": engine.run_id, "variants": VARIANTS,
            "labelled_events": LABELLED_EVENTS, "data_source": get_datasource().label,
            "environment_presets": {"nominal": 0, "heatwave": "+8 °C on monitoring days (bounded)",
                                    "cold_snap": "-8 °C on monitoring days (bounded)"},
            "generator": {"bridge": "25 Hz × 512-sample acceleration snippets per 15-min window → RMS, peak, "
                                    "dominant frequency (FFT, 1.5–5 Hz band)",
                          "building": "hourly tilt with temperature coupling 0.018 mrad/°C (N1) + drift 0.007 mrad/h",
                          "retaining_wall": "hourly tilt & crack width, normal behaviour"},
            "simulated": True}


# ----------------------------------------------------------------------------- assets
@app.get("/api/assets")
def assets():
    return [engine.asset_summary(a) for a in ASSETS]


@app.get("/api/assets/{asset_id}")
def asset(asset_id: str):
    if asset_id not in ASSETS:
        raise HTTPException(404, "unknown asset")
    d = engine.data[asset_id]
    return {"config": d.asset.model_dump(), "baseline": d.baseline.model_dump(), "summary": engine.asset_summary(asset_id),
            "records": get_datasource().records(asset_id), "feature_labels": SENSOR_FEATURE_LABELS}


@app.get("/api/assets/{asset_id}/series")
def series(asset_id: str, sensor_id: str, feature: str, window: int = 0):
    if asset_id not in ASSETS:
        raise HTTPException(404, "unknown asset")
    d = engine.data[asset_id]
    if sensor_id not in d.rows:
        raise HTTPException(404, "unknown sensor")
    upto = engine.ingested[asset_id]
    lo = max(0, upto - window + 1) if window else 0
    p = d.asset.detection
    fb = feature_baseline(d.baseline, sensor_id, feature)
    pts = [{"i": i, "t": d.rows[sensor_id][i]["t_start"], "v": d.rows[sensor_id][i]["features"].get(feature),
            "z": d.z[sensor_id][i].get(feature), "q": d.flags[sensor_id][i].status,
            "qd": d.flags[sensor_id][i].detail, "x": d.exceed[sensor_id][i],
            "phase": d.rows[sensor_id][i]["phase"]} for i in range(lo, upto + 1)]
    incidents = []
    for r in db.all("SELECT incident_id, event_id, state FROM incidents WHERE run_id=? AND asset_id=?",
                    (engine.run_id, asset_id)):
        ev = loads(db.one("SELECT json FROM anomaly_events WHERE event_id=?", (r["event_id"],))["json"])
        incidents.append({"incident_id": r["incident_id"], "state": r["state"], "onset_window": ev["onset_window"],
                          "detected_window": ev["detected_window"], "last_window": ev["last_window"],
                          "onset_time": ev["onset_time"], "primary_sensor_id": ev["primary_sensor_id"]})
    follow = db.all("SELECT window_index, t_start, features_json, quality, incident_id FROM readings WHERE run_id=? "
                    "AND sensor_id=? AND phase='follow_up' ORDER BY window_index", (engine.run_id, sensor_id))
    fpts = []
    for f in follow:
        feats = loads(f["features_json"])
        v = feats.get(feature)
        fpts.append({"i": f["window_index"], "t": f["t_start"], "v": v, "q": f["quality"],
                     "z": None if (v is None or fb is None or f["quality"] != "ok") else round((v - fb.median) / fb.scale, 3),
                     "incident_id": f["incident_id"]})
    th = [t.model_dump() for t in d.asset.thresholds if t.sensor_id == sensor_id and t.feature == feature]
    return {
        "asset_id": asset_id, "sensor_id": sensor_id, "feature": feature, "label": SENSOR_FEATURE_LABELS.get(feature, feature),
        "unit": next((s.units.get(feature, "") for s in d.asset.sensors if s.sensor_id == sensor_id), ""),
        "baseline": None if fb is None else {**fb.model_dump(), "band_lo": fb.median - p.z_threshold * fb.scale,
                                             "band_hi": fb.median + p.z_threshold * fb.scale},
        "detection": {"z_threshold": p.z_threshold, "persistence_windows": p.persistence_windows,
                      "min_exceedances": p.min_exceedances, "window_minutes": p.window_minutes},
        "reference_end_index": d.n_ref - 1, "points": pts, "incidents": incidents, "follow_up": fpts,
        "transients": [t for t in transient_exceedances(d, d.n_ref, upto) if t["sensor_id"] == sensor_id
                       and t["window_index"] <= upto - p.persistence_windows + 1],
        "thresholds": th,
        "threshold_label": None if d.asset.thresholds else "No engineering safety threshold configured",
        "is_detection_feature": feature in next(s.detection_features for s in d.asset.sensors if s.sensor_id == sensor_id),
    }


# ----------------------------------------------------------------------------- incidents & workflow
@app.get("/api/incidents")
def incidents(all_runs: bool = False):
    q = "SELECT * FROM incidents" + ("" if all_runs else " WHERE run_id = ?") + " ORDER BY created_at DESC"
    rows = db.all(q, () if all_runs else (engine.run_id,))
    return [engine._incident_brief(r) for r in rows]


@app.get("/api/incidents/{incident_id}")
def incident(incident_id: str):
    return engine.incident(incident_id)


@app.post("/api/incidents/{incident_id}/decision")
def decide(incident_id: str, b: ApprovalRequest):
    return engine.decide(incident_id, b)


@app.post("/api/incidents/{incident_id}/replan")
def replan(incident_id: str, b: Actor):
    return engine.replan(incident_id, b.actor, b.role)


@app.post("/api/incidents/{incident_id}/follow-up")
def follow_up(incident_id: str, b: FollowUpBody):
    return engine.load_follow_up(incident_id, b.set, b.actor, b.role)


@app.post("/api/incidents/{incident_id}/close")
def close(incident_id: str, b: CloseBody):
    return engine.close_incident(incident_id, b.actor, b.role, b.note)


@app.post("/api/work-orders/{wo_id}/status")
def wo_status(wo_id: str, b: WOStatusBody):
    return engine.set_work_order_status(wo_id, b.status, b.actor, b.role, b.note)


@app.post("/api/incidents/{incident_id}/replay")
def replay(incident_id: str):
    try:
        return replay_incident(db, incident_id)
    except KeyError:
        raise HTTPException(404, "unknown incident")


@app.get("/api/incidents/{incident_id}/replays")
def replays(incident_id: str):
    return [{"replay_id": r["replay_id"], "created_at": r["created_at"], "status": r["status"]}
            for r in db.all("SELECT replay_id, created_at, status FROM replay_runs WHERE incident_id=? "
                            "ORDER BY created_at DESC", (incident_id,))]


# ----------------------------------------------------------------------------- audit
@app.get("/api/audit")
def audit(incident_id: Optional[str] = None, limit: int = 300, all_runs: bool = False):
    if incident_id:
        rows = db.all("SELECT * FROM audit_events WHERE incident_id=? ORDER BY id DESC LIMIT ?", (incident_id, limit))
    elif all_runs:
        rows = db.all("SELECT * FROM audit_events ORDER BY id DESC LIMIT ?", (limit,))
    else:
        rows = db.all("SELECT * FROM audit_events WHERE run_id=? OR (run_id IS NULL AND ts >= (SELECT created_at "
                      "FROM runs WHERE run_id=?)) ORDER BY id DESC LIMIT ?", (engine.run_id, engine.run_id, limit))
    return [engine._audit_row(r) for r in rows]


# ----------------------------------------------------------------------------- what-if
@app.post("/api/whatif")
def whatif(b: WhatIfBody):
    return run_whatif(db, engine.run, b.asset_id, b.interventions, iso(engine.cursor), b.horizon, b.actor,
                      focus_sensor=b.focus_sensor)


@app.get("/api/whatif")
def whatif_list():
    out = []
    for r in db.all("SELECT whatif_id, created_at, json FROM whatif_runs ORDER BY created_at DESC LIMIT 30"):
        j = loads(r["json"])
        out.append({"whatif_id": r["whatif_id"], "created_at": r["created_at"], "asset_id": j["asset_id"],
                    "interventions": j["interventions"], "changed_fields": len(j["diff"]), "seed": j["seed"],
                    "cursor": j["cursor"], "horizon": j["horizon"]})
    return out


@app.get("/api/whatif/{whatif_id}")
def whatif_get(whatif_id: str):
    r = db.one("SELECT json FROM whatif_runs WHERE whatif_id=?", (whatif_id,))
    if not r:
        raise HTTPException(404, "unknown what-if run")
    return loads(r["json"])


@app.post("/api/whatif/{whatif_id}/replay")
def whatif_replay(whatif_id: str):
    try:
        return replay_whatif(db, whatif_id)
    except KeyError:
        raise HTTPException(404, "unknown what-if run")


# ----------------------------------------------------------------------------- rules & metrics
@app.get("/api/rules")
def rules():
    return {"triage": TRIAGE_RULES, "priority_table": [{"min_score": r[0], "priority": r[1], "label": r[2],
                                                        "timeframe": r[3]} for r in PRIORITY_TABLE],
            "hypotheses": HYPOTHESIS_RULES, "verifier": VERIFIER_RULES, "versions": versions(),
            "detection": {a: ASSETS[a].detection.model_dump() for a in ASSETS}}


@app.get("/api/metrics")
def metrics():
    from backend.evaluation import detection_metrics
    return detection_metrics()
