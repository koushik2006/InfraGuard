"""Findings, duplicate prevention and the work-order accountability lifecycle (roles enforced on the backend)."""
import base64
import sqlite3

import pytest

from backend.contracts import ApprovalRequest
from backend.db.database import Database
from backend.orchestrator.engine import AccessDenied, Engine, NotFound, WorkflowError

ENG = dict(actor="A. Rao (demo engineer)", role="engineer")
OWNER = dict(actor="K. Iyer (demo asset owner)", role="asset_owner")
TEAM = "Bridge Inspection Team (demo)"
PERSON = "R. Menon (demo officer)"
PNG = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * 64).decode()


def staged(path=":memory:"):
    return Engine(Database(path), staged=True)


def proposed(e):
    e.advance_until_event()
    inc = e.snapshot()["incidents"][0]["incident_id"]
    for _ in range(3):
        e.advance_incident(inc, "A", "viewer")
    return inc, e.incident(inc)["work_orders"][0]["work_order_id"]


def approved(e):
    inc, wo = proposed(e)
    e.decide(inc, ApprovalRequest(decision="approve", note="go", **ENG))
    return inc, wo


def due(e, days=3):
    from datetime import timedelta
    return (e.cursor.date() + timedelta(days=days)).isoformat()


def assigned(e, days=3):
    inc, wo = approved(e)
    e.assign_work_order(wo, TEAM, PERSON, due(e, days), **ENG)
    return inc, wo


# ------------------------------------------------------------------ findings
def test_incident_has_a_finding_for_every_contributing_sensor():
    e = staged()
    e.advance_until_event()
    inc = e.snapshot()["incidents"][0]["incident_id"]
    ev = e.incident(inc)["event"]
    ids = [f["sensor_id"] for f in ev["findings"]]
    assert ids[0] == ev["primary_sensor_id"] and set(ev["corroborating_sensors"]) <= set(ids)
    assert {"ACC-M1", "ACC-Q1", "ACC-P2", "STR-G1"} == set(ids)
    for f in ev["findings"]:
        assert f["component_name"] and f["feature_label"] and f["reason"] and len(f["trend"]) > 10
        assert f["onset_time"] and f["raised_time"] and f["baseline_median"] is not None and f["value"] is not None
    assert [f["role"] for f in ev["findings"] if f["sensor_id"] == "STR-G1"] == ["context"]


def test_every_flagged_marker_maps_to_a_finding():
    from fastapi.testclient import TestClient
    import backend.api.main as api
    e = staged()
    api.engine, api.db = e, e.db
    e.advance_until_event()
    with TestClient(api.app) as c:
        r = c.get("/api/assets/BRG-017/sensors").json()
    flagged = [s for s in r["sensors"] if s["state"] in ("investigate", "escalation", "observation")]
    assert len(flagged) == 4
    ids = set(r["incident"]["finding_sensors"])
    for s in flagged:
        assert s["finding"] is not None and s["sensor_id"] in ids and s["incident_id"] == r["open_incident"]
        assert s["component"]["mapped"] and s["finding"]["component_id"] == s["component"]["id"]
    assert all(s["finding"] is None for s in r["sensors"] if s["state"] == "normal")


def test_all_findings_contribute_to_the_risk_assessment():
    e = staged()
    inc, _ = proposed(e)
    t = e.incident(inc)["triage"][0]
    assert {c["sensor_id"] for c in t["contributing_findings"]} == {"ACC-M1", "ACC-Q1", "ACC-P2", "STR-G1"}
    assert any("Supporting context" in c["counted_as"] for c in t["contributing_findings"] if c["sensor_id"] == "STR-G1")
    assert any("3 finding(s)" in f["observed"] for f in t["factors"])           # magnitude across all detection findings
    assert any(f["name"] == "Corroboration" and f["points"] == 2 for f in t["factors"])
    assert t["uncertainty"]
    assert {x["sensor_id"] for x in e.incident(inc)["investigation"]["finding_evidence"]} == {"ACC-M1", "ACC-Q1", "ACC-P2", "STR-G1"}


def test_continuing_deviation_after_closure_does_not_open_a_second_incident_or_work_order():
    e = staged()
    inc, wo = assigned(e)
    e.submit_evidence(wo, "Bearings cleaned and checked", None, PERSON, "maintenance")
    e.review_work_order(wo, "verify", "OK", **OWNER)
    assert e.incident(inc)["incident"]["closed"] == 1
    e.tick(60)  # the simulated deviation is still present in the data
    assert len(e.snapshot()["incidents"]) == 1 and len(e.work_order_rows()) == 1
    assert "continuing_deviation_not_reopened" in [a["action"] for a in e.incident(inc)["audit"]]


