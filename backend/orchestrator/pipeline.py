"""Pure, deterministic agent chain shared by the live orchestrator, the What-If Lab and
Decision Replay. Same inputs + same versions => same decisions."""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Optional

from backend.agents.investigator import investigate
from backend.agents.planner import plan
from backend.agents.prioritiser import prioritise
from backend.agents.sentinel import run_sentinel
from backend.agents.verifier import verify
from backend.contracts import (
    AnomalyEvent, InvestigationResult, QualityFlag, TriageResult, VerificationResult, WorkOrderDraft,
)
from backend.detector.detector import AssetData, owner_criterion, rederive_follow_up
from backend.scenarios.datasource import get_datasource

FOLLOW_UP_HOURS = 6


def follow_up_windows(data: AssetData) -> int:
    """6 h of 15-min windows for the bridge, 24 h of hourly windows otherwise."""
    return 24


def load_follow_up(data: AssetData, follow_up_set: str, start: datetime, event: AnomalyEvent
                   ) -> tuple[dict[str, list[dict]], dict[str, list[QualityFlag]]]:
    ctx = {}
    if data.asset.asset_id == "BLD-204":
        last = data.rows[event.primary_sensor_id][event.last_window]["features"].get("tilt_resid")
        ctx["drift_level"] = last if last is not None else 0.25
    rows = get_datasource().follow_up(data.run.seed, data.asset.asset_id, follow_up_set, start,
                                      follow_up_windows(data), data.run.environment, ctx)
    flags = rederive_follow_up(data, rows)
    return rows, flags


@dataclass
class AgentTrace:
    agent: str
    status: str
    duration_ms: float
    tool_calls: list = field(default_factory=list)
    fallback_used: bool = False
    fallback_reason: Optional[str] = None
    output: Any = None


@dataclass
class ChainResult:
    event: AnomalyEvent
    investigation: InvestigationResult
    triage: TriageResult
    work_order: WorkOrderDraft
    traces: list[AgentTrace]


def _timed(fn):
    t0 = time.perf_counter()
    out = fn()
    return out, round((time.perf_counter() - t0) * 1000, 3)


def detect(data: AssetData, start: int, end: int, event_id: str, run_id: str):
    (res, ms) = _timed(lambda: run_sentinel(data, start, end, event_id, run_id))
    event, rec, info = res
    return event, AgentTrace(agent="sentinel", status="done", duration_ms=ms, tool_calls=rec.calls,
                             output=event.model_dump() if event else None), info


def run_chain(event: AnomalyEvent, data: AssetData, prior_events: list[dict], incident_id: str,
              work_order_id: str) -> ChainResult:
    inv, ms_i = _timed(lambda: investigate(event, data, prior_events))
    t_inv = AgentTrace(agent="investigator", status="fallback_used" if inv.narrative.source != "llm" else "done",
                       duration_ms=ms_i, tool_calls=inv.tool_calls, fallback_used=inv.narrative.source != "llm",
                       fallback_reason=inv.narrative.fallback_reason, output=inv.model_dump())
    tri, ms_t = _timed(lambda: prioritise(event, inv, data))
    t_tri = AgentTrace(agent="prioritiser", status="done", duration_ms=ms_t, output=tri.model_dump())
    wo, ms_p = _timed(lambda: plan(event, inv, tri, work_order_id, incident_id, data.asset.type))
    t_wo = AgentTrace(agent="planner", status="fallback_used" if wo.plan_text.source != "llm" else "done",
                      duration_ms=ms_p, fallback_used=wo.plan_text.source != "llm",
                      fallback_reason=wo.plan_text.fallback_reason, output=wo.model_dump())
    return ChainResult(event=event, investigation=inv, triage=tri, work_order=wo, traces=[t_inv, t_tri, t_wo])


