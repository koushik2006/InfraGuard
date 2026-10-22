"""What-If Investigation Lab. Every intervention changes the actual scenario inputs and re-runs
the real deterministic pipeline in a sandbox run. Results are compared field by field.
Sandbox work orders are never approvable and never touch the live incident workflow."""
from __future__ import annotations

import hashlib
import json
from datetime import timedelta
from typing import Any, Optional

from backend.contracts import Intervention, RunConfig
from backend.db.database import Database, dumps, now_iso
from backend.detector.detector import AssetData, find_event, prepare_asset
from backend.orchestrator import pipeline
from backend.scenarios.assets import ASSETS, SIM_START, VARIANTS, iso, parse_iso
from backend.version import versions

SANDBOX_WO = "Proposal (sandbox — not approvable)"


def _horizon(data: AssetData, cursor_iso: str, horizon: str) -> int:
    if horizon == "end":
        return data.n - 1
    w = timedelta(minutes=data.asset.detection.window_minutes)
    return min(data.n - 1, int((parse_iso(cursor_iso) - SIM_START) / w) - 1)


def apply_spec(base: RunConfig, asset_id: str, spec: list[dict], cursor_iso: str) -> tuple[RunConfig, Optional[str]]:
    cfg = base.model_copy(deep=True)
    follow = None
    for iv in spec:
        t = iv["type"]
        if t in ("frozen_sensor", "stale_sensor"):
            sensors = {s.sensor_id for s in ASSETS[asset_id].sensors}
            if iv["sensor_id"] not in sensors:
                raise ValueError(f"{iv['sensor_id']} is not a sensor of {asset_id}")
            cfg.interventions.append(Intervention(type=t, sensor_id=iv["sensor_id"],
                                                  from_time=iv.get("from_time") or cursor_iso,
                                                  label=f"what-if {t} on {iv['sensor_id']}"))
        elif t == "variant":
            if iv["variant"] not in VARIANTS[asset_id]:
                raise ValueError(f"unknown variant {iv['variant']}")
            cfg.variants[asset_id] = iv["variant"]
        elif t == "environment":
            if iv["preset"] not in ("nominal", "heatwave", "cold_snap"):
                raise ValueError("unknown environment preset")
            cfg.environment = iv["preset"]
        elif t == "follow_up":
            if iv["set"] not in ("persists", "improves", "insufficient"):
                raise ValueError("unknown follow-up set")
            follow = iv["set"]
        else:
            raise ValueError(f"unknown intervention type {t}")
    return cfg, follow