def test_duplicate_work_order_for_one_incident_is_refused_by_code_and_database():
    from backend.contracts import WorkOrderDraft
    e = staged()
    inc, wo = proposed(e)
    dup = WorkOrderDraft.model_validate({**e.incident(inc)["work_orders"][0], "work_order_id": "WO-9999"})
    with pytest.raises(WorkflowError):
        e._store_work_order(dup)
    with pytest.raises(sqlite3.IntegrityError):
        e.db.execute("INSERT INTO work_orders VALUES ('WO-8888', ?, 'BRG-017', 'proposed', '{}', 'x', 'x')", (inc,))


# ------------------------------------------------------------------ approve -> assign -> progress
def test_work_order_exists_as_a_proposal_until_a_human_approves():
    e = staged()
    inc, wo = proposed(e)
    v = e.work_order_view(wo)
    assert v["work_order"]["status"] == "proposed" and v["work_order"]["approved_by"] is None
    with pytest.raises(WorkflowError):
        e.assign_work_order(wo, TEAM, PERSON, due(e), **ENG)           # cannot assign an unapproved proposal
    e.decide(inc, ApprovalRequest(decision="approve", **ENG))
    w = e.work_order_view(wo)["work_order"]
    assert w["status"] == "approved" and w["approved_by"] == ENG["actor"] and w["approved_at"]
    with pytest.raises(WorkflowError):
        e.decide(inc, ApprovalRequest(decision="approve", **ENG))        # no duplicate approval


def test_assignment_rules_are_enforced_on_the_backend():
    e = staged()
    _, wo = approved(e)
    for role in ("viewer", "maintenance"):
        with pytest.raises(AccessDenied):
            e.assign_work_order(wo, TEAM, PERSON, due(e), "someone", role)
    with pytest.raises(WorkflowError):
        e.assign_work_order(wo, "Made-up team", PERSON, due(e), **ENG)
    with pytest.raises(WorkflowError):
        e.assign_work_order(wo, TEAM, "A. Khan (demo officer)", due(e), **ENG)      # person not in that team
    with pytest.raises(WorkflowError):
        e.assign_work_order(wo, TEAM, PERSON, "2020-01-01", **ENG)                  # before the simulated date
    with pytest.raises(WorkflowError):
        e.assign_work_order(wo, TEAM, PERSON, "not-a-date", **ENG)
    v = e.assign_work_order(wo, TEAM, PERSON, due(e), **ENG)
    assert v["work_order"]["status"] == "assigned" and v["work_order"]["assignment"]["assigned_by"] == ENG["actor"]


def test_reassignment_and_deadline_changes_keep_the_previous_record():
    e = staged()
    _, wo = assigned(e)
    e.assign_work_order(wo, "Structural Maintenance Crew (demo)", "T. Nair (demo officer)", due(e, 5), **OWNER)
    hist = e.work_order_history(wo)
    acts = [h["action"] for h in hist]
    assert acts == ["proposed", "approved", "assigned", "reassigned", "deadline_changed"]
    re = next(h for h in hist if h["action"] == "reassigned")
    assert re["detail"]["previous"]["person"] == PERSON and re["actor"] == OWNER["actor"]


def test_progress_updates_respect_the_responsible_person():
    e = staged()
    _, wo = assigned(e)
    with pytest.raises(AccessDenied):
        e.update_progress(wo, "started", "", "S. Gupta (demo officer)", "maintenance")   # not the responsible person
    with pytest.raises(AccessDenied):
        e.update_progress(wo, "started", "", "x", "viewer")
    v = e.update_progress(wo, "Scaffolding up", "Waiting for scaffold delivery", PERSON, "maintenance")
    assert v["work_order"]["status"] == "in_progress" and v["work_order"]["delay_reason"] == "Waiting for scaffold delivery"
    assert e.work_order_history(wo)[-1]["action"] == "progress_update"