def update_event(event: AnomalyEvent, data: AssetData, upto: int) -> AnomalyEvent:
    """Extends an open event with newly ingested windows (persistence count, last window, criterion)."""
    ps = event.primary_sensor_id
    count = sum(data.exceed[ps][event.onset_window: upto + 1])
    return event.model_copy(update={
        "last_window": upto, "last_time": data.rows[ps][upto]["t_end"], "persistence_count": count,
        "owner_criterion": owner_criterion(data, upto)})


def retriage(event: AnomalyEvent, inv: InvestigationResult, data: AssetData, window: int) -> TriageResult:
    return prioritise(event, inv, data, criterion=owner_criterion(data, window))


def run_verify(event: AnomalyEvent, data: AssetData, pre_end: int, follow_up_set: str, start: datetime,
               incident_id: str, evidence_ids: list[str]) -> tuple[VerificationResult, dict, float]:
    (rows, flags), ms_l = _timed(lambda: load_follow_up(data, follow_up_set, start, event))
    res, ms_v = _timed(lambda: verify(event, data, pre_end, rows, flags, follow_up_set, incident_id, evidence_ids))
    return res, {"rows": rows, "flags": flags}, ms_l + ms_v


def decision_fields(event: Optional[AnomalyEvent], inv: Optional[InvestigationResult] = None,
                    triage: Optional[TriageResult] = None, wo: Optional[WorkOrderDraft] = None,
                    verifications: Optional[list[VerificationResult]] = None,
                    retriages: Optional[list[TriageResult]] = None) -> dict[str, Any]:
    """Flattened decision fields used for before/after and recorded/replayed diffs (no free text)."""
    d: dict[str, Any] = {"detection.anomaly_event": event is not None}
    if event:
        d.update({
            "detection.primary_sensor": event.primary_sensor_id,
            "detection.onset_window": event.onset_window,
            "detection.onset_time": event.onset_time,
            "detection.detected_window": event.detected_window,
            "detection.detected_time": event.detected_time,
            "detection.top_feature": event.deviations[0].feature if event.deviations else None,
            "detection.top_z": event.deviations[0].z if event.deviations else None,
            "detection.corroborating_sensors": list(event.corroborating_sensors),
            "detection.quality_gate_issues": list(event.data_quality.issues),
            "detection.baseline_version": event.baseline_version,
            "detection.input_hash": event.input_hash,
            "detection.change_point_window": event.change_point_window,
        })
    if inv:
        for h in inv.hypotheses:
            d[f"hypothesis.{h.key}.support"] = h.support
            d[f"hypothesis.{h.key}.rank"] = h.rank
        d["investigation.missing_evidence_count"] = len(inv.missing_evidence)
        d["investigation.evidence_refs"] = [f"{r.ref_id}:{r.source_id}" for r in inv.evidence_refs]
    if triage:
        d.update({"triage.priority": triage.priority, "triage.timeframe": triage.timeframe,
                  "triage.score": triage.demonstration_triage_score,
                  "triage.escalation_required": triage.escalation_required,
                  "triage.insufficient_evidence": triage.insufficient_evidence})
    for k, t in enumerate(retriages or []):
        d[f"retriage[{k}].priority"] = t.priority
        d[f"retriage[{k}].escalation_required"] = t.escalation_required
    if wo:
        d.update({"work_order.priority": wo.priority, "work_order.steps": [s.action for s in wo.steps],
                  "work_order.required_evidence": list(wo.required_evidence)})
    for k, v in enumerate(verifications or []):
        d[f"verification[{k}].outcome"] = v.outcome
        for m in v.metrics:
            d[f"verification[{k}].{m.feature}.post_median_z"] = m.post_median_z
            d[f"verification[{k}].{m.feature}.post_valid"] = m.post_windows_valid
    return d


def diff_fields(a: dict[str, Any], b: dict[str, Any]) -> list[dict[str, Any]]:
    keys = list(dict.fromkeys([*a.keys(), *b.keys()]))
    return [{"field": k, "before": a.get(k), "after": b.get(k)} for k in keys if a.get(k) != b.get(k)]
