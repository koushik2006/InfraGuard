import sqlite3

import pytest

from backend.contracts import ApprovalRequest
from backend.llm import client as llm
from backend.orchestrator.engine import AccessDenied, WorkflowError
from backend.orchestrator.replay import replay_incident
from backend.orchestrator.whatif import replay_whatif, run_whatif
from backend.scenarios.assets import iso

ENG = dict(actor="A. Rao", role="engineer")


def opened(engine):
    engine.advance_until_event()
    return engine.snapshot()["incidents"][0]["incident_id"]


def test_normal_replay_ignores_truck_then_detects(engine):
    engine.tick(60)  # past 08:15 truck, before the 16:00 deviation
    assert engine.snapshot()["incidents"] == []
    acts = [a["action"] for a in engine.snapshot()["activity"]]
    assert "transient_exceedance_not_alerted" in acts
    inc = opened(engine)
    assert engine.incident(inc)["incident"]["state"] == "AWAITING_APPROVAL"


def test_every_work_order_has_evidence_and_requires_approval(engine):
    inc = opened(engine)
    d = engine.incident(inc)
    wo = d["work_orders"][0]
    assert wo["status"] == "proposed" and wo["label"] == "Proposal: requires human review"
    assert d["investigation"]["evidence_refs"] and all(s["action"] for s in wo["steps"])
    cited = {r for h in d["investigation"]["hypotheses"] for c in h["evidence_for"] + h["evidence_against"] for r in c["refs"]}
    known = {r["ref_id"] for r in d["investigation"]["evidence_refs"]}
    assert cited and cited <= known
    with pytest.raises(WorkflowError):
        engine.load_follow_up(inc, "improves", **ENG)  # not before approval
    with pytest.raises(AccessDenied):
        engine.decide(inc, ApprovalRequest(decision="approve", actor="g", role="viewer"))
    engine.decide(inc, ApprovalRequest(decision="approve", note="ok", **ENG))
    with pytest.raises(WorkflowError):
        engine.decide(inc, ApprovalRequest(decision="approve", **ENG))  # no duplicate approvals
    assert len(engine.incident(inc)["approvals"]) == 1


def test_follow_up_outcomes_and_incident_stays_open(engine):
    inc = opened(engine)
    engine.decide(inc, ApprovalRequest(decision="approve", **ENG))
    assert engine.load_follow_up(inc, "persists", **ENG)["outcome"] == "persists"
    r = engine.load_follow_up(inc, "insufficient", **ENG)
    assert r["outcome"] == "cannot_assess" and r["keeps_incident_open"]
    with pytest.raises(WorkflowError):
        engine.close_incident(inc, "A. Rao", "engineer", "x")  # only after improves
    assert engine.load_follow_up(inc, "improves", **ENG)["outcome"] == "improves"
    assert engine.incident(inc)["incident"]["closed"] == 0  # improves != resolved
    engine.close_incident(inc, "A. Rao", "engineer", "inspection complete")
    assert engine.incident(inc)["incident"]["state"] == "CLOSED_BY_HUMAN"


def test_audit_is_append_only(engine):
    opened(engine)
    with pytest.raises(sqlite3.DatabaseError):
        engine.db.execute("UPDATE audit_events SET summary='x'")
    with pytest.raises(sqlite3.DatabaseError):
        engine.db.execute("DELETE FROM audit_events")


def test_escalation_only_with_owner_criterion(engine):
    engine.tick(400)
    inc = {i["asset_id"]: i for i in engine.snapshot()["incidents"]}
    assert inc["BLD-204"]["escalation"] is True          # demo criterion exceeded
    assert inc["BRG-017"]["escalation"] is False         # no criterion configured
    statuses = {a["asset_id"]: a["status"] for a in engine.snapshot()["assets"]}
    assert statuses["BLD-204"] == "Escalation required" and statuses["BRG-017"] == "Investigate"
    assert statuses["RW-031"] == "No anomaly detected"


def test_replay_is_read_only_and_reproducible(engine):
    inc = opened(engine)
    engine.decide(inc, ApprovalRequest(decision="approve", **ENG))
    engine.load_follow_up(inc, "persists", **ENG)
    counts = {t: engine.db.one(f"SELECT COUNT(*) c FROM {t}")["c"] for t in
              ("audit_events", "approvals", "work_orders", "incidents", "agent_runs", "verification_results")}
    r = replay_incident(engine.db, inc)
    assert r["status"] == "REPRODUCED" and r["diff"] == [] and r["read_only"]
    after = {t: engine.db.one(f"SELECT COUNT(*) c FROM {t}")["c"] for t in counts}
    assert after == counts