def evaluate(cfg: RunConfig, asset_id: str, cursor_iso: str, horizon: str, follow: Optional[str],
             focus_sensor: Optional[str]) -> dict[str, Any]:
    data = prepare_asset(cfg, asset_id)
    hi = _horizon(data, cursor_iso, horizon)
    out: dict[str, Any] = {"horizon_window": hi, "horizon_time": data.rows[data.asset.sensors[0].sensor_id][hi]["t_end"],
                           "baseline_version": data.baseline.version}
    q = {}
    for s in data.asset.sensors:
        bad = [f.status for f in data.flags[s.sensor_id][data.n_ref: hi + 1] if f.status != "ok"]
        q[f"quality.{s.sensor_id}"] = (f"{len(bad)} flagged window(s): " + ", ".join(sorted(set(bad)))) if bad else "OK"
    event = find_event(data, data.n_ref, hi, event_id="WI-EVT", run_id="whatif")
    inv = tri = wo = None
    verifs, retri = [], []
    if event:
        event = pipeline.update_event(event, data, hi)
        chain = pipeline.run_chain(event, data, [], "WI-INC", "WI-WO")
        inv, tri, wo = chain.investigation, chain.triage, chain.work_order
        if event.owner_criterion.exceeded:
            retri.append(pipeline.retriage(event, inv, data, hi))
        if follow:
            start = parse_iso(out["horizon_time"]) + timedelta(hours=6)
            res, _, _ = pipeline.run_verify(event, data, hi, follow, start, "WI-INC",
                                            [r.ref_id for r in inv.evidence_refs[:3]])
            verifs.append(res)
    fields = pipeline.decision_fields(event, inv, tri, wo, verifs, retri)
    fields.update(q)
    fields["work_order.state"] = SANDBOX_WO if wo else "No proposal (no anomaly event)"
    if follow and not event:
        fields["verification[0].outcome"] = "not run — no anomaly event to verify"
    # compact series for the chart overlay
    sid = focus_sensor or (event.primary_sensor_id if event else next(s.sensor_id for s in data.asset.sensors if s.primary))
    sensor = next(s for s in data.asset.sensors if s.sensor_id == sid)
    feat = (event.deviations[0].feature if event and event.primary_sensor_id == sid
            else (sensor.detection_features or sensor.features)[0])
    lo = max(0, data.n_ref - 48)
    out["series"] = {"sensor_id": sid, "feature": feat, "points": [
        {"i": i, "v": data.rows[sid][i]["features"].get(feat), "q": data.flags[sid][i].status,
         "z": data.z[sid][i].get(feat)} for i in range(lo, hi + 1)]}
    out["fields"] = fields
    out["event"] = event.model_dump() if event else None
    out["triage"] = tri.model_dump() if tri else None
    out["verification"] = verifs[0].model_dump() if verifs else None
    out["hypotheses"] = [h.model_dump(include={"key", "title", "support", "rank"}) for h in inv.hypotheses] if inv else []
    out["_data"] = data
    out["_event"] = event
    return out


def explain(before: dict, after: dict, spec: list[dict], asset_id: str) -> list[str]:
    """Explains the result (or the absence of change) from the actual detection rules and inputs."""
    a = ASSETS[asset_id]
    p = a.detection
    rule = (f"Detection rule for {asset_id}: |robust z| ≥ {p.z_threshold} in ≥ {p.min_exceedances} of "
            f"{p.persistence_windows} consecutive windows, all passing the data-quality gate.")
    lines = [rule]
    bd, ad = before["_data"], after["_data"]
    be, ae = before["_event"], after["_event"]
    for iv in spec:
        if iv["type"] in ("frozen_sensor", "stale_sensor"):
            sid = iv["sensor_id"]
            flags = ad.flags[sid][ad.n_ref: after["horizon_window"] + 1]
            n_bad = sum(f.status != "ok" for f in flags)
            kind = "frozen" if iv["type"] == "frozen_sensor" else "stale/missing"
            sensor = next(s for s in a.sensors if s.sensor_id == sid)
            if not sensor.detection_features:
                lines.append(f"{sid} is a {sensor.kind} sensor and is not used for detection; it only provides context.")
            if n_bad == 0:
                lines.append(f"No {kind} windows on {sid} before the horizon: the frozen-sensor rule needs "
                             f"≥ {p.frozen_windows} identical consecutive windows (stale: ≥ {p.stale_after_windows} "
                             f"missing windows).")
            else:
                lines.append(f"{sid}: {n_bad} window(s) flagged by the data-quality checks ({kind}); those windows "
                             f"cannot count toward detection or corroboration.")
            if be and iv.get("from_time", "") and be.detected_time <= (iv.get("from_time") or after["horizon_time"]):
                lines.append(f"The fault starts after the original detection at {be.detected_time}; windows already "
                             f"used for that detection are unchanged.")
            if be and ae and be.primary_sensor_id == sid and ae.primary_sensor_id != sid:
                lines.append(f"Primary sensor changed from {sid} to {ae.primary_sensor_id}: {sid} no longer passes the "
                             f"quality gate, so another sensor meeting the rule triggered instead.")
            if be and ae and sid in be.corroborating_sensors and sid not in ae.corroborating_sensors:
                lines.append(f"{sid} no longer counts as corroboration (quality gate failed).")
        elif iv["type"] == "environment":
            lines.append(f"Environment preset '{iv['preset']}' shifts temperature by a bounded amount during monitoring days.")
            if a.detection.temperature_compensation:
                lines.append("This asset uses temperature compensation: detection runs on the residual after removing "
                             "the reference-period temperature effect.")
        elif iv["type"] == "variant":
            lines.append(f"Scenario variant changed to '{iv['variant']}' (deterministic component only; same noise seed).")
        elif iv["type"] == "follow_up":
            lines.append(f"Predefined follow-up set '{iv['set']}' was generated and passed to the Verifier.")
    if be is None and ae is None:
        lines.append("Neither run met the persistence rule before the horizon, so no anomaly event exists in either.")
    return lines


