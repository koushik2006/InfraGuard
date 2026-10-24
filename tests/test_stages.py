"""Stage-by-stage work-order workflow: engineer review/edit, assignment, officer acceptance, execution, evidence upload, engineer
evidence approval, completion + resolved 3D state, report versions, audit trail and persistence. All rules are enforced on the backend."""
import base64
import sqlite3

import pytest

import backend.orchestrator.accountability as acc
import backend.orchestrator.wo_common as common
from backend.contracts import ApprovalRequest
from backend.db.database import Database
from backend.orchestrator.engine import AccessDenied, Engine, NotFound, WorkflowError
from tests.test_accountability import (
    ENG, OFFICER, OWNER, PDF, PERSON, PNG, TEAM, accepted, approved, assigned, completed, due, proposed, staged, submitted, submitting,
)

OTHER = dict(actor="S. Gupta (demo officer)", role="maintenance")


def actions(e, wo):
    return [h["action"] for h in e.work_order_history(wo)]


# ------------------------------------------------------------------ stage 1: engineer review
def test_engineer_can_edit_then_the_approved_version_is_what_the_officer_receives():
    e = staged()
    inc, wo = proposed(e)
    original = [s["action"] for s in e.work_order_view(wo)["work_order"]["steps"]]
    with pytest.raises(AccessDenied):
        e.edit_work_order(wo, {"reason": "x"}, "g", "viewer")
    with pytest.raises(WorkflowError):
        e.edit_work_order(wo, {"steps": []}, **ENG)                       # at least one task
    with pytest.raises(WorkflowError):
        e.edit_work_order(wo, {"colour": "red"}, **ENG)                   # unknown field
    with pytest.raises(WorkflowError):
        e.edit_work_order(wo, {"reason": e.work_order_view(wo)["work_order"]["reason"]}, **ENG)   # nothing changed
    e.edit_work_order(wo, {"steps": ["Inspect the Pier 2 bearing shelf", "Photograph the expansion joint"], "precautions": ["Close the right lane first"],
                           "acceptance_criteria": ["Bearing plate visible in the photos"]}, **ENG)
    w = e.work_order_view(wo)["work_order"]
    assert w["status"] == "proposed" and w["revision"] == 2 and w["edited_by"] == ENG["actor"]
    e.decide(inc, ApprovalRequest(decision="approve", **OWNER))
    w = e.work_order_view(wo)["work_order"]
    assert w["status"] == "approved" and [s["action"] for s in w["steps"]] == ["Inspect the Pier 2 bearing shelf", "Photograph the expansion joint"]
    assert [s["action"] for s in w["steps"]] != original
    with pytest.raises(WorkflowError):
        e.edit_work_order(wo, {"reason": "late change"}, **ENG)           # frozen once approved
    html = e.report_html(wo)
    assert "ENGINEER-APPROVED INSTRUCTIONS" in html and "Inspect the Pier 2 bearing shelf" in html and "Close the right lane first" in html
    assert "System recommendation compared with the approved version" in html and original[0] in html
    assert actions(e, wo) == ["proposed", "proposal_edited", "approved"]


def test_rejection_needs_a_reason_and_the_order_never_becomes_live():
    e = staged()
    inc, wo = proposed(e)
    with pytest.raises(WorkflowError):
        e.decide(inc, ApprovalRequest(decision="reject", note="", **ENG))
    e.decide(inc, ApprovalRequest(decision="reject", note="Duplicate of scheduled work", **ENG))
    assert e.work_order_view(wo)["work_order"]["status"] == "rejected"
    with pytest.raises(WorkflowError):
        e.assign_work_order(wo, TEAM, PERSON, due(e), **ENG)
    assert actions(e, wo)[-1] == "rejected" and "Duplicate of scheduled work" in e.work_order_history(wo)[-1]["summary"]


# ------------------------------------------------------------------ stage 3: officer acceptance / decline
def test_progress_is_refused_until_the_officer_accepts_and_acceptance_cannot_be_duplicated():
    e = staged()
    _, wo = assigned(e)
    assert e.work_order_view(wo)["work_order"]["status"] == "assigned"
    with pytest.raises(WorkflowError):
        e.update_progress(wo, "started", "", **OFFICER)                    # must accept first
    for who in (ENG, OTHER, dict(actor="g", role="viewer")):
        with pytest.raises(AccessDenied):
            e.accept_assignment(wo, **who)                                   # only the assigned officer, never an engineer on their behalf
    e.accept_assignment(wo, **OFFICER)
    assert e.work_order_view(wo)["work_order"]["status"] == "accepted" and e.work_order_view(wo)["work_order"]["acceptance"]["person"] == PERSON
    with pytest.raises(WorkflowError):
        e.accept_assignment(wo, **OFFICER)                                   # no duplicate acceptance
    assert actions(e, wo)[-1] == "assignment_accepted"


