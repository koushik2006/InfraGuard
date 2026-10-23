"""FastAPI application. Run: python -m uvicorn backend.api.main:app --port 8000"""
from __future__ import annotations

import asyncio
import functools
import os
from contextlib import asynccontextmanager
from typing import Any, Literal, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
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
from backend.scenarios.directory import DEMO_USERS, TEAMS
from backend.scenarios.fixtures import SENSOR_FEATURE_LABELS
from backend.version import versions

db = Database()
# Agent stages run one at a time by default ("Continue to next step"); INFRAGUARD_AGENT_MODE=auto runs them back to back.
engine = Engine(db, staged=os.environ.get("INFRAGUARD_AGENT_MODE", "staged").lower() != "auto")


def locked(fn):
    """Reads of engine state must not interleave with a reset or tick running on another thread."""
    @functools.wraps(fn)
    def wrapper(*a, **k):
        with engine.lock:
            return fn(*a, **k)
    return wrapper


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
    role: Literal["viewer", "engineer", "asset_owner", "maintenance"] = "engineer"


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


class AdvanceBody(Actor):
    expected_state: Optional[str] = None


class FollowUpBody(Actor):
    set: Literal["persists", "improves", "insufficient"]


class CloseBody(Actor):
    note: str


class AssignBody(Actor):
    team: str
    person: str
    due_date: str


class ProgressBody(Actor):
    note: str = ""
    delay_reason: str = ""


class AttachmentBody(BaseModel):
    filename: str
    content_type: str
    data_base64: str


class EvidenceBody(Actor):
    note: str
    attachment: Optional[AttachmentBody] = None


class ReviewBody(Actor):
    decision: Literal["verify", "further_work"]
    reason: str = ""


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
@locked
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
@locked
def scenario():
    return {"run": engine.run.model_dump(), "run_id": engine.run_id,
            "variants": {a: v for a, v in VARIANTS.items() if a in engine.active},
            "labelled_events": {a: v for a, v in LABELLED_EVENTS.items() if a in engine.active}, "data_source": get_datasource().label,
            "environment_presets": {"nominal": 0, "heatwave": "+8 °C on monitoring days (bounded)",
                                    "cold_snap": "-8 °C on monitoring days (bounded)"},
            "generator": {"bridge": "25 Hz × 512-sample acceleration snippets per 15-min window → RMS, peak, "
                                    "dominant frequency (FFT, 1.5–5 Hz band)",
                          "building": "hourly tilt with temperature coupling 0.018 mrad/°C (N1) + drift 0.007 mrad/h",
                          "retaining_wall": "hourly tilt & crack width, normal behaviour"},
            "simulated": True}


# ----------------------------------------------------------------------------- assets
@app.get("/api/assets")
@locked
def assets():
    return [engine.asset_summary(a) for a in engine.active]


@app.get("/api/assets/{asset_id}")
@locked
def asset(asset_id: str):
    if asset_id not in engine.active:
        raise HTTPException(404, "unknown asset")
    d = engine.data[asset_id]
    return {"config": d.asset.model_dump(), "baseline": d.baseline.model_dump(), "summary": engine.asset_summary(asset_id),
            "records": get_datasource().records(asset_id), "feature_labels": SENSOR_FEATURE_LABELS}