def run_whatif(db: Database, base: RunConfig, asset_id: str, spec: list[dict], cursor_iso: str,
               horizon: str = "cursor", actor: str = "demo user", record: bool = True,
               focus_sensor: Optional[str] = None) -> dict:
    if asset_id not in ASSETS:
        raise ValueError("unknown asset")
    after_cfg, follow = apply_spec(base, asset_id, spec, cursor_iso)
    focus = focus_sensor or next((iv["sensor_id"] for iv in spec if "sensor_id" in iv), None)
    before = evaluate(base, asset_id, cursor_iso, horizon, None, focus)
    after = evaluate(after_cfg, asset_id, cursor_iso, horizon, follow, focus)
    diff = pipeline.diff_fields(before["fields"], after["fields"])
    lines = explain(before, after, spec, asset_id)
    if not diff:
        lines.append("Result unchanged: with these inputs the deterministic rules produce the same decisions. "
                     "The lab does not force a different outcome.")
    payload = {
        "label": "What-if simulation run (sandbox) — hypothetical scenario change, not observed data",
        "asset_id": asset_id, "base_config": base.model_dump(), "after_config": after_cfg.model_dump(),
        "interventions": spec, "horizon": horizon, "cursor": cursor_iso, "seed": base.seed,
        "created_at": now_iso(), "versions": versions(),
        "before": {k: v for k, v in before.items() if not k.startswith("_")},
        "after": {k: v for k, v in after.items() if not k.startswith("_")},
        "diff": diff, "explanation": lines,
        "approval_gate": "Not exercised: sandbox proposals cannot be approved and trigger no real-world action.",
    }
    digest = hashlib.sha256(json.dumps({"b": payload["before"]["fields"], "a": payload["after"]["fields"]},
                                       sort_keys=True, default=str).encode()).hexdigest()[:16]
    payload["result_digest"] = digest
    if record:
        wid = db.next_id("whatif", "WIF")
        payload["whatif_id"] = wid
        db.execute("INSERT INTO whatif_runs VALUES (?,?,?)", (wid, payload["created_at"], dumps(payload)))
        db.execute("INSERT INTO runs VALUES (?,?,?,?,?,?)",
                   (wid, "whatif", payload["label"], dumps(after_cfg), dumps(versions()), payload["created_at"]))
        db.audit(action="whatif_run", actor=actor, actor_type="human", asset_id=asset_id, sim_time=cursor_iso,
                 summary=f"What-if sandbox run {wid} on {asset_id}: {len(diff)} field(s) changed",
                 detail={"whatif_id": wid, "interventions": spec})
    return payload


def replay_whatif(db: Database, whatif_id: str) -> dict:
    row = db.one("SELECT json FROM whatif_runs WHERE whatif_id=?", (whatif_id,))
    if not row:
        raise KeyError(whatif_id)
    rec = json.loads(row["json"])
    base = RunConfig.model_validate(rec["base_config"])
    again = run_whatif(db, base, rec["asset_id"], rec["interventions"], rec["cursor"], rec["horizon"], record=False)
    same = again["result_digest"] == rec["result_digest"]
    return {"whatif_id": whatif_id, "reproducible": same, "recorded_digest": rec["result_digest"],
            "replayed_digest": again["result_digest"],
            "diff": [] if same else pipeline.diff_fields(rec["after"]["fields"], again["after"]["fields"])}