def test_declined_assignment_returns_to_the_engineer_and_can_be_reassigned():
    e = staged()
    _, wo = assigned(e)
    with pytest.raises(WorkflowError):
        e.decline_assignment(wo, "", **OFFICER)                              # reason required
    with pytest.raises(AccessDenied):
        e.decline_assignment(wo, "not mine", **OTHER)
    v = e.decline_assignment(wo, "On leave until the due date", **OFFICER)
    w = v["work_order"]
    assert w["status"] == "approved" and w["assignment"] is None and w["last_decline"]["reason"] == "On leave until the due date"
    assert "declined" in v["next_action"]["label"] and v["next_action"]["stage"] == 2
    assert actions(e, wo)[-2:] == ["assignment_declined"] or actions(e, wo)[-1] == "assignment_declined"
    e.assign_work_order(wo, "Structural Maintenance Crew (demo)", "T. Nair (demo officer)", due(e), **ENG)
    assert e.work_order_view(wo)["work_order"]["status"] == "assigned" and e.work_order_view(wo)["work_order"]["last_decline"] is None
    e.accept_assignment(wo, "T. Nair (demo officer)", "maintenance")
    assert e.work_order_view(wo)["work_order"]["status"] == "accepted"


# ------------------------------------------------------------------ stages 4-5: execution + evidence
def test_execution_records_progress_delay_and_a_completion_draft():
    e = staged()
    _, wo = accepted(e)
    with pytest.raises(WorkflowError):
        e.update_progress(wo, "", "", **OFFICER)                             # nothing entered
    v = e.update_progress(wo, "Scaffolding up", "Waiting for a lane closure", completion_note="Draft note", **OFFICER)
    w = v["work_order"]
    assert w["status"] == "in_progress" and w["delay_reason"] and w["completion_draft"] == "Draft note" and w["started_at"]
    assert {"work_started", "progress_update", "delay_reported"} <= set(actions(e, wo))
    with pytest.raises(WorkflowError):
        e.submit_evidence(wo, "A completion note that is long enough", "", **OFFICER)    # evidence stage not opened
    e.open_evidence_stage(wo, "", **OFFICER)
    assert e.work_order_view(wo)["work_order"]["status"] == "submitting_evidence"
    e.back_to_execution(wo, **OFFICER)
    assert e.work_order_view(wo)["work_order"]["status"] == "in_progress"


def test_attachment_validation_replace_remove_and_persistence():
    e = staged()
    _, wo = submitting(e)
    bad = [("run.exe", "application/x-msdownload", PNG), ("fake.pdf", "application/pdf", PNG), ("pic.png", "image/png", PDF),
           ("empty.pdf", "application/pdf", ""), ("junk.pdf", "application/pdf", "!!notbase64!!"),
           ("bin.txt", "text/plain", base64.b64encode(b"\xff\xfe\x00\x01").decode())]
    for name, ctype, data in bad:
        with pytest.raises(WorkflowError):
            e.add_attachment(wo, name, ctype, data, **OFFICER)
    assert e.work_order_view(wo)["pending_attachments"] == []
    big = base64.b64encode(b"%PDF-" + b"0" * (common.MAX_EVIDENCE_BYTES + 1)).decode()
    with pytest.raises(WorkflowError) as err:
        e.add_attachment(wo, "huge.pdf", "application/pdf", big, **OFFICER)
    assert "too large" in str(err.value)
    with pytest.raises(AccessDenied):
        e.add_attachment(wo, "a.pdf", "application/pdf", PDF, **OTHER)
    v = e.add_attachment(wo, "../../Inspection Report.pdf", "application/pdf", PDF, **OFFICER)
    a1 = v["pending_attachments"][0]
    assert a1["filename"] == "Inspection Report.pdf" and a1["size"] > 20
    path, name, ctype = e.attachment_path(wo, a1["attachment_id"])
    assert path.exists() and path.read_bytes().startswith(b"%PDF-") and ctype == "application/pdf" and ".." not in path.name
    v = e.add_attachment(wo, "Final report.pdf", "application/pdf", PDF, replaces=a1["attachment_id"], **OFFICER)
    assert [a["filename"] for a in v["pending_attachments"]] == ["Final report.pdf"] and not path.exists()
    with pytest.raises(NotFound):
        e.attachment_path(wo, a1["attachment_id"])                           # removed file is gone
    a2 = v["pending_attachments"][0]
    e.add_attachment(wo, "Photo.png", "image/png", PNG, **OFFICER)           # images are still supported
    e.remove_attachment(wo, e.work_order_view(wo)["pending_attachments"][1]["attachment_id"], **OFFICER)
    assert len(e.work_order_view(wo)["pending_attachments"]) == 1
    assert {"evidence_file_uploaded", "evidence_file_replaced", "evidence_file_removed"} <= set(actions(e, wo))
    ev = next(h for h in e.work_order_history(wo) if h["action"] == "evidence_file_replaced")
    assert "data_base64" not in str(ev) and ev["detail"]["file"]["sha256"]     # metadata only, never the file itself
    assert a2["attachment_id"] in e.work_order_view(wo)["pending_attachments"][0]["attachment_id"]


