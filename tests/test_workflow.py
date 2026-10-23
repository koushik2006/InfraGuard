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


def test_only_bridge_alpha_is_active_by_default(engine):
    snap = engine.snapshot()
    assert [a["asset_id"] for a in snap["assets"]] == ["BRG-017"]
    assert snap["assets"][0]["name"] == "Bridge Alpha"
    engine.tick(400)
    assert {i["asset_id"] for i in engine.snapshot()["incidents"]} <= {"BRG-017"}


def test_additional_assets_are_enabled_by_data_not_redesign():
    """Escalation only comes from an owner-supplied criterion; enabling assets is just the active list."""
    from backend.db.database import Database
    from backend.orchestrator.engine import Engine
    e = Engine(Database(":memory:"), active_assets=["BRG-017", "BLD-204", "RW-031"])
    e.tick(400)
    inc = {i["asset_id"]: i for i in e.snapshot()["incidents"]}
    assert inc["BLD-204"]["escalation"] is True          # demo criterion exceeded
    assert inc["BRG-017"]["escalation"] is False         # no criterion configured
    statuses = {a["asset_id"]: a["status"] for a in e.snapshot()["assets"]}
    assert statuses["BLD-204"] == "Escalation required" and statuses["BRG-017"] == "Investigate"
    assert statuses["RW-031"] == "No anomaly detected"


def test_api_hides_inactive_assets_and_lists_work_orders(engine):
    from fastapi.testclient import TestClient
    import backend.api.main as api
    api.engine, api.db = engine, engine.db
    with TestClient(api.app) as c:
        assert [a["asset_id"] for a in c.get("/api/assets").json()] == ["BRG-017"]
        assert c.get("/api/assets/BLD-204").status_code == 404
        assert c.get("/api/assets/BLD-204/sensors").status_code == 404
        assert set(c.get("/api/scenario").json()["variants"]) == {"BRG-017"}
        assert c.get("/api/work-orders").json() == []
        opened(engine)
        rows = c.get("/api/work-orders").json()
        assert len(rows) == 1 and rows[0]["status"] == "proposed" and rows[0]["asset_id"] == "BRG-017"
        d = c.get(f"/api/work-orders/{rows[0]['work_order_id']}").json()
        assert d["incident_id"] == rows[0]["incident_id"] and d["work_order"]["label"] == "Proposal: requires human review"
        assert c.get("/api/work-orders/WO-9999").status_code == 404


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


# ---------------------------------------------------------------- digital twin sensor states
def sensor_states(engine):
    """Same logic as GET /api/assets/BRG-017/sensors, exercised through the API with this engine."""
    from fastapi.testclient import TestClient
    import backend.api.main as api
    api.engine, api.db = engine, engine.db
    with TestClient(api.app) as c:
        return {s["sensor_id"]: s for s in c.get("/api/assets/BRG-017/sensors").json()["sensors"]}


def test_twin_states_come_from_backend_detection(engine):
    s = sensor_states(engine)
    assert len(s) == 9 and all(x["state"] == "normal" for x in s.values())
    engine.tick(60)  # past the 08:15 truck: transient only
    s = sensor_states(engine)
    assert all(x["state"] in ("normal", "observation") for x in s.values())
    assert engine.snapshot()["incidents"] == []
    opened(engine)
    s = sensor_states(engine)
    assert s["ACC-M1"]["state"] == "investigate" and s["ACC-Q1"]["state"] == "investigate"
    assert s["TLT-T1"]["state"] == "normal" and s["TMP-B1"]["state"] == "normal"
    assert s["STR-G1"]["state"] == "observation" and not s["STR-G1"]["detection_sensor"]  # context only


def test_context_sensors_cannot_trigger_events(engine):
    from backend.detector.detector import prepare_asset, scan_all_events
    from tests.conftest import make_run
    d = prepare_asset(make_run(**{"BRG-017": "benign_transient"}), "BRG-017")
    assert max(abs(z) for z in (r["strain"] for r in d.z["STR-G1"][d.n_ref:] if r["strain"] is not None)) >= 3.5
    assert scan_all_events(d) == []  # the truck moves strain far beyond threshold, yet no alert


def test_frozen_fault_marks_sensor_data_quality(engine):
    opened(engine)
    engine.inject_fault("TMP-B1", "frozen_sensor", "tester")
    engine.tick(5)
    assert sensor_states(engine)["TMP-B1"]["state"] == "data_quality"


# ---------------------------------------------------------------- staged (step-by-step) agent execution
def staged_engine():
    from backend.db.database import Database
    from backend.orchestrator.engine import Engine
    return Engine(Database(":memory:"), staged=True)


