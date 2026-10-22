"""Agent 4 — Response Planner. Drafts an inspection plan and a PROPOSED work order.
Proposals only: nothing is issued until a human approves. Agents never order closures or evacuations."""
from __future__ import annotations

from backend.contracts import (
    AnomalyEvent, InvestigationResult, NarrativeDraft, PlanStep, TriageResult, WorkOrderDraft,
)
from backend.llm.client import draft
from backend.scenarios.fixtures import SENSOR_FEATURE_LABELS


def _refs_for(inv: InvestigationResult, *source_ids: str) -> list[str]:
    return [r.ref_id for r in inv.evidence_refs if r.source_id in source_ids or
            any(r.source_id.startswith(s) for s in source_ids)]


def plan(event: AnomalyEvent, inv: InvestigationResult, triage: TriageResult, work_order_id: str,
         incident_id: str, asset_type: str) -> WorkOrderDraft:
    ps = event.primary_sensor_id
    health = [r.ref_id for r in inv.evidence_refs if r.kind == "sensor_health"]
    primary = [r.ref_id for r in inv.evidence_refs if r.kind == "reading_window" and r.source_id.startswith(ps + "[")]
    steps: list[tuple[str, str, list[str]]] = []
    steps.append((f"Verify {ps}: check mounting, cabling, logger status and calibration; compare against a "
                  f"portable reference instrument.",
                  "Rules out a sensor or data-acquisition fault before structural conclusions are drawn.", health))
    if asset_type == "bridge":
        steps += [
            ("Visual inspection of main-span bearings and the Pier 2 bearing shelf.",
             "Records note debris on the bearing shelf and bearing-plate corrosion.",
             _refs_for(inv, "IN-BRG-2026-02", "MR-BRG-0152")),
            ("Inspect expansion joint EJ-2 for restraint or debris.", "Joint was resealed; restraint can change "
             "boundary conditions.", _refs_for(inv, "MR-BRG-0141")),
            ("Take a short ambient-vibration measurement with portable equipment at midspan.",
             "Independently confirms or refutes the dominant-frequency shift.", primary),
        ]
    elif asset_type == "building":
        steps += [
            ("Commission an independent survey (total station or precise levelling) of the north core.",
             "Confirms whether the tilt change is real.", primary),
            ("Review the roof plant installation load records and placement.",
             "A load change was recorded before onset.", _refs_for(inv, "MR-BLD-0091")),
            ("Review groundwater/dewatering logs since pump P-3 replacement.",
             "Ground-water changes can affect foundation behaviour.", _refs_for(inv, "MR-BLD-0088")),
        ]
    else:
        steps += [("Visual inspection of the wall panels and joints near the sensor.", "Confirms the reading.", primary)]
    steps.append(("Qualified engineer reviews findings and decides next actions. Any operational decision "
                  "rests with the responsible engineer and asset owner.", "Human decision point.", []))
    plan_steps = [PlanStep(order=i + 1, action=a, rationale=r, refs=refs) for i, (a, r, refs) in enumerate(steps)]

    top = event.deviations[0]
    reason = (f"Persistent deviation of {ps} {SENSOR_FEATURE_LABELS.get(top.feature, top.feature)} from this "
              f"asset's baseline (z = {top.z:+.1f}) since {event.onset_time}. Leading hypothesis: "
              f"{inv.hypotheses[0].title} ({inv.hypotheses[0].support} support).")
    if triage.escalation_required:
        reason += " " + triage.escalation_basis

    def fallback() -> NarrativeDraft:
        return NarrativeDraft(
            summary=(f"Proposed {triage.priority} inspection ({triage.timeframe}) of {event.asset_id}. "
                     f"{triage.recommended_first_action} The plan has {len(plan_steps)} steps and requires "
                     f"approval by a qualified engineer before it is issued."),
            key_points=[s.action for s in plan_steps[:4]],
            citations=sorted({r for s in plan_steps for r in s.refs}) or [inv.evidence_refs[0].ref_id],
            source="deterministic_fallback")

    text = draft("Write a short inspection-plan summary (3 sentences) and up to 4 key points from these steps.",
                 {"priority": triage.priority, "timeframe": triage.timeframe,
                  "steps": [s.model_dump() for s in plan_steps]},
                 [r.ref_id for r in inv.evidence_refs], fallback)
    return WorkOrderDraft(work_order_id=work_order_id, incident_id=incident_id, asset_id=event.asset_id,
                          priority=triage.priority, timeframe=triage.timeframe, reason=reason, steps=plan_steps,
                          required_evidence=inv.missing_evidence[:5], plan_text=text)