def test_submission_rules_duplicates_and_versions():
    e = staged()
    inc, wo = submitting(e)
    with pytest.raises(WorkflowError):
        e.submit_evidence(wo, "A completion note that is long enough", "", **OFFICER)   # no attachment and no reason
    with pytest.raises(WorkflowError):
        e.submit_evidence(wo, "too short", "n/a", **OFFICER)
    e.add_attachment(wo, "report.pdf", "application/pdf", PDF, **OFFICER)
    with pytest.raises(WorkflowError):
        e.submit_evidence(wo, "short", "", **OFFICER)                                     # note too short
    v = e.submit_evidence(wo, "Inspection finished; the bearing shelf is clean and the report is attached", "", **OFFICER)
    w = v["work_order"]
    assert w["status"] == "awaiting_verification" and w["completion"]["version"] == 1 and w["completion"]["attachments"][0]["filename"] == "report.pdf"
    assert w["completion"]["submitted_by"] == PERSON and w["review"] is None and e.incident(inc)["incident"]["closed"] == 0
    with pytest.raises(WorkflowError):
        e.submit_evidence(wo, "A second submission attempt", "", **OFFICER)               # duplicate submission refused
    with pytest.raises(WorkflowError):
        e.add_attachment(wo, "late.pdf", "application/pdf", PDF, **OFFICER)               # files frozen after submission
    with pytest.raises(WorkflowError):
        e.remove_attachment(wo, w["completion"]["attachments"][0]["attachment_id"], **OFFICER)
    # no-attachment path needs an explicit reason
    e2 = staged()
    _, wo2 = submitting(e2)
    v = e2.submit_evidence(wo2, "Verbal handover only; no document produced", "Work was visual only", **OFFICER)
    assert v["work_order"]["completion"]["no_attachment_reason"] == "Work was visual only"


# ------------------------------------------------------------------ stage 6/7: review and completion
def test_further_work_returns_to_execution_and_resubmission_creates_a_new_version():
    e = staged()
    inc, wo = submitted(e)
    for who in (dict(actor="g", role="viewer"), OFFICER):
        with pytest.raises(AccessDenied):
            e.review_work_order(wo, "approve", "", **who)
    with pytest.raises(AccessDenied):
        e.review_work_order(wo, "approve", "", PERSON, "engineer")                         # cannot approve own work
    with pytest.raises(WorkflowError):
        e.review_work_order(wo, "further_work", "", **ENG)                                  # reason required
    v = e.review_work_order(wo, "further_work", "Report does not cover the expansion joint", **ENG)
    w = v["work_order"]
    assert w["status"] == "returned" and w["completion"] is None and len(w["completion_history"]) == 1
    assert w["review"]["decision"] == "further_work" and "expansion joint" in v["next_action"]["label"] and v["next_action"]["stage"] == 4
    assert e.incident(inc)["incident"]["closed"] == 0
    e.update_progress(wo, "Re-inspecting the joint", "", **OFFICER)
    e.open_evidence_stage(wo, "", **OFFICER)
    e.add_attachment(wo, "joint-report.pdf", "application/pdf", PDF, **OFFICER)
    v = e.submit_evidence(wo, "Expansion joint inspected and documented in the new report", "", **OFFICER)
    assert v["work_order"]["completion"]["version"] == 2
    e.review_work_order(wo, "approve", "Now complete", **OWNER)
    assert e.work_order_view(wo)["work_order"]["status"] == "verified"
    with pytest.raises(WorkflowError):
        e.review_work_order(wo, "approve", "again", **OWNER)                                # no duplicate approval


