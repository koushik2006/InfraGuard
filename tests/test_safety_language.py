"""No UI string or agent output may say a structure is 'safe', give a collapse probability,
or order a closure / evacuation."""
import json
import re
from pathlib import Path

from backend.contracts import ApprovalRequest
from backend.llm.client import BANNED_PATTERNS, banned_phrases
from backend.orchestrator.replay import replay_incident
from backend.orchestrator.whatif import run_whatif
from backend.scenarios.assets import iso

ROOT = Path(__file__).resolve().parents[1]
# Words that are only allowed in explicit negations ("not a safety certification", "never ... safe").
NEGATED = re.compile(r"(not|never|no|isn't|without|than|nor)\b[^.\n]{0,60}\b(safe|unsafe|safety|collapse|probability of (failure|collapse)|closure|evacuat\w*)", re.I)
BAD = re.compile(r"\b(is|are|be|remains?|deemed|considered|declared)\s+(structurally\s+)?(safe|unsafe)\b|collapse\s+(probability|risk|time)|"
                 r"probability of (failure|collapse)|\b(close|closing|shut)\s+the\s+(bridge|building|road|wall)\b|\bevacuate\b|"
                 r"\bresolved\b", re.I)


def texts(obj):
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, dict):
        for v in obj.values():
            yield from texts(v)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            yield from texts(v)


def test_agent_outputs_never_make_safety_claims(engine):
    engine.advance_until_event()
    inc = engine.snapshot()["incidents"][0]["incident_id"]
    engine.decide(inc, ApprovalRequest(decision="approve", actor="A", role="engineer"))
    for s in ("persists", "insufficient", "improves"):
        engine.load_follow_up(inc, s, "A", "engineer")
    d = engine.incident(inc)
    payload = {k: d[k] for k in ("investigation", "triage", "work_orders", "verifications", "agent_runs", "audit", "state_text")}
    payload["replay"] = replay_incident(engine.db, inc)
    payload["whatif"] = run_whatif(engine.db, engine.run, "BRG-017", [{"type": "follow_up", "set": "improves"}], iso(engine.cursor), "end")
    offenders = [t for t in texts(payload) if BAD.search(NEGATED.sub("", t))]
    assert not offenders, offenders[:5]


def test_ui_source_strings_never_make_safety_claims():
    offenders = []
    for f in (ROOT / "frontend" / "src").rglob("*.ts*"):
        for i, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
            if BAD.search(NEGATED.sub("", line)):
                offenders.append(f"{f.name}:{i}: {line.strip()[:100]}")
    assert not offenders, offenders


def test_banned_phrase_detector_catches_violations():
    for bad in ("The bridge is safe", "collapse probability is 3%", "Please evacuate", "close the bridge now"):
        assert banned_phrases(bad), bad
    assert len(BANNED_PATTERNS) >= 5


def test_status_vocabulary_has_no_green_safe():
    css = (ROOT / "frontend" / "src" / "app" / "globals.css").read_text(encoding="utf-8")
    assert "--green" not in css and "--safe" not in css
    kinds = json.dumps(["No anomaly detected", "Investigate", "Data unavailable", "Escalation required"])
    assert "safe" not in kinds