def test_overdue_is_computed_from_the_due_date_and_escalated_once():
    e = staged()
    _, wo = assigned(e, days=1)
    assert e.work_order_view(wo)["overdue"] is False
    e.tick(96 * 3)                                           # three simulated days later
    v = e.work_order_view(wo)
    assert v["overdue"] is True and v["escalated"] is True and v["next_action"]["urgent"]
    e.tick(96)
    assert [h["action"] for h in e.work_order_history(wo)].count("overdue_escalation") == 1
    esc = next(h for h in e.work_order_history(wo) if h["action"] == "overdue_escalation")
    assert esc["actor_role"] == "system" and "Escalated" in esc["summary"]
    e.assign_work_order(wo, TEAM, PERSON, due(e, 2), **ENG)  # new deadline clears the overdue state
    assert e.work_order_view(wo)["overdue"] is False


def test_awaiting_verification_and_verified_orders_are_never_overdue():
    e = staged()
    _, wo = assigned(e, days=1)
    e.submit_evidence(wo, "All done", None, PERSON, "maintenance")
    e.tick(96 * 4)
    assert e.work_order_view(wo)["overdue"] is False


# ------------------------------------------------------------------ completion evidence and review
def test_completion_evidence_moves_to_awaiting_verification_and_never_verifies():
    e = staged()
    inc, wo = assigned(e)
    with pytest.raises(WorkflowError):
        e.submit_evidence(wo, "", None, PERSON, "maintenance")                              # note required
    with pytest.raises(AccessDenied):
        e.submit_evidence(wo, "done", None, "S. Gupta (demo officer)", "maintenance")        # not the responsible person
    with pytest.raises(WorkflowError):
        e.submit_evidence(wo, "done", {"filename": "x.exe", "content_type": "application/x-msdownload", "data_base64": PNG}, PERSON, "maintenance")
    with pytest.raises(WorkflowError):
        e.submit_evidence(wo, "done", {"filename": "x.png", "content_type": "image/png", "data_base64": "!!notbase64!!"}, PERSON, "maintenance")
    with pytest.raises(WorkflowError):
        big = base64.b64encode(b"0" * (3 * 1024 * 1024 + 1)).decode()
        e.submit_evidence(wo, "done", {"filename": "x.png", "content_type": "image/png", "data_base64": big}, PERSON, "maintenance")
    v = e.submit_evidence(wo, "Cleaned the bearing shelf", {"filename": "../../photo.png", "content_type": "image/png", "data_base64": PNG}, PERSON, "maintenance")
    w = v["work_order"]
    assert w["status"] == "awaiting_verification" and w["review"] is None and w["completion"]["attachment"]["size"] > 50
    assert e.incident(inc)["incident"]["closed"] == 0
    path, att = e.evidence_path(wo)                                                      # the file really exists and is contained
    assert path.exists() and ".." not in att.stored_as and str(e.evidence_dir) in str(path)
    with pytest.raises(WorkflowError):
        e.submit_evidence(wo, "again", None, PERSON, "maintenance")                       # only one submission while awaiting


def test_review_rules_and_further_work_loop():
    e = staged()
    inc, wo = assigned(e)
    e.update_progress(wo, "on site", "", PERSON, "maintenance")
    with pytest.raises(WorkflowError):
        e.review_work_order(wo, "verify", "", **ENG)                                          # nothing submitted yet
    e.submit_evidence(wo, "First attempt done", None, PERSON, "maintenance")
    for who in (dict(actor="g", role="viewer"), dict(actor=PERSON, role="maintenance")):
        with pytest.raises(AccessDenied):
            e.review_work_order(wo, "verify", "", **who)
    with pytest.raises(AccessDenied):
        e.review_work_order(wo, "verify", "", PERSON, "engineer")                             # cannot verify own work
    with pytest.raises(WorkflowError):
        e.review_work_order(wo, "further_work", "", **ENG)                                     # reason required
    v = e.review_work_order(wo, "further_work", "Photo does not show the bearing plate", **ENG)
    w = v["work_order"]
    assert w["status"] == "returned" and w["review"]["decision"] == "further_work" and w["completion"] is None
    assert w["assignment"]["person"] == PERSON and "Photo does not show" in v["next_action"]["label"]
    e.submit_evidence(wo, "Second attempt, plate photographed", None, PERSON, "maintenance")
    v = e.review_work_order(wo, "verify", "Plate visible, work acceptable", **OWNER)
    assert v["work_order"]["status"] == "verified" and v["work_order"]["review"]["reviewer"] == OWNER["actor"]
    assert e.incident(inc)["incident"]["state"] == "CLOSED_BY_HUMAN"
    acts = [h["action"] for h in e.work_order_history(wo)]
    assert acts == ["proposed", "approved", "assigned", "progress_update", "completion_evidence_submitted", "further_work_requested",
                    "completion_evidence_submitted", "verified"]


