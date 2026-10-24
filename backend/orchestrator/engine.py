"""Deterministic orchestrator: live replay engine + incident state machine.

All workflow state transitions are validated against TRANSITIONS and audited with a
timestamp. Consequential actions (approve / reject / close) require a human with an
allowed role. Agents only propose."""
from __future__ import annotations

import base64
import hashlib
import re
import tempfile
import threading
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Optional

from backend.contracts import (
    AnomalyEvent, ApprovalRecord, ApprovalRequest, Assignment, Attachment, Completion, Review, InvestigationResult, Intervention, PlanStep, RunConfig,
    TriageResult, VerificationResult, WorkOrderDraft,
)
from backend.db.database import Database, dumps, loads, now_iso
from backend.detector.detector import AssetData, prepare_asset, transient_exceedances
from backend.detector.quality import sensor_health
from backend.orchestrator import pipeline
from backend.orchestrator.accountability import AccountabilityMixin
from backend.orchestrator.wo_common import (  # noqa: F401  (re-exported for the API and tests)
    APPROVER_ROLES, EVIDENCE_TYPES, LIVE_WO, MAX_EVIDENCE_BYTES, WORK_ROLES, AccessDenied, NotFound, WorkflowError,
)
from backend.scenarios.directory import TEAMS, valid_assignment
from backend.scenarios.assets import (
    ACTIVE_ASSET_IDS, ASSETS, DEFAULT_VARIANTS, MONITOR_START, SIM_END, SIM_START, VARIANTS, iso, parse_iso,
)
from backend.version import DEFAULT_SEED, SCENARIO_ID, versions

TICK = timedelta(minutes=15)
SPEEDS = [1, 2, 4, 8, 16]

TRANSITIONS: dict[str, list[str]] = {
    "DETECTED": ["INVESTIGATING"],
    "INVESTIGATING": ["PRIORITISING"],
    "PRIORITISING": ["PLANNING"],
    "PLANNING": ["AWAITING_APPROVAL"],
    "AWAITING_APPROVAL": ["APPROVED", "REJECTED"],
    "REJECTED": ["PLANNING"],
    "APPROVED": ["VERIFYING", "CLOSED_BY_HUMAN"],
    "VERIFYING": ["MONITORING_PERSISTS", "MONITORING_IMPROVED", "CANNOT_ASSESS"],
    "MONITORING_PERSISTS": ["VERIFYING"],
    "CANNOT_ASSESS": ["VERIFYING"],
    "MONITORING_IMPROVED": ["VERIFYING", "CLOSED_BY_HUMAN"],
    "CLOSED_BY_HUMAN": [],
}
STATE_TEXT = {
    "DETECTED": "Anomaly detected — ready for investigation",
    "INVESTIGATING": "Evidence gathered — ready to prioritise",
    "PRIORITISING": "Priority assigned — ready to plan",
    "PLANNING": "Planner is drafting the proposal",
    "AWAITING_APPROVAL": "Open — proposal awaiting human review",
    "REJECTED": "Open — proposal rejected by reviewer; re-plan required",
    "APPROVED": "Open — work order approved; awaiting follow-up readings",
    "VERIFYING": "Open — Verifier comparing follow-up readings",
    "MONITORING_PERSISTS": "Open — deviation persists; further inspection recommended",
    "MONITORING_IMPROVED": "Open — monitoring improved; pending human closure review",
    "CANNOT_ASSESS": "Open — cannot assess (insufficient or mixed follow-up evidence)",
    "CLOSED_BY_HUMAN": "Closed by human reviewer",
}
FOLLOW_UP_ALLOWED = {"APPROVED", "MONITORING_PERSISTS", "MONITORING_IMPROVED", "CANNOT_ASSESS"}
AGENT_LABEL = {"sentinel": "Sentinel", "investigator": "Investigator", "prioritiser": "Risk Prioritiser",
               "planner": "Response Planner", "verifier": "Verifier"}