@app.get("/api/assets/{asset_id}/sensors")
@locked
def sensors(asset_id: str):
    """Per-sensor live state for the 3D view. Every flagged marker is tied to a real finding of an incident, or is
    explicitly labelled as a transient observation / continuation of a closed incident."""
    if asset_id not in engine.active:
        raise HTTPException(404, "unknown asset")
    d = engine.data[asset_id]
    upto = engine.ingested[asset_id]
    inc = engine._open_incident(asset_id)
    ev = loads(db.one("SELECT json FROM anomaly_events WHERE event_id=?", (inc["event_id"],))["json"]) if inc else None
    closed = None
    if not inc:
        row = db.one("SELECT i.incident_id iid, e.json j FROM incidents i JOIN anomaly_events e ON e.event_id=i.event_id "
                     "WHERE i.run_id=? AND i.asset_id=? AND i.closed=1 ORDER BY i.created_at DESC", (engine.run_id, asset_id))
        closed = {"incident_id": row["iid"], **loads(row["j"])} if row else None
    refs = [loads(r["json"]) for r in db.all("SELECT json FROM evidence_refs WHERE incident_id=?", (inc["incident_id"],))] if inc else []
    findings = {f["sensor_id"]: f for f in (ev or {}).get("findings", [])}
    closed_findings = {f["sensor_id"]: f for f in (closed or {}).get("findings", [])}
    thr = d.asset.detection.z_threshold
    obs_thr = round(0.7 * thr, 2)
    out = []
    for s in d.asset.sensors:
        sid = s.sensor_id
        fnd = findings.get(sid)
        feat = fnd["feature"] if fnd else (s.detection_features or s.features)[0]
        fl = d.flags[sid][upto]
        zrow = d.z[sid][upto]
        z = zrow.get(feat)
        role = fnd["role"] if fnd else None
        kind = "incident_finding" if fnd else None
        incident_id = inc["incident_id"] if fnd and inc else None
        if fl.status != "ok":
            state, reason = "data_quality", (f"{fl.status.capitalize()}: {fl.detail}. Excluded from detection; a sensor issue, not a structural finding.")
        elif role in ("primary", "corroborating"):
            state = "escalation" if inc["escalation"] and role == "primary" else "investigate"
            reason = fnd["reason"]
        elif fnd:  # context finding
            state, reason = "observation", fnd["reason"]
        elif closed and sid in closed_findings and (d.exceed[sid][upto] or (not s.detection_features and z is not None and abs(z) >= obs_thr)):
            state, kind, incident_id = "observation", "closed_incident", closed["incident_id"]
            reason = f"The deviation continues, but it belongs to closed incident {closed['incident_id']} and is not re-opened as a new incident."
        elif d.exceed[sid][upto]:
            state, kind = "observation", "transient"
            reason = (f"|z| = {abs(z):.1f} ≥ {thr} in the latest window, but the persistence rule (≥{d.asset.detection.min_exceedances} of "
                      f"{d.asset.detection.persistence_windows} windows) is not met. The Sentinel logs this as a transient observation; it is not an incident.")
        elif not s.detection_features and z is not None and abs(z) >= obs_thr:
            state, kind = "observation", "transient"
            reason = (f"Context sensor (not used for detection): |z| = {abs(z):.1f} ≥ {obs_thr} (0.7 × threshold) with no open incident. "
                      "Shown as supporting context only; not an incident.")
        else:
            state, reason = "normal", "Within this sensor's own baseline range."
        fb = feature_baseline(d.baseline, sid, feat)
        out.append({
            "state": state, "state_reason": reason, "finding_kind": kind, "finding": fnd,
            "component": {"id": s.component_id, "name": s.component_name, "mapped": bool(s.component_id)},
            "sensor_id": sid, "kind": s.kind, "location": s.location, "schematic": s.schematic.model_dump() if s.schematic else None,
            "feature": feat, "feature_label": SENSOR_FEATURE_LABELS.get(feat, feat), "unit": s.units.get(feat, ""),
            "latest": d.rows[sid][upto]["features"].get(feat), "latest_time": d.rows[sid][upto]["t_end"],
            "z": z, "exceeding": d.exceed[sid][upto], "quality": fl.status, "quality_detail": fl.detail,
            "detection_sensor": bool(s.detection_features), "baseline_median": fb.median if fb else None,
            "baseline_version": d.baseline.version, "baseline_status": d.baseline.status,
            "trend": [d.rows[sid][i]["features"].get(feat) for i in range(max(0, upto - 47), upto + 1)],
            "trend_quality": [d.flags[sid][i].status for i in range(max(0, upto - 47), upto + 1)],
            "incident_role": role, "incident_id": incident_id,
            "anomaly_interval": {"onset": fnd["onset_time"], "last": ev["last_time"]} if fnd and ev else None,
            "evidence": [{"ref_id": r["ref_id"], "title": r["title"], "summary": r["summary"]} for r in refs if r["source_id"].startswith(sid)],
        })

    def latest(sid: str, feature: str):
        return d.rows[sid][upto]["features"].get(feature) if sid in d.rows and d.flags[sid][upto].status == "ok" else None

    e_row = d.env[upto] if d.env else {}
    env = {"temperature_c": latest("TMP-B1", "temp"), "wind_ms": latest("WND-1", "wind"),
           "traffic_index": e_row.get("traffic_index"), "heavy_vehicle": e_row.get("heavy_vehicle"),
           "time": d.rows["TMP-B1"][upto]["t_end"],
           "note": "Simulated environment feed; traffic index is a simulated proxy, not a traffic count."}
    incident = None
    if inc:
        brief = engine._incident_brief(inc)
        incident = {**brief, "findings_count": len(findings), "finding_sensors": list(findings)}
    return {"asset_id": asset_id, "cursor": iso(engine.cursor), "sensors": out, "environment": env, "incident": incident,
            "reporting": sum(1 for x in out if x["quality"] == "ok"), "total": len(out),
            "open_incident": inc["incident_id"] if inc else None, "status": engine.asset_status(asset_id)}