def test_approving_evidence_completes_the_job_and_the_investigation_and_creates_the_resolved_state():
    e = staged()
    inc, wo = submitted(e)
    assert e.work_order_view(wo)["investigation_completed"] is False
    v = e.review_work_order(wo, "approve", "Evidence is adequate", **OWNER)
    w = v["work_order"]
    assert w["status"] == "verified" and w["review"]["reviewer"] == OWNER["actor"] and w["review"]["evidence_version"] == 1
    assert v["investigation_completed"] is True and e.incident(inc)["incident"]["state"] == "CLOSED_BY_HUMAN" and v["resolution"]["mode"] == "simulated_post_completion"
    assert actions(e, wo)[-5:] == ["evidence_approved", "work_order_completed", "investigation_completed"][-3:] or \
        actions(e, wo)[-3:] == ["evidence_approved", "work_order_completed", "investigation_completed"]
    # the historical incident and its findings are preserved
    ev = e.incident(inc)["event"]
    assert {f["sensor_id"] for f in ev["findings"]} == {"ACC-M1", "ACC-Q1", "ACC-P2", "STR-G1"}
    # Sensors endpoint: resolved, simulated, all normal, no active incident or flags
    from fastapi.testclient import TestClient
    import backend.api.main as api
    api.engine, api.db = e, e.db
    with TestClient(api.app) as c:
        r = c.get("/api/assets/BRG-017/sensors").json()
    assert r["open_incident"] is None and r["incident"] is None and r["post_completion"]["incident_id"] == inc and "simulated" in r["post_completion"]["label"].lower()
    assert all(s["state"] == "normal" and s["finding"] is None and s["incident_role"] is None for s in r["sensors"])
    assert all(s["latest"] is not None and "not a physical measurement" in s["state_reason"] for s in r["sensors"])


def test_overdue_applies_only_while_work_is_live():
    e = staged()
    _, wo = accepted(e, days=1)
    e.tick(96 * 3)
    assert e.work_order_view(wo)["overdue"] is True
    assert actions(e, wo).count("overdue_escalation") == 1
    e2 = staged()
    _, wo2 = submitted(e2, days=1)
    e2.tick(96 * 4)
    assert e2.work_order_view(wo2)["overdue"] is False            # awaiting engineer approval is not the officer's delay


# ------------------------------------------------------------------ audit trail
FULL_JOURNEY = ["proposed", "proposal_edited", "approved", "assigned", "assignment_accepted", "work_started", "progress_update", "evidence_stage_opened",
                "evidence_file_uploaded", "completion_submitted", "evidence_approved", "work_order_completed", "investigation_completed"]


def test_audit_trail_records_the_journey_in_order_with_actors_states_and_references():
    e = staged()
    inc, wo = proposed(e)
    e.edit_work_order(wo, {"reason": "Verify the deck vibration shift on site"}, **ENG)
    e.decide(inc, ApprovalRequest(decision="approve", **ENG))
    e.assign_work_order(wo, TEAM, PERSON, due(e), **ENG)
    e.accept_assignment(wo, **OFFICER)
    e.update_progress(wo, "Inspection under way", "", **OFFICER)
    e.open_evidence_stage(wo, "", **OFFICER)
    e.add_attachment(wo, "report.pdf", "application/pdf", PDF, **OFFICER)
    e.submit_evidence(wo, "Inspection completed; the PDF report is attached", "", **OFFICER)
    e.review_work_order(wo, "approve", "ok", **OWNER)
    ev = e.audit_trail(work_order_id=wo, order="asc")
    assert [x["action"] for x in ev if x["source"] == "work_order"] == FULL_JOURNEY
    assert [x["ts"] for x in ev] == sorted(x["ts"] for x in ev)
    for x in ev:
        assert x["event_id"] and x["incident_id"] == inc and x["actor"] and x["ts"] and x["summary"] and x["action_label"]
    sub = next(x for x in ev if x["action"] == "completion_submitted")
    assert sub["before"] == "submitting_evidence" and sub["after"] == "awaiting_verification" and sub["refs"]["attachments"] and sub["refs"]["evidence_version"] == 1
    assert next(x for x in ev if x["action"] == "approved")["refs"]["report_version"] == 3
    assert next(x for x in ev if x["action"] == "evidence_approved")["actor_role"] == "asset_owner"
    assert any(x["source"] == "investigation" for x in ev)                                   # investigation stage transitions are in the chain too
    assert e.audit_trail(work_order_id=wo, order="desc")[0]["ts"] >= e.audit_trail(work_order_id=wo, order="desc")[-1]["ts"]
    assert {x["action"] for x in e.audit_trail(actor="Menon")} >= {"assignment_accepted", "completion_submitted"}
    assert [x["action"] for x in e.audit_trail(action="evidence_approved")] == ["evidence_approved"]
    assert e.audit_trail(incident_id="INC-9999") == []


