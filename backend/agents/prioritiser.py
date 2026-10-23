"""Agent 3 — Risk Prioritiser. Documented deterministic triage rules produce an
inspection-priority RECOMMENDATION. The score is a 'demonstration triage score', not a risk metric."""
from __future__ import annotations

from backend.contracts import (
    AnomalyEvent, FindingContribution, InvestigationResult, OwnerCriterionCheck, TriageFactor, TriageResult,
)
from backend.detector.detector import AssetData
from backend.version import TRIAGE_RULES_VERSION

PRIORITY_TABLE = [
    (10, "P1", "Priority 1 — prompt inspection recommended", "Within 24 hours"),
    (7, "P2", "Priority 2 — inspection recommended", "Within 72 hours"),
    (4, "P3", "Priority 3 — planned inspection", "Within 14 days"),
    (-99, "P4", "Priority 4 — routine", "At next scheduled inspection"),
]

TRIAGE_RULES = [
    "Deviation magnitude: largest |z| over ALL detection findings of the incident: ≥ 8 → +3; ≥ 5 → +2; ≥ threshold → +1",
    "Persistence: exceeding windows ≥ 4× required → +2; ≥ required → +1",
    "Corroboration: ≥ 2 other sensors → +2; 1 → +1; none → 0",
    "Structural-behaviour hypothesis support: strong → +2; moderate → +1",
    "Sensor-fault hypothesis support: strong → −2; moderate → −1",
    "Asset criticality (owner config): high → +2; medium → +1; low → 0",
    "Score → priority: ≥10 P1 (24 h) · 7–9 P2 (72 h) · 4–6 P3 (14 days) · ≤3 P4 (next scheduled)",
    "Owner-supplied criterion exceeded → 'Escalation required' and P1 regardless of score",
    "Sensor-fault support ≥ moderate, or primary data quality degraded → evidence flagged insufficient; "
    "first action is a sensor check",
]


def prioritise(event: AnomalyEvent, inv: InvestigationResult, data: AssetData,
               criterion: OwnerCriterionCheck | None = None) -> TriageResult:
    p = data.asset.detection
    crit = criterion or event.owner_criterion
    factors: list[TriageFactor] = []
    det_f = [f for f in event.findings if f.used_for_detection]
    zmax = max([abs(d.z) for d in event.deviations] + [abs(f.z) for f in det_f])
    pts = 3 if zmax >= 8 else 2 if zmax >= 5 else 1
    factors.append(TriageFactor(name="Deviation magnitude", observed=f"max |z| = {zmax:.1f} across {max(1, len(det_f))} finding(s)", points=pts, rule=TRIAGE_RULES[0]))
    per = event.persistence_count
    pts = 2 if per >= 4 * p.min_exceedances else 1 if per >= p.min_exceedances else 0
    factors.append(TriageFactor(name="Persistence", observed=f"{per} exceeding window(s)", points=pts, rule=TRIAGE_RULES[1]))
    nc = len(event.corroborating_sensors)
    factors.append(TriageFactor(name="Corroboration", observed=f"{nc} other sensor(s)", points=2 if nc >= 2 else nc,
                                rule=TRIAGE_RULES[2]))
    hyp = {h.key: h for h in inv.hypotheses}
    sb = hyp["structural_behaviour_change"].support
    factors.append(TriageFactor(name="Structural-behaviour hypothesis", observed=f"{sb} support",
                                points={"strong": 2, "moderate": 1}.get(sb, 0), rule=TRIAGE_RULES[3]))
    sf = hyp["sensor_fault"].support
    factors.append(TriageFactor(name="Sensor-fault hypothesis", observed=f"{sf} support",
                                points={"strong": -2, "moderate": -1}.get(sf, 0), rule=TRIAGE_RULES[4]))
    cr = data.asset.criticality
    factors.append(TriageFactor(name="Asset criticality", observed=cr, points={"high": 2, "medium": 1}.get(cr, 0),
                                rule=TRIAGE_RULES[5]))
    score = sum(f.points for f in factors)
    _, prio, label, tf = next(row for row in PRIORITY_TABLE if score >= row[0])

    escalation = bool(crit.configured and crit.exceeded)
    basis = "No owner-supplied criterion exceeded." if crit.configured else crit.label + "."
    if escalation:
        prio, label, tf = "P1", "Escalation required — owner-supplied criterion exceeded", "Within 24 hours"
        basis = (f"{crit.label}: value {crit.value} exceeds limit {crit.limit}."
                 + (" This is a demonstration criterion, not an engineering limit." if crit.kind == "demo_criterion" else ""))

    primary_degraded = not event.data_quality.passed
    insufficient = sf in ("strong", "moderate") or primary_degraded
    reason = None
    first = "Qualified engineer to review evidence and carry out the proposed inspection."
    if insufficient:
        reason = ("Sensor-fault hypothesis has " + sf + " support" if sf in ("strong", "moderate")
                  else "Primary sensor data quality degraded") + "; verify the sensor before drawing conclusions."
        first = "Verify the sensor (mounting, cabling, logger, calibration) before structural inspection."

    contributions = []
    for f in event.findings:
        counted = ("Deviation magnitude and persistence (primary finding)" if f.role == "primary"
                   else "Deviation magnitude and corroboration" if f.used_for_detection else "Supporting context — shown, not scored")
        contributions.append(FindingContribution(sensor_id=f.sensor_id, component_name=f.component_name, role=f.role,
                                                 feature_label=f.feature_label, z=f.z, persistence_count=f.persistence_count,
                                                 counted_as=counted))
    uncertainty = []
    if not data.baseline.reference_reviewed:
        uncertainty.append("Baseline is provisional: its reference period has not been reviewed by an engineer.")
    if not det_f or len(det_f) < 2:
        uncertainty.append("Only one detection sensor shows the deviation; corroboration is limited.")
    if inv.missing_evidence:
        uncertainty.append(f"{len(inv.missing_evidence)} evidence gap(s) remain (see the Investigator's evidence stage).")
    if not data.asset.thresholds:
        uncertainty.append("No engineering safety threshold is configured; priority is based on deviation from the asset's own baseline.")
    if event.persistence_count <= p.min_exceedances:
        uncertainty.append(f"Duration is short so far ({event.persistence_count} exceeding window(s)).")
    formula = " + ".join(f"{f.points:+d} ({f.name})" for f in factors) + f" = {score}"
    return TriageResult(event_id=event.event_id, asset_id=event.asset_id, priority=prio, priority_label=label,
                        timeframe=tf, demonstration_triage_score=score, score_formula=formula, factors=factors,
                        escalation_required=escalation, escalation_basis=basis, insufficient_evidence=insufficient,
                        insufficient_evidence_reason=reason, recommended_first_action=first,
                        rules_version=TRIAGE_RULES_VERSION, contributing_findings=contributions, uncertainty=uncertainty)
