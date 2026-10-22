"""Agent 5 — Verifier. Compares follow-up readings with the baseline and the pre-intervention
windows. Outcome is a MONITORING outcome only: persists, improves or cannot assess.
The incident stays open unless a human closes it; 'improves' never means 'resolved'."""
from __future__ import annotations

import statistics

from backend.baseline.service import feature_baseline
from backend.contracts import AnomalyEvent, QualityFlag, VerificationMetrics, VerificationResult
from backend.detector.detector import AssetData
from backend.version import VERIFIER_RULES_VERSION

VERIFIER_RULES = [
    "Valid follow-up windows (quality OK) < max(8, 50% of delivered windows) → cannot assess",
    "Median follow-up |z| ≥ threshold, or ≥ 50% of valid windows exceed → persists",
    "Median follow-up |z| < threshold AND < 20% exceed AND median |z| ≤ 50% of pre-intervention → improves",
    "Anything else → cannot assess (mixed evidence)",
]

LABELS = {
    "persists": "Deviation persists",
    "improves": "Readings returned toward baseline (monitoring improved)",
    "cannot_assess": "Cannot assess",
}
STATUS = {
    "persists": "Open — deviation persists; further inspection recommended",
    "improves": "Open — monitoring improved; pending human closure review",
    "cannot_assess": "Open — cannot assess (insufficient or mixed follow-up evidence)",
}


def verify(event: AnomalyEvent, data: AssetData, pre_end: int, follow_rows: dict[str, list[dict]],
           follow_flags: dict[str, list[QualityFlag]], follow_up_set: str, incident_id: str,
           evidence_ids: list[str]) -> VerificationResult:
    p = data.asset.detection
    thr = p.z_threshold
    ps = event.primary_sensor_id
    feats = [d.feature for d in event.deviations if abs(d.z) >= thr] or [event.deviations[0].feature]
    metrics: list[VerificationMetrics] = []
    reasoning: list[str] = []
    outcomes: list[str] = []
    rows = follow_rows[ps]
    flags = follow_flags[ps]
    total = len(rows)
    for feat in feats:
        fb = feature_baseline(data.baseline, ps, feat)
        pre = [data.z[ps][i].get(feat) for i in range(event.onset_window, pre_end + 1)]
        pre = [z for z in pre if z is not None]
        post = [(r["features"].get(feat) - fb.median) / fb.scale
                for r, f in zip(rows, flags) if f.status == "ok" and r["features"].get(feat) is not None]
        pre_med = statistics.median(pre) if pre else None
        post_med = statistics.median(post) if post else None
        frac = sum(abs(z) >= thr for z in post) / len(post) if post else None
        metrics.append(VerificationMetrics(
            feature=feat, sensor_id=ps, baseline_median=round(fb.median, 5), baseline_scale=round(fb.scale, 5),
            pre_median_z=None if pre_med is None else round(pre_med, 2),
            post_median_z=None if post_med is None else round(post_med, 2),
            post_fraction_exceeding=None if frac is None else round(frac, 3), pre_windows=len(pre),
            post_windows_total=total, post_windows_valid=len(post), z_threshold=thr))
        min_valid = max(8, total // 2)
        if len(post) < min_valid:
            outcomes.append("cannot_assess")
            reasoning.append(f"{feat}: only {len(post)} of {total} follow-up windows passed data-quality checks "
                             f"(need ≥ {min_valid}).")
        elif abs(post_med) >= thr or frac >= 0.5:
            outcomes.append("persists")
            reasoning.append(f"{feat}: follow-up median z = {post_med:+.2f}, {frac:.0%} of windows exceed |z| ≥ {thr}.")
        elif frac < 0.2 and pre_med is not None and abs(post_med) <= 0.5 * abs(pre_med):
            outcomes.append("improves")
            reasoning.append(f"{feat}: follow-up median z = {post_med:+.2f} (pre-intervention {pre_med:+.2f}); "
                             f"{frac:.0%} of windows exceed.")
        else:
            outcomes.append("cannot_assess")
            reasoning.append(f"{feat}: mixed evidence (median z = {post_med:+.2f}, {frac:.0%} exceed).")
    if "persists" in outcomes:
        outcome = "persists"
    elif all(o == "improves" for o in outcomes):
        outcome = "improves"
    else:
        outcome = "cannot_assess"
    reasoning.append("Rule applied: " + {"persists": VERIFIER_RULES[1], "improves": VERIFIER_RULES[2],
                                         "cannot_assess": VERIFIER_RULES[0] + " / " + VERIFIER_RULES[3]}[outcome])
    reasoning.append("This is a monitoring outcome. It does not assess structural safety; the incident remains open "
                     "until a qualified human closes it.")
    return VerificationResult(incident_id=incident_id, asset_id=event.asset_id, follow_up_set=follow_up_set,
                              outcome=outcome, outcome_label=LABELS[outcome], metrics=metrics, reasoning=reasoning,
                              evidence_refs=evidence_ids, incident_status=STATUS[outcome], keeps_incident_open=True,
                              rules_version=VERIFIER_RULES_VERSION)