@app.get("/api/assets/{asset_id}/series")
@locked
def series(asset_id: str, sensor_id: str, feature: str, window: int = 0):
    if asset_id not in engine.active:
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
@locked
def incidents(all_runs: bool = False):
    q = "SELECT * FROM incidents" + ("" if all_runs else " WHERE run_id = ?") + " ORDER BY created_at DESC"
    rows = db.all(q, () if all_runs else (engine.run_id,))
    return [engine._incident_brief(r) for r in rows if r["asset_id"] in engine.active]


@app.get("/api/incidents/{incident_id}")
@locked
def incident(incident_id: str):
    return engine.incident(incident_id)


@app.post("/api/incidents/{incident_id}/decision")
def decide(incident_id: str, b: ApprovalRequest):
    return engine.decide(incident_id, b)


@app.post("/api/incidents/{incident_id}/advance")
def advance(incident_id: str, b: AdvanceBody):
    return engine.advance_incident(incident_id, b.actor, b.role, b.expected_state)


@app.post("/api/incidents/{incident_id}/replan")
def replan(incident_id: str, b: Actor):
    return engine.replan(incident_id, b.actor, b.role)


@app.post("/api/incidents/{incident_id}/follow-up")
def follow_up(incident_id: str, b: FollowUpBody):
    return engine.load_follow_up(incident_id, b.set, b.actor, b.role)


@app.post("/api/incidents/{incident_id}/close")
def close(incident_id: str, b: CloseBody):
    return engine.close_incident(incident_id, b.actor, b.role, b.note)


@app.get("/api/directory")
def directory():
    """Fictional demo teams, officers and users (no authentication in this demo)."""
    return {"teams": TEAMS, "users": DEMO_USERS, "demo": True}


@app.get("/api/work-orders")
@locked
def work_orders():
    """Work orders of the current run for active assets, newest first."""
    return engine.work_order_rows()


@app.get("/api/work-orders/{wo_id}")
@locked
def work_order(wo_id: str):
    engine.check_overdue()
    v = engine.work_order_view(wo_id)
    w = db.one("SELECT incident_id, asset_id FROM work_orders WHERE work_order_id=?", (wo_id,))
    return {**v, "incident_id": w["incident_id"], "asset_id": w["asset_id"],
            "history_count": db.one("SELECT COUNT(*) c FROM work_order_events WHERE work_order_id=?", (wo_id,))["c"]}


@app.get("/api/work-orders/{wo_id}/history")
@locked
def work_order_history(wo_id: str):
    engine.check_overdue()
    return engine.work_order_history(wo_id)


@app.post("/api/work-orders/{wo_id}/assign")
def wo_assign(wo_id: str, b: AssignBody):
    return engine.assign_work_order(wo_id, b.team, b.person, b.due_date, b.actor, b.role)


@app.post("/api/work-orders/{wo_id}/progress")
def wo_progress(wo_id: str, b: ProgressBody):
    return engine.update_progress(wo_id, b.note, b.delay_reason, b.actor, b.role)


@app.post("/api/work-orders/{wo_id}/evidence")
def wo_evidence(wo_id: str, b: EvidenceBody):
    return engine.submit_evidence(wo_id, b.note, b.attachment.model_dump() if b.attachment else None, b.actor, b.role)


@app.post("/api/work-orders/{wo_id}/review")
def wo_review(wo_id: str, b: ReviewBody):
    return engine.review_work_order(wo_id, b.decision, b.reason, b.actor, b.role)


@app.get("/api/work-orders/{wo_id}/evidence-file")
def wo_evidence_file(wo_id: str):
    try:
        path, att = engine.evidence_path(wo_id)
    except WorkflowError as e:
        raise HTTPException(e.status_code, str(e))
    return FileResponse(path, media_type=att.content_type, filename=att.filename)


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
@locked
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
            "detection": {a: ASSETS[a].detection.model_dump() for a in engine.active}}


@app.get("/api/metrics")
def metrics():
    from backend.evaluation import detection_metrics
    return detection_metrics()