def test_failed_actions_are_not_recorded_as_successful_transitions():
    e = staged()
    _, wo = submitting(e)
    n = len(e.audit_trail())
    for fn in (lambda: e.submit_evidence(wo, "short", "", **OFFICER), lambda: e.accept_assignment(wo, **OFFICER),
               lambda: e.add_attachment(wo, "x.exe", "application/x-msdownload", PNG, **OFFICER), lambda: e.review_work_order(wo, "approve", "", **ENG),
               lambda: e.assign_work_order(wo, TEAM, "A. Khan (demo officer)", due(e), **ENG)):
        with pytest.raises(WorkflowError):
            fn()
    assert len(e.audit_trail()) == n and e.work_order_view(wo)["work_order"]["status"] == "submitting_evidence"


def test_event_and_report_logs_are_append_only():
    e = staged()
    _, wo = proposed(e)
    for q in ("UPDATE work_order_events SET summary='x'", "DELETE FROM work_order_events", "UPDATE work_order_reports SET kind='x'", "DELETE FROM work_order_reports",
              "UPDATE audit_events SET summary='x'"):
        with pytest.raises(sqlite3.DatabaseError):
            e.db.execute(q)


# ------------------------------------------------------------------ report
def test_report_has_all_sections_real_data_versions_and_labels_unapproved_work():
    e = staged()
    inc, wo = proposed(e)
    html = e.report_html(wo)
    for h in ("A. Report header", "B. Incident summary", "C. Sensor readings and technical evidence", "D. Investigation and decision summary",
              "E. Work instructions", "F. Completion and approval requirements"):
        assert h in html
    assert wo in html and inc in html and "Bridge Alpha" in html and "BRG-017" in html and "InfraGuard" in html
    assert "UNAPPROVED SYSTEM RECOMMENDATION" in html and "Pending engineer approval" in html and "Not yet assigned" in html
    for sid in ("ACC-M1", "ACC-Q1", "ACC-P2", "STR-G1"):
        assert sid in html
    assert "context" in html.lower() and "cannot raise an alert" in html                      # context sensors are not independent sources
    assert "Page " in html and "counter(pages)" in html and "Print / Save as PDF" in html
    assert "|z| ≥ 3.5" in html and "robust z" in html.lower()
    e.decide(inc, ApprovalRequest(decision="approve", **ENG))
    e.assign_work_order(wo, TEAM, PERSON, due(e), **ENG)
    vs = e.report_versions(wo)
    assert [v["kind"] for v in vs] == ["draft", "approved", "assigned"] and [v["version"] for v in vs] == [1, 2, 3]
    latest = e.report_html(wo)
    assert PERSON in latest and TEAM in latest and "ENGINEER-APPROVED INSTRUCTIONS" in latest and "Report version</th><td>v3 of 3" in latest
    assert "UNAPPROVED SYSTEM RECOMMENDATION" in e.report_html(wo, 1) and "Report version</th><td>v1 of 3" in e.report_html(wo, 1)
    assert e.report_html(wo, 2) == e.report_html(wo, 2)                                   # regenerates identically from the stored snapshot
    with pytest.raises(NotFound):
        e.report_html(wo, 99)


def test_report_escapes_user_text():
    e = staged()
    inc, wo = proposed(e)
    e.edit_work_order(wo, {"steps": ["<script>alert(1)</script> check bearing"]}, **ENG)
    html = e.report_html(wo)
    assert "<script>alert(1)</script>" not in html and "&lt;script&gt;" in html


