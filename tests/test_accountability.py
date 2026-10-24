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
PDF = base64.b64encode(b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n").decode()
OFFICER = dict(actor="R. Menon (demo officer)", role="maintenance")


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


def accepted(e, days=3):
    inc, wo = assigned(e, days)
    e.accept_assignment(wo, **OFFICER)
    return inc, wo


def submitting(e, days=3):
    inc, wo = accepted(e, days)
    e.update_progress(wo, "On site, inspecting the bearings", "", completion_note="Inspected the bearing shelf; no debris found.", **OFFICER)
    e.open_evidence_stage(wo, "", **OFFICER)
    return inc, wo


def submitted(e, days=3):
    inc, wo = submitting(e, days)
    e.add_attachment(wo, "inspection-report.pdf", "application/pdf", PDF, **OFFICER)
    e.submit_evidence(wo, "Inspection completed and the report is attached", "", **OFFICER)
    return inc, wo


def completed(e):
    inc, wo = submitted(e)
    e.review_work_order(wo, "approve", "Evidence is adequate", **OWNER)
    return inc, wo