def test_replay_flags_discrepancy_when_rules_change(engine, monkeypatch):
    inc = opened(engine)
    import backend.orchestrator.replay as rp
    monkeypatch.setattr(rp, "versions", lambda: {**rp.versions.__wrapped__(), "triage_rules": "changed"} if hasattr(rp.versions, "__wrapped__") else {"triage_rules": "changed"})
    r = replay_incident(engine.db, inc)
    assert r["version_changes"] and r["status"] == "DISCREPANCY"


def test_whatif_changes_state_and_is_reproducible(engine):
    cur = iso(engine.cursor)
    w = run_whatif(engine.db, engine.run, "BRG-017",
                   [{"type": "frozen_sensor", "sensor_id": "ACC-M1", "from_time": "2026-03-05T12:00:00Z"}], cur, "end")
    fields = {d["field"] for d in w["diff"]}
    assert "detection.primary_sensor" in fields and "quality.ACC-M1" in fields
    assert replay_whatif(engine.db, w["whatif_id"])["reproducible"]


def test_whatif_unchanged_is_explained_not_forced(engine):
    cur = iso(engine.cursor)
    w = run_whatif(engine.db, engine.run, "BRG-017", [{"type": "frozen_sensor", "sensor_id": "TMP-B1", "from_time": "2026-03-06T12:00:00Z"}], cur, "cursor")
    assert w["diff"] == [] or all(not d["field"].startswith("detection.anomaly") for d in w["diff"])
    assert any("unchanged" in l.lower() or "No frozen" in l or "context" in l for l in w["explanation"])


def test_whatif_does_not_touch_live_workflow(engine):
    inc_before = engine.db.one("SELECT COUNT(*) c FROM incidents")["c"]
    wo_before = engine.db.one("SELECT COUNT(*) c FROM work_orders")["c"]
    run_whatif(engine.db, engine.run, "BRG-017", [{"type": "follow_up", "set": "improves"}], iso(engine.cursor), "end")
    assert engine.db.one("SELECT COUNT(*) c FROM incidents")["c"] == inc_before
    assert engine.db.one("SELECT COUNT(*) c FROM work_orders")["c"] == wo_before


# ---------------------------------------------------------------- LLM failure modes
def _fb():
    from backend.contracts import NarrativeDraft
    return NarrativeDraft(summary="fallback text", key_points=["k"], citations=["E01"], source="deterministic_fallback")


@pytest.fixture()
def reset_llm():
    yield
    llm.set_transport(None)


def test_llm_timeout_falls_back(reset_llm):
    def boom(s, p):
        raise TimeoutError("slow")
    llm.set_transport(boom)
    out = llm.draft("t", {}, ["E01"], _fb)
    assert out.source == "deterministic_fallback" and "TimeoutError" in out.fallback_reason


def test_llm_malformed_then_valid_retry(reset_llm):
    calls = []
    def flaky(s, p):
        calls.append(1)
        return {"nope": 1} if len(calls) == 1 else {"summary": "A grounded summary of the observed deviation.", "key_points": ["a"], "citations": ["E01"]}
    llm.set_transport(flaky)
    out = llm.draft("t", {}, ["E01"], _fb)
    assert out.source == "llm" and len(calls) == 2


def test_llm_failed_repair_and_bad_content_fall_back(reset_llm):
    llm.set_transport(lambda s, p: {"bad": True})
    assert llm.draft("t", {}, ["E01"], _fb).source == "deterministic_fallback"
    llm.set_transport(lambda s, p: {"summary": "The bridge is safe and will not collapse today.", "key_points": ["x"], "citations": ["E01"]})
    assert llm.draft("t", {}, ["E01"], _fb).source == "deterministic_fallback"
    llm.set_transport(lambda s, p: {"summary": "A grounded summary that cites an invented record.", "key_points": ["x"], "citations": ["E99"]})
    assert llm.draft("t", {}, ["E01"], _fb).source == "deterministic_fallback"


def test_system_works_with_llm_down(engine):
    def down(s, p):
        raise TimeoutError
    llm.set_transport(down)
    try:
        inc = opened(engine)
        runs = engine.incident(inc)["agent_runs"]
        assert any(r["fallback_used"] for r in runs) and engine.incident(inc)["work_orders"]
    finally:
        llm.set_transport(None)