# ------------------------------------------------------------------ persistence
def test_everything_survives_a_server_restart(tmp_path):
    path = str(tmp_path / "ig.db")
    e = staged(path)
    inc, wo = submitted(e)
    before_events = e.audit_trail(work_order_id=wo)
    before_reports = e.report_versions(wo)
    file_id = e.work_order_view(wo)["work_order"]["completion"]["attachments"][0]["attachment_id"]
    e.db.conn.close()
    e2 = Engine(Database(path), staged=True)               # a fresh process opening the same files
    v = e2.work_order_view(wo)
    assert v["work_order"]["status"] == "awaiting_verification" and v["next_action"]["stage"] == 6
    assert e2.audit_trail(work_order_id=wo) == before_events and e2.report_versions(wo) == before_reports
    assert e2.attachment_path(wo, file_id)[0].read_bytes().startswith(b"%PDF-")
    assert "ENGINEER-APPROVED" in e2.report_html(wo)
    e2.review_work_order(wo, "approve", "ok after restart", **OWNER)
    assert e2.work_order_view(wo)["investigation_completed"] is True
    e2.db.conn.close()
    e3 = Engine(Database(path), staged=True)
    assert e3.resolution_for("BRG-017")["incident_id"] == inc and e3.work_order_view(wo)["work_order"]["status"] == "verified"


# ------------------------------------------------------------------ API surface
def test_api_flow_roles_report_file_and_audit_endpoints():
    from fastapi.testclient import TestClient
    import backend.api.main as api
    e = staged()
    api.engine, api.db = e, e.db
    inc, wo = proposed(e)
    with TestClient(api.app) as c:
        assert c.get(f"/api/work-orders/{wo}/report").status_code == 200 and "text/html" in c.get(f"/api/work-orders/{wo}/report").headers["content-type"]
        assert c.post(f"/api/work-orders/{wo}/edit", json={"edits": {"reason": "Check the Pier 2 bearing"}, "actor": "g", "role": "viewer"}).status_code == 403
        assert c.post(f"/api/work-orders/{wo}/edit", json={"edits": {"reason": "Check the Pier 2 bearing"}, **ENG}).status_code == 200
        assert c.post(f"/api/incidents/{inc}/decision", json={"decision": "reject", "note": "", **ENG}).status_code == 409
        assert c.post(f"/api/incidents/{inc}/decision", json={"decision": "approve", "note": "", **ENG}).status_code == 200
        body = dict(team=TEAM, person=PERSON, due_date=due(e))
        assert c.post(f"/api/work-orders/{wo}/assign", json={**body, "actor": "g", "role": "maintenance"}).status_code == 403
        assert c.post(f"/api/work-orders/{wo}/assign", json={**body, **ENG}).status_code == 200
        assert c.post(f"/api/work-orders/{wo}/progress", json={"note": "x", **OFFICER}).status_code == 409          # not accepted yet
        assert c.post(f"/api/work-orders/{wo}/accept", json=ENG).status_code == 403
        assert c.post(f"/api/work-orders/{wo}/accept", json=OFFICER).status_code == 200
        assert c.post(f"/api/work-orders/{wo}/accept", json=OFFICER).status_code == 409
        assert c.post(f"/api/work-orders/{wo}/progress", json={"note": "Started", **OFFICER}).status_code == 200
        assert c.post(f"/api/work-orders/{wo}/evidence-stage", json={**OFFICER}).status_code == 200
        r = c.post(f"/api/work-orders/{wo}/attachments", json={"filename": "r.pdf", "content_type": "application/pdf", "data_base64": PNG, **OFFICER})
        assert r.status_code == 409 and "does not match" in r.json()["detail"]
        r = c.post(f"/api/work-orders/{wo}/attachments", json={"filename": "r.pdf", "content_type": "application/pdf", "data_base64": PDF, **OFFICER})
        assert r.status_code == 200
        aid = r.json()["pending_attachments"][0]["attachment_id"]
        assert c.post(f"/api/work-orders/{wo}/evidence", json={"note": "Inspection completed, report attached", **OFFICER}).status_code == 200
        f = c.get(f"/api/work-orders/{wo}/attachments/{aid}/file")
        assert f.status_code == 200 and f.content.startswith(b"%PDF-") and "pdf" in f.headers["content-type"]
        assert c.get(f"/api/work-orders/{wo}/attachments/ATT-9999/file").status_code == 404
        assert c.post(f"/api/work-orders/{wo}/review", json={"decision": "approve", **OFFICER}).status_code == 403
        assert c.post(f"/api/work-orders/{wo}/review", json={"decision": "further_work", "reason": "", **OWNER}).status_code == 409
        assert c.post(f"/api/work-orders/{wo}/review", json={"decision": "approve", "reason": "good", **OWNER}).status_code == 200
        a = c.get("/api/audit", params={"work_order_id": wo, "order": "asc"}).json()
        assert a["order"] == "asc" and [x for x in a["events"] if x["source"] == "work_order"][0]["action"] == "proposed" and a["events"][-1]["action"] == "investigation_completed"
        assert OWNER["actor"] in a["actors"] and a["actions"]["evidence_approved"] == "Engineer approved the evidence"
        assert c.get("/api/audit", params={"action": "completion_submitted"}).json()["count"] == 1
        assert [v["version"] for v in c.get(f"/api/work-orders/{wo}/reports").json()] == [1, 2, 3, 4, 5]
        rows = c.get("/api/work-orders").json()
        assert rows[0]["status"] == "verified" and rows[0]["stage"] == 7
        assert c.get("/api/incidents").json()[0]["state"] == "CLOSED_BY_HUMAN"