def test_approval_or_completion_alone_never_marks_work_verified():
    e = staged()
    inc, wo = assigned(e)
    assert e.work_order_view(wo)["work_order"]["status"] != "verified"
    e.submit_evidence(wo, "done", None, PERSON, "maintenance")
    assert e.work_order_view(wo)["work_order"]["status"] == "awaiting_verification" and e.work_order_view(wo)["work_order"]["review"] is None


# ------------------------------------------------------------------ persistence
def test_history_and_evidence_survive_a_server_restart(tmp_path):
    path = str(tmp_path / "ig.db")
    e = staged(path)
    inc, wo = assigned(e)
    e.update_progress(wo, "On site", "Rain delay", PERSON, "maintenance")
    e.submit_evidence(wo, "Done, see photo", {"filename": "site.png", "content_type": "image/png", "data_base64": PNG}, PERSON, "maintenance")
    before = e.work_order_history(wo)
    e.db.conn.close()
    e2 = Engine(Database(path), staged=True)               # a fresh process opening the same database file
    after = e2.work_order_history(wo)
    assert after == before and [h["action"] for h in after][-1] == "completion_evidence_submitted"
    v = e2.work_order_view(wo)
    assert v["work_order"]["status"] == "awaiting_verification" and v["work_order"]["assignment"]["person"] == PERSON
    assert e2.evidence_path(wo)[0].read_bytes().startswith(b"\x89PNG")
    e2.review_work_order(wo, "verify", "ok", **ENG)
    assert e2.work_order_history(wo)[-1]["actor"] == ENG["actor"]


def test_event_log_is_append_only():
    e = staged()
    _, wo = proposed(e)
    with pytest.raises(sqlite3.DatabaseError):
        e.db.execute("UPDATE work_order_events SET summary='x'")
    with pytest.raises(sqlite3.DatabaseError):
        e.db.execute("DELETE FROM work_order_events")
    with pytest.raises(NotFound):
        e.work_order_history("WO-0000")


# ------------------------------------------------------------------ API surface
def test_api_enforces_roles_and_exposes_history():
    from fastapi.testclient import TestClient
    import backend.api.main as api
    e = staged()
    api.engine, api.db = e, e.db
    inc, wo = approved(e)
    with TestClient(api.app) as c:
        body = dict(team=TEAM, person=PERSON, due_date=due(e))
        assert c.post(f"/api/work-orders/{wo}/assign", json={**body, "actor": "g", "role": "viewer"}).status_code == 403
        assert c.post(f"/api/work-orders/{wo}/assign", json={**body, "actor": "g", "role": "maintenance"}).status_code == 403
        assert c.post(f"/api/work-orders/{wo}/assign", json={**body, "team": "nope", **ENG}).status_code == 409
        assert c.post(f"/api/work-orders/{wo}/assign", json={**body, **ENG}).status_code == 200
        assert c.post(f"/api/work-orders/{wo}/review", json={"decision": "verify", **ENG}).status_code == 409
        r = c.post(f"/api/work-orders/{wo}/evidence", json={"note": "Finished", "attachment": {"filename": "a.png", "content_type": "image/png", "data_base64": PNG},
                                                              "actor": PERSON, "role": "maintenance"})
        assert r.status_code == 200 and r.json()["work_order"]["status"] == "awaiting_verification"
        f = c.get(f"/api/work-orders/{wo}/evidence-file")
        assert f.status_code == 200 and f.content.startswith(b"\x89PNG")
        assert c.post(f"/api/work-orders/{wo}/review", json={"decision": "verify", "actor": PERSON, "role": "maintenance"}).status_code == 403
        assert c.post(f"/api/work-orders/{wo}/review", json={"decision": "verify", "reason": "good", **OWNER}).status_code == 200
        hist = c.get(f"/api/work-orders/{wo}/history").json()
        assert [h["action"] for h in hist][-1] == "verified" and all(h["actor"] and h["ts"] for h in hist)
        rows = c.get("/api/work-orders").json()
        assert rows[0]["status"] == "verified" and rows[0]["assignment"]["person"] == PERSON and rows[0]["reviewed_by"] == OWNER["actor"]
        d = c.get("/api/directory").json()
        assert d["demo"] and TEAM in [t["name"] for t in d["teams"]]