class Engine(AccountabilityMixin):
    def __init__(self, db: Database, active_assets: Optional[list[str]] = None, staged: bool = False):
        self.db = db
        # staged: after the Sentinel the user advances the agents one stage at a time ("Continue to next step")
        self.staged = staged
        base = Path(db.path).parent if db.path != ":memory:" else Path(tempfile.mkdtemp(prefix="infraguard-"))
        self.evidence_dir = base / "evidence"
        self.active: list[str] = list(active_assets or ACTIVE_ASSET_IDS)
        self.lock = threading.RLock()
        self.run: Optional[RunConfig] = None
        self.run_id: Optional[str] = None
        self.data: dict[str, AssetData] = {}
        self.cursor: datetime = MONITOR_START
        self.running = False
        self.speed = 4.0
        self.ingested: dict[str, int] = {}
        self.scanned: dict[str, int] = {}
        self.transient_checked: dict[str, int] = {}
        self.quality_state: dict[str, str] = {}
        self.last_tick_at: Optional[str] = None
        if not self._restore():
            self.reset()

    # ------------------------------------------------------------------ run lifecycle
    def _prepare(self) -> None:
        self.data = {a: prepare_asset(self.run, a) for a in self.active}

    def _restore(self) -> bool:
        st = self.db.one("SELECT * FROM sim_state WHERE id = 1")
        if not st:
            return False
        run = self.db.one("SELECT * FROM runs WHERE run_id = ?", (st["run_id"],))
        if not run:
            return False
        self.run = RunConfig.model_validate(loads(run["config_json"]))
        self.run_id = run["run_id"]
        self.cursor = parse_iso(st["cursor_time"])
        self.speed = st["speed"]
        self.running = False
        self._prepare()
        for a in self.active:
            r = self.db.one("SELECT MAX(window_index) m FROM readings WHERE run_id=? AND asset_id=? AND phase!='follow_up'",
                            (self.run_id, a))
            last = r["m"] if r and r["m"] is not None else self.data[a].n_ref - 1
            self.ingested[a] = self.scanned[a] = last
            self.transient_checked[a] = last - self.data[a].asset.detection.persistence_windows
            for s in self.data[a].asset.sensors:
                self.quality_state[s.sensor_id] = self.data[a].flags[s.sensor_id][last].status
        return True

    def reset(self, seed: int = DEFAULT_SEED, variants: Optional[dict[str, str]] = None,
              environment: str = "nominal", interventions: Optional[list[Intervention]] = None,
              actor: str = "system") -> dict:
        with self.lock:
            v = dict(DEFAULT_VARIANTS)
            v.update(variants or {})
            for a, var in v.items():
                if var not in VARIANTS[a]:
                    raise WorkflowError(f"Unknown variant {var} for {a}")
            self.run = RunConfig(scenario_id=SCENARIO_ID, seed=seed, variants=v, environment=environment,
                                 interventions=interventions or [])
            self.run_id = self.db.next_id("run", "RUN")
            label = f"Live replay · seed {seed} · " + ", ".join(f"{a}:{x}" for a, x in v.items() if a in self.active)
            self.db.execute("INSERT INTO runs VALUES (?,?,?,?,?,?)",
                            (self.run_id, "live", label, dumps(self.run), dumps(versions()), now_iso()))
            self._prepare()
            self.cursor = MONITOR_START
            self.running = False
            self.ingested, self.scanned, self.transient_checked, self.quality_state = {}, {}, {}, {}
            for a, d in self.data.items():
                self.db.execute("INSERT OR IGNORE INTO assets VALUES (?,?,?,?)",
                                (a, d.asset.type, d.asset.name, dumps(d.asset)))
                for s in d.asset.sensors:
                    self.db.execute("INSERT OR IGNORE INTO sensors VALUES (?,?,?,?)",
                                    (s.sensor_id, a, s.kind, dumps(s)))
                self.db.execute("INSERT OR IGNORE INTO baseline_configs VALUES (?,?,?,?,?,?,?)",
                                (d.baseline.version, a, self.run_id, d.baseline.status,
                                 int(d.baseline.reference_reviewed), dumps(d.baseline), now_iso()))
                self.ingested[a] = -1
                self._ingest(a, d.n_ref - 1)
                self.scanned[a] = d.n_ref - 1
                self.transient_checked[a] = d.n_ref - 1
                self.db.audit(action="baseline_computed", actor="Baseline service", actor_type="system",
                              run_id=self.run_id, asset_id=a, sim_time=iso(MONITOR_START),
                              summary=f"{a}: baseline {d.baseline.version} ({d.baseline.status}) from "
                                      f"{d.baseline.computed_from_windows} reference windows",
                              detail={"version": d.baseline.version, "status": d.baseline.status,
                                      "reviewed": d.baseline.reference_reviewed, "notes": d.baseline.notes})
            self.db.audit(action="run_started", actor=actor, actor_type="human" if actor != "system" else "system",
                          run_id=self.run_id, sim_time=iso(self.cursor), summary=label,
                          detail={"config": self.run.model_dump(), "versions": versions()})
            self._save_state()
            return self.snapshot()

    def _save_state(self) -> None:
        self.db.execute("INSERT INTO sim_state VALUES (1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET run_id=excluded.run_id,"
                        " cursor_time=excluded.cursor_time, running=excluded.running, speed=excluded.speed,"
                        " updated_at=excluded.updated_at",
                        (self.run_id, iso(self.cursor), int(self.running), self.speed, now_iso()))

    def set_running(self, running: bool) -> None:
        with self.lock:
            self.running = running and self.cursor < SIM_END
            self._save_state()

    def set_speed(self, speed: float) -> None:
        if speed not in SPEEDS:
            raise WorkflowError(f"speed must be one of {SPEEDS}")
        with self.lock:
            self.speed = float(speed)
            self._save_state()

    # ------------------------------------------------------------------ ticking
    def tick(self, n: int = 1) -> int:
        processed = 0
        with self.lock:
            for _ in range(n):
                if self.cursor >= SIM_END:
                    self.running = False
                    break
                self.cursor = min(SIM_END, self.cursor + TICK)
                self._process()
                self.check_overdue()
                processed += 1
            self.last_tick_at = now_iso()
            self._save_state()
        return processed

    def advance_until_event(self, max_ticks: int = 400) -> dict:
        """Processes windows one by one (real pipeline) until a new incident opens or the limit is hit."""
        with self.lock:
            before = {r["incident_id"] for r in self._incidents()}
            k = 0
            while k < max_ticks and self.cursor < SIM_END:
                self.tick(1)
                k += 1
                if {r["incident_id"] for r in self._incidents()} - before:
                    break
            return {"ticks": k, "cursor": iso(self.cursor)}

    def _ingest(self, a: str, upto: int) -> None:
        d = self.data[a]
        lo = self.ingested[a] + 1
        if upto < lo:
            return
        rows = []
        for s in d.asset.sensors:
            for i in range(lo, upto + 1):
                r = d.rows[s.sensor_id][i]
                f = d.flags[s.sensor_id][i]
                rows.append((self.run_id, a, s.sensor_id, i, r["t_start"], r["t_end"], r["phase"],
                             dumps(r["features"]), f.status, f.detail, None, self.run.seed, d.baseline.version,
                             now_iso()))
        self.db.executemany("INSERT OR REPLACE INTO readings VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)
        self.ingested[a] = upto

    def _visible_index(self, a: str) -> int:
        d = self.data[a]
        w = timedelta(minutes=d.asset.detection.window_minutes)
        k = int((self.cursor - SIM_START) / w) - 1
        return min(k, d.n - 1)

    def _process(self) -> None:
        for a, d in self.data.items():
            upto = self._visible_index(a)
            if upto <= self.ingested[a]:
                continue
            start = self.ingested[a] + 1
            self._ingest(a, upto)
            self._quality_transitions(a, start, upto)
            self._transients(a, upto)
            inc = self._open_incident(a)
            if inc:
                self._update_open_incident(inc, upto)
                self.scanned[a] = upto
                continue
            # id is assigned when the incident is created
            event, trace, info = pipeline.detect(d, self.scanned[a] + 1, upto, "EVT-PENDING", self.run_id)
            scan_start = self.scanned[a] + 1
            self.scanned[a] = upto
            if event:
                if self._continues_closed_incident(a, event):
                    continue
                self._open_new_incident(a, event, trace, scan_start)

    def _continues_closed_incident(self, a: str, event: AnomalyEvent) -> bool:
        """The deviation of a closed incident can continue in the data; that is the same underlying event and must not
        open a second incident or work order. A new incident needs an exceedance run that began after the closed one."""
        row = self.db.one("SELECT i.incident_id iid, e.json j FROM incidents i JOIN anomaly_events e ON e.event_id=i.event_id "
                          "WHERE i.run_id=? AND i.asset_id=? AND i.closed=1 ORDER BY i.created_at DESC", (self.run_id, a))
        if not row:
            return False
        closed = AnomalyEvent.model_validate(loads(row["j"]))
        if event.onset_window > closed.last_window:
            return False
        if not self.db.one("SELECT 1 FROM audit_events WHERE incident_id=? AND action='continuing_deviation_not_reopened'", (row["iid"],)):
            self.db.audit(action="continuing_deviation_not_reopened", actor="Sentinel", actor_type="agent", run_id=self.run_id,
                          incident_id=row["iid"], asset_id=a, sim_time=iso(self.cursor),
                          summary=f"Deviation continues after {row['iid']} was closed; it is the same underlying event, so no new "
                                  f"incident or work order is opened",
                          detail={"closed_incident": row["iid"], "onset_window": event.onset_window})
        return True

    def _quality_transitions(self, a: str, lo: int, hi: int) -> None:
        d = self.data[a]
        for s in d.asset.sensors:
            for i in range(lo, hi + 1):
                f = d.flags[s.sensor_id][i]
                prev = self.quality_state.get(s.sensor_id, "ok")
                if f.status != prev:
                    t = d.rows[s.sensor_id][i]["t_end"]
                    if f.status == "ok":
                        self.db.audit(action="data_quality_recovered", actor="Sentinel", actor_type="agent",
                                      run_id=self.run_id, asset_id=a, sim_time=t,
                                      summary=f"{s.sensor_id}: data quality back to OK", detail={"window": i})
                    else:
                        self.db.audit(action="data_quality_issue", actor="Sentinel", actor_type="agent",
                                      run_id=self.run_id, asset_id=a, sim_time=t,
                                      summary=f"{s.sensor_id}: {f.status} — {f.detail}",
                                      detail={"window": i, "status": f.status, "sensor_id": s.sensor_id})
                    self.quality_state[s.sensor_id] = f.status

    def _transients(self, a: str, upto: int) -> None:
        """Audits exceedances that did NOT meet the persistence rule (e.g. a heavy vehicle)."""
        d = self.data[a]
        n = d.asset.detection.persistence_windows
        hi = upto - n + 1
        lo = self.transient_checked[a] + 1
        if hi < lo:
            return
        for t in transient_exceedances(d, lo, upto):
            if t["window_index"] > hi:
                continue
            self.db.audit(action="transient_exceedance_not_alerted", actor="Sentinel", actor_type="agent",
                          run_id=self.run_id, asset_id=a, sim_time=t["t_start"],
                          summary=f"{t['sensor_id']} {t['feature']} z = {t['z']:+.1f} at {t['t_start']}: "
                                  f"not persistent — no alert", detail=t)
        self.transient_checked[a] = hi

    # ------------------------------------------------------------------ incidents
    def _incidents(self, asset_id: Optional[str] = None) -> list[dict]:
        q = "SELECT * FROM incidents WHERE run_id = ?"
        p: tuple = (self.run_id,)
        if asset_id:
            q += " AND asset_id = ?"
            p += (asset_id,)
        return [r for r in self.db.all(q + " ORDER BY created_at", p) if r["asset_id"] in self.active]

    def _open_incident(self, a: str) -> Optional[dict]:
        return next((r for r in self._incidents(a) if not r["closed"]), None)

    def _transition(self, incident_id: str, to: str, actor: str, actor_type: str, summary: str,
                    detail: Optional[dict] = None) -> None:
        inc = self.db.one("SELECT * FROM incidents WHERE incident_id = ?", (incident_id,))
        if inc is None:
            raise NotFound(incident_id)
        if to not in TRANSITIONS[inc["state"]]:
            raise WorkflowError(f"Invalid transition {inc['state']} → {to}")
        closed = 1 if to == "CLOSED_BY_HUMAN" else 0
        self.db.execute("UPDATE incidents SET state=?, status_text=?, closed=?, updated_at=? WHERE incident_id=?",
                        (to, STATE_TEXT[to], closed, now_iso(), incident_id))
        self.db.audit(action="state_transition", actor=actor, actor_type=actor_type, run_id=inc["run_id"],
                      incident_id=incident_id, asset_id=inc["asset_id"], sim_time=iso(self.cursor),
                      from_state=inc["state"], to_state=to, summary=summary, detail=detail)

    def _agent_run(self, incident_id: str, asset_id: str, trace: pipeline.AgentTrace, started: str) -> None:
        key = f"{incident_id}:{trace.agent}:{self.db.next_id('agent_run', 'AR')}"
        payload = {"run_key": key, "incident_id": incident_id, "agent": trace.agent, "status": trace.status,
                   "started_at": started, "finished_at": now_iso(), "duration_ms": trace.duration_ms,
                   "tool_calls": [c.model_dump() for c in trace.tool_calls], "fallback_used": trace.fallback_used,
                   "fallback_reason": trace.fallback_reason, "output": trace.output}
        self.db.execute("INSERT INTO agent_runs VALUES (?,?,?,?,?,?,?)",
                        (key, incident_id, asset_id, trace.agent, trace.status, dumps(payload), started))
        self.db.audit(action=f"agent_{trace.agent}_{'fallback' if trace.fallback_used else 'done'}",
                      actor=AGENT_LABEL[trace.agent], actor_type="agent", run_id=self.run_id,
                      incident_id=incident_id, asset_id=asset_id, sim_time=iso(self.cursor),
                      summary=f"{AGENT_LABEL[trace.agent]} finished in {trace.duration_ms:.1f} ms"
                              + (f" (deterministic fallback: {trace.fallback_reason})" if trace.fallback_used else ""),
                      detail={"tool_calls": len(trace.tool_calls)})

    def _open_new_incident(self, a: str, probe: AnomalyEvent, sentinel_trace: pipeline.AgentTrace, scan_start: int) -> None:
        d = self.data[a]
        incident_id = self.db.next_id("incident", "INC")
        event_id = self.db.next_id("event", "EVT")
        wo_id = self.db.next_id("work_order", "WO")
        event = probe.model_copy(update={"event_id": event_id})
        sentinel_trace.output = event.model_dump()
        t = now_iso()
        self.db.execute("INSERT INTO incidents VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        (incident_id, a, self.run_id, event_id, "DETECTED", STATE_TEXT["DETECTED"],
                         int(event.owner_criterion.exceeded), 0, self.run.seed, event.baseline_version, t, t,
                         iso(self.cursor)))
        self.db.execute("INSERT INTO anomaly_events VALUES (?,?,?,?,?,?,?,?,?,?)",
                        (event_id, incident_id, a, self.run_id, self.run.seed, event.baseline_version,
                         dumps(event.detection_params), dumps(event), t, t))
        prior = [loads(r["json"]) for r in self.db.all(
            "SELECT json FROM anomaly_events WHERE run_id=? AND asset_id=? AND event_id != ? ORDER BY created_at",
            (self.run_id, a, event_id))]
        prior_brief = [{"event_id": p["event_id"], "asset_id": p["asset_id"], "detected_time": p["detected_time"],
                        "primary_sensor_id": p["primary_sensor_id"]} for p in prior]
        self.db.execute("INSERT INTO workflow_inputs VALUES (?,?)", (incident_id, dumps({
            "run_id": self.run_id, "run_config": self.run.model_dump(), "scan_start": scan_start,
            "detected_window": event.detected_window, "prior_events": prior_brief, "work_order_id": wo_id,
            "baseline_version": d.baseline.version, "baseline_hash": d.baseline.config_hash,
            "versions": versions(), "retriage": [], "follow_ups": [], "replans": [],
        })))
        self.db.audit(action="anomaly_event_created", actor="Sentinel", actor_type="agent", run_id=self.run_id,
                      incident_id=incident_id, asset_id=a, sim_time=event.detected_time,
                      summary=f"{event.primary_sensor_id}: persistent deviation ({event.deviations[0].feature} "
                              f"z = {event.deviations[0].z:+.1f}); persistence {event.persistence_count}/"
                              f"{event.persistence_window} windows; quality gate passed",
                      detail={"event_id": event_id, "onset": event.onset_time,
                              "corroborating": event.corroborating_sensors})
        self._agent_run(incident_id, a, sentinel_trace, t)
        if self.staged:
            return  # the user continues to the Investigator
        self._run_chain(incident_id, a, event, wo_id, prior_brief)

    # ---- agent stages, shared by automatic and staged execution -------------------------------
    # Each stage computes its result first and only then changes state and writes records, so a failed
    # stage leaves the incident untouched and the same step can be retried safely.
    def _stage_investigate(self, incident_id: str, a: str, event: AnomalyEvent, prior: list[dict]) -> InvestigationResult:
        d = self.data[a]
        started = now_iso()
        inv, ms = pipeline._timed(lambda: pipeline.investigate(event, d, prior))
        fb = inv.narrative.source != "llm"
        trace = pipeline.AgentTrace(agent="investigator", status="fallback_used" if fb else "done", duration_ms=ms,
                                    tool_calls=inv.tool_calls, fallback_used=fb, fallback_reason=inv.narrative.fallback_reason,
                                    output=inv.model_dump())
        self._transition(incident_id, "INVESTIGATING", "Orchestrator", "system", "Investigator started")
        self.db.execute("INSERT OR REPLACE INTO investigations VALUES (?,?,?,?)", (incident_id, a, dumps(inv), now_iso()))
        self.db.executemany("INSERT OR REPLACE INTO evidence_refs VALUES (?,?,?,?,?,?)",
                            [(incident_id, r.ref_id, a, r.kind, r.source_id, dumps(r)) for r in inv.evidence_refs])
        self._agent_run(incident_id, a, trace, started)
        return inv

    def _stage_prioritise(self, incident_id: str, a: str, event: AnomalyEvent, inv: InvestigationResult) -> TriageResult:
        d = self.data[a]
        started = now_iso()
        tri, ms = pipeline._timed(lambda: pipeline.prioritise(event, inv, d))
        trace = pipeline.AgentTrace(agent="prioritiser", status="done", duration_ms=ms, output=tri.model_dump())
        self._transition(incident_id, "PRIORITISING", "Orchestrator", "system", "Prioritiser started")
        self._store_triage(incident_id, a, tri, "initial", event.detected_window)
        self._agent_run(incident_id, a, trace, started)
        return tri

    def _stage_plan(self, incident_id: str, a: str, event: AnomalyEvent, inv: InvestigationResult, tri: TriageResult,
                    wo_id: str) -> WorkOrderDraft:
        d = self.data[a]
        started = now_iso()
        wo, ms = pipeline._timed(lambda: pipeline.plan(event, inv, tri, wo_id, incident_id, d.asset.type))
        fb = wo.plan_text.source != "llm"
        trace = pipeline.AgentTrace(agent="planner", status="fallback_used" if fb else "done", duration_ms=ms, fallback_used=fb,
                                    fallback_reason=wo.plan_text.fallback_reason, output=wo.model_dump())
        self._transition(incident_id, "PLANNING", "Orchestrator", "system", "Planner started")
        self._store_work_order(wo)
        self._agent_run(incident_id, a, trace, started)
        self._transition(incident_id, "AWAITING_APPROVAL", "Response Planner", "agent",
                         f"Proposed work order {wo_id} ({tri.priority}, {tri.timeframe}) — requires human review")
        return wo

    def _run_chain(self, incident_id: str, a: str, event: AnomalyEvent, wo_id: str, prior: list[dict]) -> None:
        inv = self._stage_investigate(incident_id, a, event, prior)
        tri = self._stage_prioritise(incident_id, a, event, inv)
        self._stage_plan(incident_id, a, event, inv, tri, wo_id)

    STAGE_FOR_STATE = {
        "DETECTED": ("investigator", "Investigator", "Investigating anomaly and gathering evidence…"),
        "INVESTIGATING": ("prioritiser", "Risk Prioritiser", "Evaluating priority factors…"),
        "PRIORITISING": ("planner", "Response Planner", "Preparing proposed maintenance work order…"),
    }

    def next_stage(self, state: str) -> Optional[dict]:
        if not self.staged or state not in self.STAGE_FOR_STATE:
            return None
        agent, label, running = self.STAGE_FOR_STATE[state]
        return {"agent": agent, "label": label, "running_message": running, "expected_state": state}

    def advance_incident(self, incident_id: str, actor: str, role: str, expected_state: Optional[str] = None) -> dict:
        """Runs the next waiting agent stage (user clicked "Continue to next step"). Human approval is NOT part of
        this: the planner stage ends at AWAITING_APPROVAL and only a human decision moves the incident on."""
        with self.lock:
            inc = self.db.one("SELECT * FROM incidents WHERE incident_id=?", (incident_id,))
            if inc is None:
                raise NotFound(incident_id)
            if inc["run_id"] != self.run_id:
                raise WorkflowError("Only incidents of the current run can be advanced")
            state = inc["state"]
            if state not in self.STAGE_FOR_STATE:
                raise WorkflowError(f"No agent step is waiting (incident is in state {state})")
            if expected_state and expected_state != state:
                raise WorkflowError(f"Incident has already moved to {state}; refresh to see the latest step")
            a = inc["asset_id"]
            ev = AnomalyEvent.model_validate(loads(self.db.one("SELECT json FROM anomaly_events WHERE event_id=?", (inc["event_id"],))["json"]))
            wi = loads(self.db.one("SELECT json FROM workflow_inputs WHERE incident_id=?", (incident_id,))["json"])
            _, label, _ = self.STAGE_FOR_STATE[state]
            self.db.audit(action="agent_step_requested", actor=actor, actor_type="human", run_id=inc["run_id"], incident_id=incident_id,
                          asset_id=a, sim_time=iso(self.cursor), summary=f"{actor} continued to the next step: {label}",
                          detail={"from_state": state, "role": role})
            if state == "DETECTED":
                self._stage_investigate(incident_id, a, ev, wi["prior_events"])
            else:
                inv = InvestigationResult.model_validate(loads(self.db.one("SELECT json FROM investigations WHERE incident_id=?", (incident_id,))["json"]))
                if state == "INVESTIGATING":
                    self._stage_prioritise(incident_id, a, ev, inv)
                else:
                    tri = TriageResult.model_validate(loads(self.db.one(
                        "SELECT json FROM triage_results WHERE incident_id=? ORDER BY seq DESC", (incident_id,))["json"]))
                    self._stage_plan(incident_id, a, ev, inv, tri, wi["work_order_id"])
            return self.incident(incident_id)

    def _store_triage(self, incident_id: str, a: str, tri: TriageResult, reason: str, window: int) -> None:
        seq = self.db.one("SELECT COUNT(*) c FROM triage_results WHERE incident_id=?", (incident_id,))["c"]
        self.db.execute("INSERT INTO triage_results VALUES (?,?,?,?,?,?,?,?)",
                        (incident_id, seq, a, reason, window, dumps(tri), now_iso(), iso(self.cursor)))

    def _store_work_order(self, wo: WorkOrderDraft) -> None:
        t = now_iso()
        live = self.db.one("SELECT work_order_id FROM work_orders WHERE incident_id=? AND status != 'rejected' AND work_order_id != ?",
                           (wo.incident_id, wo.work_order_id))
        if live:
            raise WorkflowError(f"Incident already has a live work order ({live['work_order_id']}); duplicates are not allowed")
        self.db.execute("INSERT OR REPLACE INTO work_orders VALUES (?,?,?,?,?,?,?)",
                        (wo.work_order_id, wo.incident_id, wo.asset_id, wo.status, dumps(wo), t, t))
        ver = self._new_report(wo, "draft", "Response Planner")
        self._wo_event(wo, "proposed", "Response Planner", "agent",
                       f"Proposed by the Response Planner ({wo.priority}, {wo.timeframe}) — pending engineer approval", actor_type="agent",
                       before=None, after="proposed", refs={"report_version": ver})

    def _update_open_incident(self, inc: dict, upto: int) -> None:
        d = self.data[inc["asset_id"]]
        ev = AnomalyEvent.model_validate(loads(self.db.one("SELECT json FROM anomaly_events WHERE event_id=?",
                                                           (inc["event_id"],))["json"]))
        new, added = pipeline.advance_event(ev, d, upto)
        self.db.execute("UPDATE anomaly_events SET json=?, updated_at=? WHERE event_id=?",
                        (dumps(new), now_iso(), ev.event_id))
        if added:
            self._on_findings_added(inc, new, added, d, upto)
        if new.owner_criterion.exceeded and not inc["escalation"]:
            inv_row = self.db.one("SELECT json FROM investigations WHERE incident_id=?", (inc["incident_id"],))
            if not inv_row:
                return
            inv = InvestigationResult.model_validate(loads(inv_row["json"]))
            first_exceed = next(i for i in range(ev.last_window + 1, upto + 1)
                                if pipeline.owner_criterion(d, i).exceeded) if ev.last_window < upto else upto
            tri = pipeline.retriage(new, inv, d, first_exceed)
            self._store_triage(inc["incident_id"], inc["asset_id"], tri, "owner_criterion_exceeded", first_exceed)
            self.db.execute("UPDATE incidents SET escalation=1, updated_at=? WHERE incident_id=?",
                            (now_iso(), inc["incident_id"]))
            wi = loads(self.db.one("SELECT json FROM workflow_inputs WHERE incident_id=?", (inc["incident_id"],))["json"])
            wi["retriage"].append({"window": first_exceed, "upto": upto})
            self.db.execute("UPDATE workflow_inputs SET json=? WHERE incident_id=?", (dumps(wi), inc["incident_id"]))
            self.db.audit(action="escalation_required", actor="Risk Prioritiser", actor_type="agent",
                          run_id=self.run_id, incident_id=inc["incident_id"], asset_id=inc["asset_id"],
                          sim_time=d.rows[ev.primary_sensor_id][first_exceed]["t_end"],
                          summary=f"Escalation required: {tri.escalation_basis}",
                          detail={"priority": tri.priority, "criterion": new.owner_criterion.model_dump()})
            wo_row = self.db.one("SELECT * FROM work_orders WHERE incident_id=? ORDER BY created_at DESC",
                                 (inc["incident_id"],))
            if wo_row and wo_row["status"] == "proposed":
                wo = WorkOrderDraft.model_validate(loads(wo_row["json"]))
                wo = wo.model_copy(update={"priority": tri.priority, "timeframe": tri.timeframe,
                                           "reason": wo.reason + " " + tri.escalation_basis})
                self.db.execute("UPDATE work_orders SET json=?, updated_at=? WHERE work_order_id=?",
                                (dumps(wo), now_iso(), wo.work_order_id))
                self.db.audit(action="proposal_updated", actor="Response Planner", actor_type="agent",
                              run_id=self.run_id, incident_id=inc["incident_id"], asset_id=inc["asset_id"],
                              sim_time=iso(self.cursor),
                              summary=f"{wo.work_order_id} priority raised to {tri.priority} (escalation); "
                                      f"still requires human review")

    def _on_findings_added(self, inc: dict, event: AnomalyEvent, added: list, d: AssetData, upto: int) -> None:
        """New findings join the SAME incident. If the priority had already been assessed it is re-assessed so every finding counts."""
        iid = inc["incident_id"]
        for f in added:
            self.db.audit(action="finding_added", actor="Sentinel", actor_type="agent", run_id=self.run_id, incident_id=iid,
                          asset_id=inc["asset_id"], sim_time=f.raised_time,
                          summary=f"Finding added to {iid}: {f.sensor_id} ({f.component_name}) {f.feature_label} z = {f.z:+.1f}"
                                  f"{'' if f.used_for_detection else ' — context observation'}",
                          detail={"sensor_id": f.sensor_id, "role": f.role})
        inv_row = self.db.one("SELECT json FROM investigations WHERE incident_id=?", (iid,))
        if not inv_row or not self.db.one("SELECT 1 FROM triage_results WHERE incident_id=?", (iid,)):
            return  # not assessed yet: the stages will include the new findings when they run
        inv = InvestigationResult.model_validate(loads(inv_row["json"]))
        tri = pipeline.retriage(event, inv, d, upto)
        self._store_triage(iid, inc["asset_id"], tri, "finding_added", upto)
        wi = loads(self.db.one("SELECT json FROM workflow_inputs WHERE incident_id=?", (iid,))["json"])
        wi["retriage"].append({"window": upto, "upto": upto})
        self.db.execute("UPDATE workflow_inputs SET json=? WHERE incident_id=?", (dumps(wi), iid))
        self.db.audit(action="priority_reassessed", actor="Risk Prioritiser", actor_type="agent", run_id=self.run_id, incident_id=iid,
                      asset_id=inc["asset_id"], sim_time=iso(self.cursor),
                      summary=f"Priority re-assessed with {len(event.findings)} findings: {tri.priority}, {tri.timeframe}")
        row = self.db.one("SELECT json FROM work_orders WHERE incident_id=? AND status='proposed'", (iid,))
        if row:
            wo = WorkOrderDraft.model_validate(loads(row["json"]))
            if (wo.priority, wo.timeframe) != (tri.priority, tri.timeframe):
                wo = wo.model_copy(update={"priority": tri.priority, "timeframe": tri.timeframe})
                self._save_wo(wo)
                self._wo_event(wo, "proposal_updated", "Response Planner", "agent",
                               f"Proposal priority updated to {tri.priority} after a new finding; still requires human review",
                               actor_type="agent")

    # ------------------------------------------------------------------ human actions
    def _require_role(self, role: str, allowed: set[str], action: str) -> None:
        if role not in allowed:
            raise AccessDenied(f"Role '{role}' may not {action}. Allowed: {sorted(allowed)}")

    def replan(self, incident_id: str, actor: str, role: str) -> dict:
        with self.lock:
            self._require_role(role, APPROVER_ROLES, "request a re-plan")
            inc = self.db.one("SELECT * FROM incidents WHERE incident_id=?", (incident_id,))
            if not inc or inc["state"] != "REJECTED":
                raise WorkflowError("Re-plan is only possible after a rejection")
            d = self.data[inc["asset_id"]]
            ev = AnomalyEvent.model_validate(loads(self.db.one("SELECT json FROM anomaly_events WHERE event_id=?",
                                                               (inc["event_id"],))["json"]))
            inv = InvestigationResult.model_validate(loads(self.db.one(
                "SELECT json FROM investigations WHERE incident_id=?", (incident_id,))["json"]))
            tri = TriageResult.model_validate(loads(self.db.one(
                "SELECT json FROM triage_results WHERE incident_id=? ORDER BY seq DESC", (incident_id,))["json"]))
            self._transition(incident_id, "PLANNING", actor, "human", "Re-plan requested after rejection")
            wo_id = self.db.next_id("work_order", "WO")
            started = now_iso()
            wo, ms = pipeline._timed(lambda: pipeline.plan(ev, inv, tri, wo_id, incident_id, d.asset.type))
            self._store_work_order(wo)
            self._agent_run(incident_id, inc["asset_id"], pipeline.AgentTrace(
                agent="planner", status="fallback_used" if wo.plan_text.source != "llm" else "done", duration_ms=ms,
                fallback_used=wo.plan_text.source != "llm", fallback_reason=wo.plan_text.fallback_reason,
                output=wo.model_dump()), started)
            wi = loads(self.db.one("SELECT json FROM workflow_inputs WHERE incident_id=?", (incident_id,))["json"])
            wi["replans"].append({"work_order_id": wo_id})
            self.db.execute("UPDATE workflow_inputs SET json=? WHERE incident_id=?", (dumps(wi), incident_id))
            self._transition(incident_id, "AWAITING_APPROVAL", "Response Planner", "agent",
                             f"Revised proposal {wo_id} — requires human review")
            return wo.model_dump()

    # ------------------------------------------------------------------ work-order accountability
    def _wo(self, wo_id: str) -> WorkOrderDraft:
        row = self.db.one("SELECT json FROM work_orders WHERE work_order_id=?", (wo_id,))
        if not row:
            raise NotFound(wo_id)
        return WorkOrderDraft.model_validate(loads(row["json"]))

    def _save_wo(self, wo: WorkOrderDraft) -> None:
        self.db.execute("UPDATE work_orders SET status=?, json=?, updated_at=? WHERE work_order_id=?",
                        (wo.status, dumps(wo), now_iso(), wo.work_order_id))

    def _wo_event(self, wo: WorkOrderDraft, action: str, actor: str, role: str, summary: str,
                  detail: Optional[dict] = None, actor_type: str = "human", before: Optional[str] = None,
                  after: Optional[str] = None, refs: Optional[dict] = None) -> None:
        """Append-only accountability record (who / what / when / state before and after / references), mirrored into the audit trail.
        Always called AFTER the change has succeeded, so a failed action is never recorded as a successful one."""
        d = dict(detail or {})
        if before is not None:
            d["before"] = before
        if after is not None:
            d["after"] = after
        if refs:
            d["refs"] = refs
        self.db.execute("INSERT INTO work_order_events(ts, sim_time, work_order_id, incident_id, actor, actor_role, action, summary, "
                        "detail_json) VALUES (?,?,?,?,?,?,?,?,?)",
                        (now_iso(), iso(self.cursor), wo.work_order_id, wo.incident_id, actor, role, action, summary, dumps(d)))
        self.db.audit(action=f"wo_{action}", actor=actor, actor_type=actor_type, run_id=self.run_id, incident_id=wo.incident_id,
                      asset_id=wo.asset_id, sim_time=iso(self.cursor), summary=f"{wo.work_order_id}: {summary}", detail=d)

    def work_order_history(self, wo_id: str) -> list[dict]:
        self._wo(wo_id)
        return [{**{k: r[k] for k in ("id", "ts", "sim_time", "actor", "actor_role", "action", "summary")}, "detail": loads(r["detail_json"])}
                for r in self.db.all("SELECT * FROM work_order_events WHERE work_order_id=? ORDER BY id", (wo_id,))]

    def _sim_date(self) -> date:
        return self.cursor.date()

    def _overdue(self, wo: WorkOrderDraft) -> bool:
        return bool(wo.assignment and wo.status in LIVE_WO and self._sim_date() > date.fromisoformat(wo.assignment.due_date))

    def check_overdue(self) -> None:
        """Marks live work past its due date (simulation clock) and records ONE escalation event per due date."""
        with self.lock:
            for r in self.db.all("SELECT w.work_order_id id FROM work_orders w JOIN incidents i ON i.incident_id=w.incident_id "
                                 "WHERE i.run_id=? AND w.status IN ('assigned','accepted','in_progress','returned','submitting_evidence')", (self.run_id,)):
                wo = self._wo(r["id"])
                if not self._overdue(wo):
                    continue
                due = wo.assignment.due_date  # type: ignore[union-attr]
                seen = any(loads(e["detail_json"]).get("due_date") == due for e in self.db.all(
                    "SELECT detail_json FROM work_order_events WHERE work_order_id=? AND action='overdue_escalation'", (wo.work_order_id,)))
                if not seen:
                    self._wo_event(wo, "overdue_escalation", "System (simulated escalation)", "system",
                                   f"Overdue: due {due}, still {wo.status.replace('_', ' ')}. Escalated to the asset owner (simulated; no message is sent).",
                                   {"due_date": due, "status": wo.status, "responsible": wo.assignment.person}, actor_type="system")  # type: ignore[union-attr]
                    self._save_wo(wo.model_copy(update={"escalated_at": iso(self.cursor)}))

    def load_follow_up(self, incident_id: str, follow_up_set: str, actor: str, role: str) -> dict:
        with self.lock:
            if role not in APPROVER_ROLES | {"viewer"}:
                raise AccessDenied("unknown role")
            inc = self.db.one("SELECT * FROM incidents WHERE incident_id=?", (incident_id,))
            if not inc:
                raise NotFound(incident_id)
            if inc["state"] not in FOLLOW_UP_ALLOWED:
                raise WorkflowError("Follow-up readings can be loaded only after a work order has been approved "
                                    f"(current state {inc['state']})")
            if follow_up_set not in ("persists", "improves", "insufficient"):
                raise WorkflowError("unknown follow-up set")
            a = inc["asset_id"]
            d = self.data[a]
            ev = AnomalyEvent.model_validate(loads(self.db.one("SELECT json FROM anomaly_events WHERE event_id=?",
                                                               (inc["event_id"],))["json"]))
            wi = loads(self.db.one("SELECT json FROM workflow_inputs WHERE incident_id=?", (incident_id,))["json"])
            k = len(wi["follow_ups"])
            start = self.cursor + timedelta(hours=6 + 24 * k)
            pre_end = min(ev.last_window, self.ingested[a])
            self._transition(incident_id, "VERIFYING", actor, "human",
                             f"Follow-up readings loaded (set: {follow_up_set}); Verifier started")
            started = now_iso()
            ev_ids = [r["ref_id"] for r in self.db.all("SELECT ref_id FROM evidence_refs WHERE incident_id=?",
                                                       (incident_id,))]
            res, fu, ms = pipeline.run_verify(ev, d, pre_end, follow_up_set, start, incident_id, ev_ids[:3])
            vid = self.db.next_id("verification", "VER")
            rows = []
            for s in d.asset.sensors:
                for j, (r, f) in enumerate(zip(fu["rows"][s.sensor_id], fu["flags"][s.sensor_id])):
                    rows.append((self.run_id, a, s.sensor_id, 100000 + k * 1000 + j, r["t_start"], r["t_end"],
                                 "follow_up", dumps(r["features"]), f.status, f.detail, incident_id, self.run.seed,
                                 d.baseline.version, now_iso()))
            self.db.executemany("INSERT OR REPLACE INTO readings VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)
            self.db.execute("INSERT INTO verification_results VALUES (?,?,?,?,?,?,?)",
                            (vid, incident_id, a, res.outcome, dumps(res), now_iso(), iso(self.cursor)))
            wi["follow_ups"].append({"set": follow_up_set, "start": iso(start), "pre_end": pre_end,
                                     "verification_id": vid})
            self.db.execute("UPDATE workflow_inputs SET json=? WHERE incident_id=?", (dumps(wi), incident_id))
            self._agent_run(incident_id, a, pipeline.AgentTrace(agent="verifier", status="done", duration_ms=ms,
                                                                output=res.model_dump()), started)
            to = {"persists": "MONITORING_PERSISTS", "improves": "MONITORING_IMPROVED",
                  "cannot_assess": "CANNOT_ASSESS"}[res.outcome]
            self._transition(incident_id, to, "Verifier", "agent", f"Monitoring outcome: {res.outcome_label}",
                             detail={"verification_id": vid})
            return res.model_dump()

    def close_incident(self, incident_id: str, actor: str, role: str, note: str) -> dict:
        with self.lock:
            self._require_role(role, APPROVER_ROLES, "close incidents")
            inc = self.db.one("SELECT * FROM incidents WHERE incident_id=?", (incident_id,))
            if not inc:
                raise NotFound(incident_id)
            if inc["state"] != "MONITORING_IMPROVED":
                raise WorkflowError("An incident can be closed by a human only after the Verifier reports "
                                    "'improves'. Current state: " + inc["state"])
            if not note.strip():
                raise WorkflowError("A closure note is required")
            self._transition(incident_id, "CLOSED_BY_HUMAN", actor, "human", f"Closed by {actor} ({role}): {note}")
            return self.incident(incident_id)

    def inject_fault(self, sensor_id: str, kind: str, actor: str) -> dict:
        with self.lock:
            asset_id = next((a for a, d in self.data.items() if any(s.sensor_id == sensor_id for s in d.asset.sensors)), None)
            if asset_id is None:
                raise NotFound(sensor_id)
            if kind not in ("frozen_sensor", "stale_sensor"):
                raise WorkflowError("kind must be frozen_sensor or stale_sensor")
            iv = Intervention(type=kind, sensor_id=sensor_id, from_time=iso(self.cursor),
                              label=f"{kind.replace('_', ' ')} injected on {sensor_id} at {iso(self.cursor)}")
            self.run = self.run.model_copy(update={"interventions": [*self.run.interventions, iv]})
            self.db.execute("UPDATE runs SET config_json=? WHERE run_id=?", (dumps(self.run), self.run_id))
            old = self.data[asset_id]
            new = prepare_asset(self.run, asset_id)
            # already-ingested windows are history and must not change
            assert new.baseline.version == old.baseline.version
            self.data[asset_id] = new
            self.db.audit(action="fault_injected", actor=actor, actor_type="human", run_id=self.run_id,
                          asset_id=asset_id, sim_time=iso(self.cursor),
                          summary=f"What-if/live control: {iv.label} (SIMULATED fault)", detail=iv.model_dump())
            return self.snapshot()

    # ------------------------------------------------------------------ read models
    def asset_status(self, a: str) -> dict:
        d = self.data[a]
        upto = self.ingested[a]
        inc = self._open_incident(a)
        det = d.detection_sensors()
        latest = {s.sensor_id: d.flags[s.sensor_id][upto].status for s in d.asset.sensors}
        dq_issues = [f"{sid}: {st}" for sid, st in latest.items() if st != "ok"]
        if d.baseline.status == "insufficient_data" or (det and all(latest[s] != "ok" for s in det)):
            status = "Data unavailable"
        elif inc and inc["escalation"]:
            status = "Escalation required"
        elif inc:
            status = "Investigate"
        else:
            status = "No anomaly detected"
        return {"status": status, "data_quality_issues": dq_issues, "open_incident": inc["incident_id"] if inc else None}

    def display_feature(self, a: str) -> tuple[str, str]:
        return {"BRG-017": ("ACC-M1", "dom_freq"), "BLD-204": ("TLT-N1", "tilt_resid"),
                "RW-031": ("IN-01", "tilt")}[a]

    def asset_summary(self, a: str) -> dict:
        d = self.data[a]
        upto = self.ingested[a]
        sid, feat = self.display_feature(a)
        spark = []
        for i in range(max(0, upto - 95), upto + 1):
            spark.append({"i": i, "v": d.rows[sid][i]["features"].get(feat), "q": d.flags[sid][i].status,
                          "x": d.exceed[sid][i]})
        latest_val = next((p["v"] for p in reversed(spark) if p["v"] is not None), None)
        sensors = []
        for s in d.asset.sensors:
            h = sensor_health(d.flags[s.sensor_id][: upto + 1])
            sensors.append({"sensor_id": s.sensor_id, "kind": s.kind, "location": s.location, **h})
        st = self.asset_status(a)
        return {
            "asset_id": a, "name": d.asset.name, "type": d.asset.type, "criticality": d.asset.criticality,
            "location_text": d.asset.location_text, **st,
            "baseline": {"version": d.baseline.version, "status": d.baseline.status,
                         "reviewed": d.baseline.reference_reviewed},
            "display": {"sensor_id": sid, "feature": feat, "unit": next(
                s.units.get(feat, "") for s in d.asset.sensors if s.sensor_id == sid), "latest": latest_val,
                "median": next((f.median for f in d.baseline.features if f.sensor_id == sid and f.feature == feat), None),
                "sparkline": spark},
            "sensors": sensors, "open_incidents": len([r for r in self._incidents(a) if not r["closed"]]),
            "last_updated": d.rows[sid][upto]["t_end"], "windows_ingested": upto + 1,
            "thresholds": [t.model_dump() for t in d.asset.thresholds],
            "threshold_label": None if d.asset.thresholds else "No engineering safety threshold configured",
        }

    def snapshot(self) -> dict:
        incs = self._incidents()
        audit = self.db.all("SELECT * FROM audit_events WHERE run_id=? ORDER BY id DESC LIMIT 40", (self.run_id,))
        total = (SIM_END - SIM_START).total_seconds()
        return {
            "run": {"run_id": self.run_id, "config": self.run.model_dump(), "versions": versions()},
            "sim": {"cursor": iso(self.cursor), "start": iso(SIM_START), "monitor_start": iso(MONITOR_START),
                    "end": iso(SIM_END), "running": self.running, "speed": self.speed, "speeds": SPEEDS,
                    "progress": round((self.cursor - SIM_START).total_seconds() / total, 4),
                    "finished": self.cursor >= SIM_END, "last_tick_at": self.last_tick_at},
            "assets": [self.asset_summary(a) for a in self.active],
            "incidents": [self._incident_brief(r) for r in incs],
            "activity": [self._audit_row(r) for r in audit],
        }

    def _incident_brief(self, r: dict) -> dict:
        ev = loads(self.db.one("SELECT json FROM anomaly_events WHERE event_id=?", (r["event_id"],))["json"])
        tri = self.db.one("SELECT json FROM triage_results WHERE incident_id=? ORDER BY seq DESC", (r["incident_id"],))
        wo = self.db.one("SELECT work_order_id, status FROM work_orders WHERE incident_id=? ORDER BY created_at DESC",
                         (r["incident_id"],))
        t = loads(tri["json"]) if tri else None
        return {"incident_id": r["incident_id"], "asset_id": r["asset_id"], "state": r["state"],
                "status_text": r["status_text"], "closed": bool(r["closed"]), "escalation": bool(r["escalation"]),
                "event_id": r["event_id"], "primary_sensor_id": ev["primary_sensor_id"],
                "top_feature": ev["deviations"][0]["feature"], "top_z": ev["deviations"][0]["z"],
                "onset_time": ev["onset_time"], "detected_time": ev["detected_time"],
                "priority": t["priority"] if t else None, "timeframe": t["timeframe"] if t else None,
                "work_order_id": wo["work_order_id"] if wo else None, "work_order_status": wo["status"] if wo else None,
                "findings_count": len(ev.get("findings", [])) or 1}

    @staticmethod
    def _audit_row(r: dict) -> dict:
        return {**{k: r[k] for k in ("id", "ts", "sim_time", "incident_id", "asset_id", "actor", "actor_type",
                                     "action", "from_state", "to_state", "summary")},
                "detail": loads(r["detail_json"])}

    def incident(self, incident_id: str) -> dict:
        r = self.db.one("SELECT * FROM incidents WHERE incident_id=?", (incident_id,))
        if not r:
            raise NotFound(incident_id)
        ev = loads(self.db.one("SELECT json FROM anomaly_events WHERE event_id=?", (r["event_id"],))["json"])
        inv = self.db.one("SELECT json FROM investigations WHERE incident_id=?", (incident_id,))
        tri = self.db.all("SELECT * FROM triage_results WHERE incident_id=? ORDER BY seq", (incident_id,))
        wos = self.db.all("SELECT * FROM work_orders WHERE incident_id=? ORDER BY created_at", (incident_id,))
        aps = self.db.all("SELECT json FROM approvals WHERE incident_id=? ORDER BY created_at", (incident_id,))
        ver = self.db.all("SELECT * FROM verification_results WHERE incident_id=? ORDER BY created_at", (incident_id,))
        runs = self.db.all("SELECT json FROM agent_runs WHERE incident_id=? ORDER BY started_at, rowid", (incident_id,))
        audit = self.db.all("SELECT * FROM audit_events WHERE incident_id=? ORDER BY id", (incident_id,))
        wi = loads(self.db.one("SELECT json FROM workflow_inputs WHERE incident_id=?", (incident_id,))["json"])
        d = self.data.get(r["asset_id"]) if r["run_id"] == self.run_id else None
        return {
            "incident": {k: r[k] for k in r}, "state_text": STATE_TEXT[r["state"]],
            "allowed_transitions": TRANSITIONS[r["state"]], "follow_up_allowed": r["state"] in FOLLOW_UP_ALLOWED,
            "event": ev, "investigation": loads(inv["json"]) if inv else None,
            "triage": [{**loads(t["json"]), "_reason": t["reason"], "_window": t["window_index"],
                        "_sim_time": t["sim_time"]} for t in tri],
            "work_orders": [loads(w["json"]) for w in wos],
            "approvals": [loads(a["json"]) for a in aps],
            "verifications": [{**loads(v["json"]), "_id": v["verification_id"], "_sim_time": v["sim_time"]} for v in ver],
            "agent_runs": [loads(x["json"]) for x in runs],
            "audit": [self._audit_row(a) for a in audit],
            "workflow_inputs": wi,
            "baseline": d.baseline.model_dump() if d else None,
            "asset": {"asset_id": r["asset_id"], "name": ASSETS[r["asset_id"]].name, "type": ASSETS[r["asset_id"]].type},
            "is_current_run": r["run_id"] == self.run_id,
            "staged": self.staged, "next_stage": self.next_stage(r["state"]) if r["run_id"] == self.run_id else None,
        }