# ------------------------------------------------------------------ carried over: duplicates, assignment rules, reassignment history
def test_continuing_deviation_after_completion_does_not_open_a_second_incident_or_work_order():
    e = staged()
    inc, wo = completed(e)
    assert e.incident(inc)["incident"]["closed"] == 1
    e.tick(60)                                   # the simulated deviation is still present in the underlying data
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


def test_work_order_is_a_proposal_until_a_human_approves_it_and_cannot_be_approved_twice():
    e = staged()
    inc, wo = proposed(e)
    w = e.work_order_view(wo)["work_order"]
    assert w["status"] == "proposed" and w["approved_by"] is None
    with pytest.raises(WorkflowError):
        e.assign_work_order(wo, TEAM, PERSON, due(e), **ENG)
    e.decide(inc, ApprovalRequest(decision="approve", **ENG))
    w = e.work_order_view(wo)["work_order"]
    assert w["status"] == "approved" and w["approved_by"] == ENG["actor"] and w["approved_at"]
    with pytest.raises(WorkflowError):
        e.decide(inc, ApprovalRequest(decision="approve", **ENG))


def test_assignment_rules_are_enforced_on_the_backend():
    e = staged()
    _, wo = approved(e)
    for role in ("viewer", "maintenance"):
        with pytest.raises(AccessDenied):
            e.assign_work_order(wo, TEAM, PERSON, due(e), "someone", role)
    with pytest.raises(WorkflowError):
        e.assign_work_order(wo, "Made-up team", PERSON, due(e), **ENG)
    with pytest.raises(WorkflowError):
        e.assign_work_order(wo, TEAM, "A. Khan (demo officer)", due(e), **ENG)             # person not in that team
    with pytest.raises(WorkflowError):
        e.assign_work_order(wo, TEAM, PERSON, "2020-01-01", **ENG)                         # before the simulated date
    with pytest.raises(WorkflowError):
        e.assign_work_order(wo, TEAM, PERSON, "not-a-date", **ENG)
    v = e.assign_work_order(wo, TEAM, PERSON, due(e), **ENG)
    assert v["work_order"]["status"] == "assigned" and v["work_order"]["assignment"]["assigned_by"] == ENG["actor"]
    with pytest.raises(WorkflowError):
        e.assign_work_order(wo, TEAM, PERSON, due(e), **ENG)                               # identical re-assignment is refused


def test_reassignment_and_deadline_changes_keep_the_previous_record_and_reset_acceptance():
    e = staged()
    _, wo = accepted(e)
    e.assign_work_order(wo, "Structural Maintenance Crew (demo)", "T. Nair (demo officer)", due(e, 5), **OWNER)
    assert e.work_order_view(wo)["work_order"]["status"] == "assigned" and e.work_order_view(wo)["work_order"]["acceptance"] is None   # the new officer must accept
    hist = e.work_order_history(wo)
    assert [h["action"] for h in hist] == ["proposed", "approved", "assigned", "assignment_accepted", "reassigned", "deadline_changed"]
    re_ = next(h for h in hist if h["action"] == "reassigned")
    assert re_["detail"]["previous"]["person"] == PERSON and re_["actor"] == OWNER["actor"] and re_["detail"]["before"] == "accepted"