def agents_run(engine, inc):
    return [r["agent"] for r in engine.incident(inc)["agent_runs"]]


def test_staged_mode_stops_after_each_agent_and_never_auto_approves():
    e = staged_engine()
    e.advance_until_event()
    inc = e.snapshot()["incidents"][0]["incident_id"]
    d = e.incident(inc)
    assert d["incident"]["state"] == "DETECTED" and agents_run(e, inc) == ["sentinel"]
    assert d["investigation"] is None and d["triage"] == [] and d["work_orders"] == []
    assert d["next_stage"]["agent"] == "investigator"

    d = e.advance_incident(inc, "A. Rao", "viewer")          # advancing is not consequential: any role
    assert d["incident"]["state"] == "INVESTIGATING" and agents_run(e, inc) == ["sentinel", "investigator"]
    assert d["investigation"]["evidence_refs"] and d["triage"] == [] and d["work_orders"] == []
    assert d["next_stage"]["agent"] == "prioritiser"

    d = e.advance_incident(inc, "A. Rao", "engineer")
    assert d["incident"]["state"] == "PRIORITISING" and d["triage"][0]["priority"] in ("P1", "P2", "P3", "P4")
    assert d["work_orders"] == [] and d["next_stage"]["agent"] == "planner"

    d = e.advance_incident(inc, "A. Rao", "engineer")
    assert d["incident"]["state"] == "AWAITING_APPROVAL" and d["work_orders"][0]["status"] == "proposed"
    assert d["approvals"] == [] and d["next_stage"] is None and "verifier" not in agents_run(e, inc)
    with pytest.raises(WorkflowError):
        e.advance_incident(inc, "A. Rao", "engineer")         # nothing left to run: approval is a human decision
    acts = [a["action"] for a in e.incident(inc)["audit"]]
    assert acts.count("agent_step_requested") == 3


def test_staged_advance_rejects_stale_double_clicks():
    e = staged_engine()
    e.advance_until_event()
    inc = e.snapshot()["incidents"][0]["incident_id"]
    e.advance_incident(inc, "A", "engineer", expected_state="DETECTED")
    with pytest.raises(WorkflowError):                        # second click carrying the old state must not skip a stage
        e.advance_incident(inc, "A", "engineer", expected_state="DETECTED")
    assert e.incident(inc)["incident"]["state"] == "INVESTIGATING"


def test_staged_results_equal_automatic_results():
    from backend.orchestrator.pipeline import decision_fields
    auto_engine = Engine_auto()
    inc_a = opened(auto_engine)
    st = staged_engine()
    st.advance_until_event()
    inc_s = st.snapshot()["incidents"][0]["incident_id"]
    for _ in range(3):
        st.advance_incident(inc_s, "A", "engineer")
    a, s = auto_engine.incident(inc_a), st.incident(inc_s)
    key = lambda d: ([h["key"] + h["support"] for h in d["investigation"]["hypotheses"]], d["triage"][0]["demonstration_triage_score"],
                     d["triage"][0]["priority"], [x["action"] for x in d["work_orders"][0]["steps"]])
    assert key(a) == key(s)


def Engine_auto():
    from backend.db.database import Database
    from backend.orchestrator.engine import Engine
    return Engine(Database(":memory:"))


def test_staged_incident_follows_the_same_approval_and_verification_rules():
    e = staged_engine()
    e.advance_until_event()
    inc = e.snapshot()["incidents"][0]["incident_id"]
    with pytest.raises(WorkflowError):
        e.decide(inc, ApprovalRequest(decision="approve", **ENG))   # cannot approve before the planner has run
    for _ in range(3):
        e.advance_incident(inc, "A", "engineer")
    with pytest.raises(WorkflowError):
        e.load_follow_up(inc, "improves", **ENG)                    # verifier not before approval
    e.decide(inc, ApprovalRequest(decision="approve", **ENG))
    assert e.load_follow_up(inc, "persists", **ENG)["outcome"] == "persists"
    assert "verifier" in agents_run(e, inc)


def test_replay_works_on_partly_advanced_and_completed_staged_incidents():
    e = staged_engine()
    e.advance_until_event()
    inc = e.snapshot()["incidents"][0]["incident_id"]
    assert replay_incident(e.db, inc)["status"] == "REPRODUCED"      # only the Sentinel has run
    e.advance_incident(inc, "A", "engineer")
    assert replay_incident(e.db, inc)["status"] == "REPRODUCED"
    for _ in range(2):
        e.advance_incident(inc, "A", "engineer")
    assert replay_incident(e.db, inc)["status"] == "REPRODUCED"
