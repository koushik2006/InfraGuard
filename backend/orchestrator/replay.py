"""Evidence-backed Decision Replay (read-only).

Re-runs an incident from its recorded seed, scenario configuration, baseline version, detection
parameters, fixtures and workflow inputs, then diffs the replayed decisions against the recorded
agent outputs. Human decisions are shown as recorded inputs and are never re-executed. Nothing in
the incident's history is written; only a replay log row is stored in a separate table."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from backend.contracts import (
    AnomalyEvent, InvestigationResult, RunConfig, TriageResult, VerificationResult, WorkOrderDraft,
)
from backend.db.database import Database, dumps, loads, now_iso
from backend.detector.detector import input_hash, prepare_asset
from backend.agents.investigator import investigate
from backend.agents.planner import plan
from backend.agents.prioritiser import prioritise
from backend.orchestrator import pipeline
from backend.scenarios.assets import parse_iso
from backend.version import versions

HISTORY_TABLES = ["incidents", "anomaly_events", "investigations", "evidence_refs", "triage_results",
                  "work_orders", "approvals", "verification_results", "agent_runs", "audit_events", "readings"]

STEP_FOR_ACTION = {
    "anomaly_event_created": "sentinel", "agent_sentinel_done": "sentinel",
    "agent_investigator_done": "investigator", "agent_investigator_fallback": "investigator",
    "agent_prioritiser_done": "prioritiser", "agent_planner_done": "planner", "agent_planner_fallback": "planner",
    "agent_verifier_done": "verifier", "escalation_required": "retriage",
}


def _counts(db: Database, incident_id: str) -> dict[str, int]:
    out = {t: db.one(f"SELECT COUNT(*) c FROM {t} WHERE incident_id = ?", (incident_id,))["c"]
           for t in HISTORY_TABLES if t != "readings"}
    out["readings_total"] = db.one("SELECT COUNT(*) c FROM readings")["c"]
    out["audit_events_total"] = db.one("SELECT COUNT(*) c FROM audit_events")["c"]
    return out


def replay_incident(db: Database, incident_id: str) -> dict[str, Any]:
    inc = db.one("SELECT * FROM incidents WHERE incident_id=?", (incident_id,))
    if not inc:
        raise KeyError(incident_id)
    before_counts = _counts(db, incident_id)
    wi = loads(db.one("SELECT json FROM workflow_inputs WHERE incident_id=?", (incident_id,))["json"])
    runs = [loads(r["json"]) for r in db.all("SELECT json FROM agent_runs WHERE incident_id=? ORDER BY started_at, rowid",
                                             (incident_id,))]
    rec_by_agent: dict[str, list[dict]] = {}
    for r in runs:
        rec_by_agent.setdefault(r["agent"], []).append(r)
    rec_event = AnomalyEvent.model_validate(rec_by_agent["sentinel"][0]["output"])
    rec_inv = InvestigationResult.model_validate(rec_by_agent["investigator"][0]["output"]) if "investigator" in rec_by_agent else None
    rec_tri_rows = db.all("SELECT * FROM triage_results WHERE incident_id=? ORDER BY seq", (incident_id,))
    rec_tri = TriageResult.model_validate(loads(rec_tri_rows[0]["json"])) if rec_tri_rows else None
    rec_retri = [TriageResult.model_validate(loads(r["json"])) for r in rec_tri_rows[1:]]
    rec_wo = WorkOrderDraft.model_validate(rec_by_agent["planner"][0]["output"]) if "planner" in rec_by_agent else None
    rec_ver = [VerificationResult.model_validate(loads(r["json"])) for r in db.all(
        "SELECT json FROM verification_results WHERE incident_id=? ORDER BY created_at", (incident_id,))]

    steps: list[dict[str, Any]] = []
    discrepancies: list[str] = []

    # ---- versions -----------------------------------------------------------------------
    now_v = versions()
    v_changes = {k: {"recorded": wi["versions"].get(k), "current": v} for k, v in now_v.items()
                 if wi["versions"].get(k) != v}
    for k, c in v_changes.items():
        discrepancies.append(f"Version change in {k}: recorded {c['recorded']} vs current {c['current']}")

    # ---- inputs ---------------------------------------------------------------------------
    cfg = RunConfig.model_validate(wi["run_config"])
    data = prepare_asset(cfg, inc["asset_id"])
    steps.append({"step": "baseline", "label": "Re-derive baseline from recorded reference period",
                  "recorded": wi["baseline_version"], "replayed": data.baseline.version,
                  "match": data.baseline.config_hash == wi["baseline_hash"]})
    if not steps[-1]["match"]:
        discrepancies.append("Baseline re-derived from recorded inputs differs from recorded baseline version")
    ih = input_hash(data, rec_event.detected_window)
    steps.append({"step": "inputs", "label": "Regenerate readings + data-quality flags from recorded seed/config",
                  "recorded": rec_event.input_hash, "replayed": ih, "match": ih == rec_event.input_hash})
    if ih != rec_event.input_hash:
        discrepancies.append("Input readings hash differs: the replayed inputs are not identical to the recorded ones")

    # ---- agents -----------------------------------------------------------------------------
    ev, trace, _ = pipeline.detect(data, wi["scan_start"], rec_event.detected_window, rec_event.event_id, rec_event.run_id)
    steps.append({"step": "sentinel", "label": "Sentinel: quality checks, robust z, persistence",
                  "recorded": f"window {rec_event.detected_window} on {rec_event.primary_sensor_id}",
                  "replayed": f"window {ev.detected_window} on {ev.primary_sensor_id}" if ev else "no event",
                  "tool_calls": [c.model_dump() for c in trace.tool_calls]})
    inv = tri = wo = None
    retri: list[TriageResult] = []
    vers: list[VerificationResult] = []
    if ev:
        if rec_inv:
            inv = investigate(ev, data, wi["prior_events"])
            steps.append({"step": "investigator", "label": "Investigator: evidence retrieval and hypothesis rules",
                          "recorded": [f"{h.rank}. {h.key} ({h.support})" for h in rec_inv.hypotheses],
                          "replayed": [f"{h.rank}. {h.key} ({h.support})" for h in inv.hypotheses],
                          "narrative_note": "Narrative wording excluded from the diff (LLM text may vary; "
                                            f"recorded source: {rec_inv.narrative.source})."})
        if inv and rec_tri:
            tri = prioritise(ev, inv, data)
            steps.append({"step": "prioritiser", "label": "Risk Prioritiser: documented triage rules",
                          "recorded": f"{rec_tri.priority} (score {rec_tri.demonstration_triage_score})",
                          "replayed": f"{tri.priority} (score {tri.demonstration_triage_score})"})
        if inv and tri and rec_wo:
            wo = plan(ev, inv, tri, rec_wo.work_order_id, incident_id, data.asset.type)
            steps.append({"step": "planner", "label": "Response Planner: proposed work order",
                          "recorded": f"{rec_wo.work_order_id} {rec_wo.priority}, {len(rec_wo.steps)} steps",
                          "replayed": f"{wo.work_order_id} {wo.priority}, {len(wo.steps)} steps"})
        for r in wi.get("retriage", []):
            evu = pipeline.update_event(ev, data, r.get("upto", r["window"]))
            t = pipeline.retriage(evu, inv, data, r["window"])
            retri.append(t)
            steps.append({"step": "retriage", "label": f"Re-triage at window {r['window']} (owner criterion)",
                          "recorded": rec_retri[len(retri) - 1].priority if len(rec_retri) >= len(retri) else None,
                          "replayed": t.priority})
        approvals = [loads(a["json"]) for a in db.all("SELECT json FROM approvals WHERE incident_id=? ORDER BY created_at",
                                                      (incident_id,))]
        for a in approvals:
            steps.append({"step": "human_decision", "label": f"Human decision ({a['decision']}) by {a['actor']}",
                          "recorded": a["decision"], "replayed": "recorded input — not re-executed", "match": True})
        for k, f in enumerate(wi.get("follow_ups", [])):
            res, _, _ = pipeline.run_verify(ev, data, f["pre_end"], f["set"], parse_iso(f["start"]), incident_id,
                                            rec_ver[k].evidence_refs if k < len(rec_ver) else [])
            vers.append(res)
            steps.append({"step": "verifier", "label": f"Verifier on follow-up set '{f['set']}'",
                          "recorded": rec_ver[k].outcome if k < len(rec_ver) else None, "replayed": res.outcome})

    recorded = pipeline.decision_fields(rec_event, rec_inv, rec_tri, rec_wo, rec_ver, rec_retri)
    replayed = pipeline.decision_fields(ev, inv, tri, wo, vers, retri)
    diff = pipeline.diff_fields(recorded, replayed)
    for s in steps:
        if "match" not in s:
            s["match"] = s["recorded"] == s["replayed"]
    if diff and not v_changes and ih == rec_event.input_hash:
        discrepancies.append("REPRODUCIBILITY DISCREPANCY: identical inputs and versions produced different "
                             "decisions (see diff)")
    elif diff:
        discrepancies.append("Decisions differ; see the version/input differences above for the likely cause")

    # ---- timeline from persisted audit events -------------------------------------------------------
    audit = db.all("SELECT * FROM audit_events WHERE incident_id=? ORDER BY id", (incident_id,))
    step_match = {s["step"]: s["match"] for s in steps}
    timeline = [{"id": a["id"], "ts": a["ts"], "sim_time": a["sim_time"], "actor": a["actor"],
                 "actor_type": a["actor_type"], "action": a["action"], "summary": a["summary"],
                 "from_state": a["from_state"], "to_state": a["to_state"],
                 "replay_check": step_match.get(STEP_FOR_ACTION.get(a["action"], ""), None)} for a in audit]
    after_counts = _counts(db, incident_id)
    mutated = {k: (before_counts[k], after_counts[k]) for k in before_counts if before_counts[k] != after_counts[k]}
    status = "REPRODUCED" if not diff and not v_changes and all(s["match"] for s in steps) else "DISCREPANCY"
    result = {
        "incident_id": incident_id, "asset_id": inc["asset_id"], "status": status, "read_only": True,
        "replayed_at": now_iso(), "scenario_seed": cfg.seed, "run_config": cfg.model_dump(),
        "baseline_version": wi["baseline_version"], "detection_params": rec_event.detection_params.model_dump(),
        "versions": {"recorded": wi["versions"], "current": now_v}, "version_changes": v_changes,
        "steps": steps, "diff": diff, "discrepancies": discrepancies, "timeline": timeline,
        "fields_compared": len(set(recorded) | set(replayed)),
        "history_mutations": mutated or "none (row counts of incident history unchanged)",
        "note": "Read-only replay. Human approvals are shown as recorded inputs and are not duplicated; no work "
                "orders or audit events were created.",
    }
    rid = db.next_id("replay", "RPL")
    result["replay_id"] = rid
    db.execute("INSERT INTO replay_runs VALUES (?,?,?,?,?)", (rid, incident_id, result["replayed_at"], status, dumps(result)))
    return result
