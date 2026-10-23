"""Agent 2 — Investigator. Retrieves history, records and environmental context, then weighs three
competing hypotheses with documented deterministic rules. Every claim cites an evidence ref.
Observations (computed facts) are kept separate from hypotheses. An LLM may only re-word the result."""
from __future__ import annotations

from datetime import timedelta
from typing import Optional

import numpy as np

from backend.agents.base import EvidenceBook, ToolRecorder
from backend.baseline.service import feature_baseline
from backend.contracts import AnomalyEvent, Claim, FindingEvidence, Hypothesis, InvestigationResult, NarrativeDraft
from backend.detector.detector import AssetData
from backend.llm.client import draft
from backend.scenarios.assets import parse_iso
from backend.scenarios.datasource import get_datasource
from backend.scenarios.fixtures import SENSOR_FEATURE_LABELS
from backend.version import INVESTIGATOR_RULES_VERSION

SUPPORT_RULE = "points ≥4: strong · 2–3: moderate · 1: weak · ≤0: weak (no supporting evidence)"


def _support(points: int) -> str:
    return "strong" if points >= 4 else "moderate" if points >= 2 else "weak"


def _fmt(v: float, unit: str) -> str:
    return f"{v:.4g} {unit}".strip()


def _corr(a: list, b: list) -> Optional[float]:
    pairs = [(x, y) for x, y in zip(a, b) if x is not None and y is not None]
    if len(pairs) < 20:
        return None
    x, y = np.array(pairs).T
    if x.std() == 0 or y.std() == 0:
        return None
    return float(np.corrcoef(x, y)[0, 1])


def investigate(event: AnomalyEvent, data: AssetData, prior_events: list[dict]) -> InvestigationResult:
    rec = ToolRecorder()
    book = EvidenceBook()
    asset = data.asset
    a_id = asset.asset_id
    p = asset.detection
    ps = event.primary_sensor_id
    sensor = next(s for s in asset.sensors if s.sensor_id == ps)
    top = event.deviations[0]
    lo = max(data.n_ref, event.detected_window - p.persistence_windows + 1)
    hi = event.last_window
    records = get_datasource().records(a_id)

    # ---- tool calls ---------------------------------------------------------------------
    bl = rec.call("get_baseline", {"asset_id": a_id}, lambda: data.baseline,
                  lambda b: f"{b.version} ({b.status}, reviewed={b.reference_reviewed})")
    e_base = book.add(kind="baseline", source_id=bl.version, title=f"Baseline {bl.version}",
                      summary=f"Status {bl.status}; reference {bl.reference_period.start} → {bl.reference_period.end}; "
                              f"reviewed: {bl.reference_reviewed}.",
                      data={"status": bl.status, "reviewed": bl.reference_reviewed})

    win = rec.call("get_window_features", {"sensor_id": ps, "windows": [event.onset_window, hi]},
                   lambda: data.rows[ps][event.onset_window: hi + 1])
    e_primary = book.add(
        kind="reading_window", source_id=f"{ps}[{event.onset_window}-{hi}]",
        title=f"{ps} window features, windows {event.onset_window}–{hi}",
        summary=f"{SENSOR_FEATURE_LABELS.get(top.feature, top.feature)} {_fmt(top.value, top.unit)} vs median "
                f"{_fmt(top.median, top.unit)} (z = {top.z:+.1f}).",
        timestamp=event.onset_time,
        data={"windows": [{"i": r["window_index"], "t": r["t_start"],
                           **{k: v for k, v in r["features"].items()}} for r in win],
              "z": [data.z[ps][i] for i in range(event.onset_window, hi + 1)]})

    corr_refs: dict[str, str] = {}
    for sid in event.corroborating_sensors:
        rows = rec.call("get_window_features", {"sensor_id": sid, "windows": [lo, hi]}, lambda sid=sid: data.rows[sid][lo: hi + 1])
        zmax = max((abs(z) for i in range(lo, hi + 1) for z in data.z[sid][i].values() if z is not None), default=0)
        corr_refs[sid] = book.add(kind="reading_window", source_id=f"{sid}[{lo}-{hi}]",
                                  title=f"{sid} window features, windows {lo}–{hi}",
                                  summary=f"Max |z| = {zmax:.1f} over the same windows.", timestamp=rows[0]["t_start"],
                                  data={"max_abs_z": round(zmax, 2)})

    # context sensors (strain, tilt, ...) that are not used for detection but add supporting context
    ctx_obs: list[Claim] = []
    ctx_refs: dict[str, str] = {}
    for s in asset.sensors:
        if s.detection_features or s.kind not in ("strain_gauge", "tiltmeter", "crackmeter"):
            continue
        cf = s.features[0]
        zs = [abs(z) for i in range(lo, hi + 1) if data.flags[s.sensor_id][i].status == "ok"
              and (z := data.z[s.sensor_id][i].get(cf)) is not None]
        if not zs:
            continue
        zmed = float(np.median(zs))
        ref = book.add(kind="reading_window", source_id=f"{s.sensor_id}[{lo}-{hi}]",
                       title=f"{s.sensor_id} (context) {SENSOR_FEATURE_LABELS.get(cf, cf)}, windows {lo}–{hi}",
                       summary=f"Median |z| = {zmed:.1f} over the event windows. Context sensor: not used for detection.",
                       timestamp=data.rows[s.sensor_id][lo]["t_start"], data={"median_abs_z": round(zmed, 2)})
        ctx_refs[s.sensor_id] = ref
        shifted = zmed >= 0.7 * p.z_threshold
        ctx_obs.append(Claim(kind="observation", refs=[ref], text=(
            f"Context sensor {s.sensor_id} ({s.location}) "
            + (f"also shifted (median |z| = {zmed:.1f})." if shifted else f"stayed near its baseline (median |z| = {zmed:.1f}).")
            + " It is not used for detection.")))

    health = rec.call("get_sensor_health", {"asset_id": a_id, "windows": [lo - 8, hi]},
                      lambda: {s.sensor_id: [f.status for f in data.flags[s.sensor_id][max(0, lo - 8): hi + 1]]
                               for s in asset.sensors})
    primary_issues = [s for s in health[ps] if s != "ok"]
    other_issues = {sid: [s for s in st if s != "ok"] for sid, st in health.items() if sid != ps}
    other_issues = {k: v for k, v in other_issues.items() if v}
    e_health = book.add(kind="sensor_health", source_id=f"{a_id}:health[{lo - 8}-{hi}]",
                        title="Sensor data-quality status around the event",
                        summary=f"{ps}: {len(primary_issues)} issue(s); "
                                + ("; ".join(f"{k}: {sorted(set(v))}" for k, v in other_issues.items())
                                   or "other sensors: no issues"),
                        data={k: sorted(set(v)) for k, v in other_issues.items()})

    onset_dt = parse_iso(event.onset_time)
    maint = rec.call("get_maintenance_records", {"asset_id": a_id, "lookback_days": 365},
                     lambda: [r for r in records.get("maintenance", [])])
    insp = rec.call("get_inspection_notes", {"asset_id": a_id}, lambda: [r for r in records.get("inspections", [])])
    logs = rec.call("get_operational_logs", {"asset_id": a_id, "around": event.onset_time},
                    lambda: [r for r in records.get("logs", [])])
    rec_refs: dict[str, str] = {}
    for r in maint + insp + logs:
        kind = "maintenance_record" if r in maint else "inspection_note" if r in insp else "environment_record"
        rec_refs[r["id"]] = book.add(kind=kind, source_id=r["id"], title=r["title"], summary=r["text"],
                                     timestamp=r["date"], data={"category": r["category"], "tags": r["tags"]})

    env = rec.call("get_environment", {"asset_id": a_id, "windows": [lo, hi]},
                   lambda: {"event": data.env[lo: hi + 1], "reference": data.env[: data.n_ref]})
    ref_t = [e["temperature_c"] for e in env["reference"]]
    ev_t = [e["temperature_c"] for e in env["event"]]
    t_lo, t_hi = min(ref_t), max(ref_t)
    temp_outside = min(ev_t) < t_lo - 1.0 or max(ev_t) > t_hi + 1.0
    e_env = book.add(kind="environment_record", source_id=f"WX-{a_id}[{lo}-{hi}]",
                     title="Simulated weather feed during event windows",
                     summary=f"Temperature {min(ev_t):.1f}–{max(ev_t):.1f} °C during event; reference range "
                             f"{t_lo:.1f}–{t_hi:.1f} °C.",
                     data={"event_temp": [min(ev_t), max(ev_t)], "reference_temp": [t_lo, t_hi]})

    prior = rec.call("get_prior_events", {"asset_id": a_id}, lambda: [e for e in prior_events if e["asset_id"] == a_id])
    for pe in prior:
        book.add(kind="prior_event", source_id=pe["event_id"], title=f"Prior event {pe['event_id']}",
                 summary=f"Detected {pe['detected_time']} on {pe['primary_sensor_id']}", timestamp=pe["detected_time"])

    # environmental sensitivity of the deviating feature in the reference period (computed, not assumed)
    driver = "traffic_index" if "traffic_index" in (data.env[0] if data.env else {}) else "temperature_c"
    raw_feat = top.feature if top.feature in data.rows[ps][0]["features"] else sensor.features[0]
    if top.feature in ("tilt_resid", "tilt_slope"):
        raw_feat = top.feature
    r_corr = _corr([r["features"].get(raw_feat) for r in data.rows[ps][: data.n_ref]],
                   [e.get(driver) for e in data.env[: data.n_ref]]) if data.env else None
    ev_driver = [e.get(driver) for e in env["event"]]
    ref_driver = [e.get(driver) for e in env["reference"]]
    driver_p90 = float(np.percentile(ref_driver, 90)) if ref_driver else None
    driver_high = driver_p90 is not None and float(np.mean(ev_driver)) > driver_p90
    e_sens = book.add(kind="reading_window", source_id=f"{ps}:{raw_feat}~{driver}",
                      title=f"Reference-period sensitivity of {raw_feat} to {driver}",
                      summary=(f"Pearson r = {r_corr:+.2f} between {raw_feat} and {driver} over "
                               f"{data.n_ref} reference windows." if r_corr is not None else
                               "Correlation not computable (insufficient paired data)."),
                      data={"r": None if r_corr is None else round(r_corr, 3), "driver": driver,
                            "event_driver_mean": round(float(np.mean(ev_driver)), 3) if ev_driver else None,
                            "reference_p90": None if driver_p90 is None else round(driver_p90, 3)})

    # ---- observations (computed facts) ---------------------------------------------------
    obs: list[Claim] = [
        Claim(kind="observation", refs=[e_primary, e_base],
              text=f"{ps} {SENSOR_FEATURE_LABELS.get(top.feature, top.feature)} was {_fmt(top.value, top.unit)} "
                   f"against a baseline median of {_fmt(top.median, top.unit)} (robust z = {top.z:+.1f}; "
                   f"threshold |z| ≥ {p.z_threshold})."),
        Claim(kind="observation", refs=[e_primary],
              text=f"The exceedance met the persistence rule ({event.persistence_count} exceeding window(s); rule "
                   f"≥{p.min_exceedances} of {p.persistence_windows}) starting {event.onset_time}."),
        Claim(kind="observation", refs=[e_health],
              text=f"Data-quality checks passed for {ps} on all {p.persistence_windows} windows used for detection."
              if not primary_issues else
              f"{ps} had {len(primary_issues)} data-quality issue(s) in the surrounding windows."),
        Claim(kind="observation", refs=[e_env],
              text=f"Temperature during the event ({min(ev_t):.1f}–{max(ev_t):.1f} °C) was "
                   + ("OUTSIDE" if temp_outside else "within")
                   + f" the reference range ({t_lo:.1f}–{t_hi:.1f} °C)."),
    ]
    if event.corroborating_sensors:
        obs.append(Claim(kind="observation", refs=list(corr_refs.values()),
                         text=f"The same persistence rule also held on {', '.join(event.corroborating_sensors)} "
                              f"over the same windows."))
    else:
        obs.append(Claim(kind="observation", refs=[e_health],
                         text="No other sensor on this asset met the persistence rule over the same windows."))
    obs.extend(ctx_obs)
    if r_corr is not None:
        obs.append(Claim(kind="observation", refs=[e_sens],
                         text=f"In the reference period, {raw_feat} correlated with {driver} at r = {r_corr:+.2f}."))
    if asset.detection.temperature_compensation:
        tm = next((m for m in data.temp_models if m.sensor_id == ps), None)
        if tm:
            obs.append(Claim(kind="observation", refs=[e_base],
                             text=f"Tilt was temperature-compensated with a model fitted on the reference period "
                                  f"({tm.slope_per_degC:+.4f} mrad/°C); the deviation is in the compensated residual."))

    # ---- hypotheses (documented rules) --------------------------------------------------
    same_kind = [s.sensor_id for s in asset.sensors if s.kind == sensor.kind and s.sensor_id != ps]
    recent_sensor_work = [r for r in maint if ps in r["tags"] and r["category"] == "sensor"
                          and (onset_dt.date() - parse_iso(r["date"] + "T00:00:00Z").date()).days <= 60]

    sf_for, sf_against, sf_pts = [], [], 0
    if primary_issues:
        sf_pts += 2
        sf_for.append(Claim(kind="observation", refs=[e_health], text=f"{ps} reported data-quality issues near the event."))
    else:
        sf_pts -= 1
        sf_against.append(Claim(kind="observation", refs=[e_health], text=f"{ps} passed missing/stale/frozen/plausibility checks."))
    if event.corroborating_sensors:
        sf_pts -= 2
        sf_against.append(Claim(kind="observation", refs=list(corr_refs.values()),
                                text="Independent sensors show the same persistent deviation."))
    elif same_kind:
        sf_pts += 2
        sf_for.append(Claim(kind="observation", refs=[e_health],
                            text=f"Not corroborated by {', '.join(same_kind)} (same sensor type)."))
    for r in recent_sensor_work:
        sf_pts += 1
        sf_for.append(Claim(kind="observation", refs=[rec_refs[r["id"]]],
                            text=f"Sensor work on {ps} within 60 days before onset ({r['date']}): {r['title']}."))

    el_for, el_against, el_pts = [], [], 0
    if temp_outside:
        el_pts += 1 if p.temperature_compensation else 2
        el_for.append(Claim(kind="observation", refs=[e_env],
                            text="Temperature was outside the reference range"
                                 + (" (temperature compensation is extrapolating)." if p.temperature_compensation else ".")))
    else:
        el_pts -= 1
        el_against.append(Claim(kind="observation", refs=[e_env], text="Temperature was within the reference range."))
    if r_corr is not None:
        if abs(r_corr) < 0.3:
            el_pts -= 1
            el_against.append(Claim(kind="observation", refs=[e_sens],
                                    text=f"{raw_feat} showed little sensitivity to {driver} in the reference period "
                                         f"(r = {r_corr:+.2f})."))
        elif abs(r_corr) >= 0.6 and driver_high:
            el_pts += 1
            el_for.append(Claim(kind="observation", refs=[e_sens],
                                text=f"{raw_feat} is sensitive to {driver} (r = {r_corr:+.2f}) and {driver} was above its "
                                     f"reference 90th percentile during the event."))
    for r in logs + maint:
        if r["category"] in ("load_event", "load_change"):
            start = parse_iso(r["date"] if "T" in r["date"] else r["date"] + "T00:00:00Z")
            end = parse_iso(r["end"]) if r.get("end") else start
            ev_lo, ev_hi = parse_iso(data.rows[ps][lo]["t_start"]), parse_iso(data.rows[ps][hi]["t_end"])
            if start <= ev_hi and end >= ev_lo:
                el_pts += 2
                el_for.append(Claim(kind="observation", refs=[rec_refs[r["id"]]],
                                    text=f"Recorded load event overlaps the event windows: {r['title']}."))
            elif timedelta(0) <= onset_dt - end <= timedelta(days=7):
                el_pts += 1
                el_for.append(Claim(kind="hypothesis", refs=[rec_refs[r["id"]]],
                                    text=f"A load change was recorded {(onset_dt - end).days} day(s) before onset "
                                         f"({r['title']}); timing does not match the onset directly."))
    if p.temperature_compensation:
        el_pts -= 1
        el_against.append(Claim(kind="observation", refs=[e_base],
                                text="Deviation remains after temperature compensation."))

    sb_for, sb_against, sb_pts = [], [], 1
    sb_for.append(Claim(kind="observation", refs=[e_primary], text="Deviation persisted beyond a single window."))
    if abs(top.z) >= 2 * p.z_threshold:
        sb_pts += 1
        sb_for.append(Claim(kind="observation", refs=[e_primary],
                            text=f"Deviation magnitude |z| = {abs(top.z):.1f} is at least twice the threshold."))
    if len(event.corroborating_sensors) >= 2:
        sb_pts += 2
    elif event.corroborating_sensors:
        sb_pts += 1
    if event.corroborating_sensors:
        sb_for.append(Claim(kind="observation", refs=list(corr_refs.values()),
                            text=f"Corroborated by {len(event.corroborating_sensors)} other sensor(s)."))
    if top.feature == "dom_freq":
        sb_pts += 1
        sb_for.append(Claim(kind="hypothesis", refs=[e_primary],
                            text="A shift in dominant frequency is consistent with a change in stiffness or boundary "
                                 "conditions (e.g. bearing restraint) — to be confirmed by inspection."))
    cond = [r for r in maint + insp if r["category"] == "structural_condition"]
    if cond:
        sb_pts += 1
        sb_for.append(Claim(kind="observation", refs=[rec_refs[r["id"]] for r in cond],
                            text="Prior records note condition items: " + "; ".join(r["title"] for r in cond) + "."))
    if _support(sf_pts) == "weak" and _support(el_pts) == "weak":
        sb_pts += 1
        sb_for.append(Claim(kind="hypothesis", refs=[e_health, e_env],
                            text="Neither a sensor fault nor an environmental/load cause is supported by the "
                                 "retrieved evidence."))
    if not event.corroborating_sensors:
        sb_against.append(Claim(kind="observation", refs=[e_health], text="Only one sensor shows the deviation."))
    if primary_issues:
        sb_pts -= 1
        sb_against.append(Claim(kind="observation", refs=[e_health], text="Primary sensor data quality is degraded."))
    if event.persistence_count <= p.min_exceedances:
        sb_against.append(Claim(kind="observation", refs=[e_primary],
                                text=f"Only {event.persistence_count} window(s) observed so far; duration is short."))

    hyps = [
        Hypothesis(key="sensor_fault", title="Sensor or data-acquisition fault", support=_support(sf_pts),
                   support_points=sf_pts, rank=0, evidence_for=sf_for, evidence_against=sf_against),
        Hypothesis(key="environmental_or_load", title="Environmental or load change", support=_support(el_pts),
                   support_points=el_pts, rank=0, evidence_for=el_for, evidence_against=el_against),
        Hypothesis(key="structural_behaviour_change", title="Persistent change in structural behaviour",
                   support=_support(sb_pts), support_points=sb_pts, rank=0, evidence_for=sb_for,
                   evidence_against=sb_against),
    ]
    order = {"structural_behaviour_change": 0, "environmental_or_load": 1, "sensor_fault": 2}
    hyps.sort(key=lambda h: (-h.support_points, order[h.key]))
    for i, h in enumerate(hyps, 1):
        h.rank = i

    # ---- missing evidence ---------------------------------------------------------------
    latest_insp = max((r["date"] for r in insp if r["category"] != "review"), default=None)
    missing = [f"No inspection after anomaly onset (latest inspection on record: {latest_insp or 'none'})."]
    if not bl.reference_reviewed:
        missing.append("Reference period has not been reviewed by an engineer (baseline is provisional).")
    if temp_outside and p.temperature_compensation:
        missing.append("Temperature outside the reference range: compensation model is extrapolating.")
    if other_issues:
        missing.append("Data-quality issues on " + ", ".join(other_issues) + "; their readings are excluded.")
    if asset.type == "bridge":
        missing += ["No weigh-in-motion or traffic-count data for the event windows (only a simulated traffic index).",
                    "No bearing displacement measurement to separate boundary-condition change from "
                    "stiffness change."]
        if event.persistence_count < 24 * 60 // p.window_minutes:
            missing.append("Deviation not yet observed through a full day/night (low-traffic) cycle.")
    elif asset.type == "building":
        missing += ["No independent survey (e.g. total station or levelling) to confirm the tilt change.",
                    "No groundwater-level records after the dewatering pump replacement.",
                    "No load records for the roof plant installation."]
    else:
        missing += ["No piezometer data behind the wall."]
    if not event.corroborating_sensors:
        missing.append("No second sensor of the same type confirms the deviation.")

    # ---- evidence supporting / contradicting each individual finding (deterministic rules, every claim cited)
    fev: list[FindingEvidence] = []
    det_findings = [f for f in event.findings if f.used_for_detection]
    for f in event.findings:
        sup: list[Claim] = []
        con: list[Claim] = []
        own_ref = e_primary if f.sensor_id == ps else corr_refs.get(f.sensor_id, e_primary)
        if f.used_for_detection:
            sup.append(Claim(kind="observation", refs=[own_ref], text=f"Exceeded the threshold in {f.persistence_count} windows since {f.onset_time} (rule ≥{p.min_exceedances} of {p.persistence_windows})."))
            if f.quality_ok:
                sup.append(Claim(kind="observation", refs=[e_health], text="Passed the data-quality gate (no missing, stale, frozen or implausible windows)."))
            else:
                con.append(Claim(kind="observation", refs=[e_health], text="Data-quality issues were present in the windows used."))
            others = [o.sensor_id for o in det_findings if o.sensor_id != f.sensor_id]
            if others:
                sup.append(Claim(kind="observation", refs=[corr_refs.get(o, e_primary) for o in others][:3], text=f"Corroborated by {', '.join(others)}."))
            else:
                con.append(Claim(kind="observation", refs=[e_health], text="No other detection sensor shows the deviation."))
            if abs(f.z) >= 2 * p.z_threshold:
                sup.append(Claim(kind="observation", refs=[own_ref], text=f"Magnitude |z| = {abs(f.z):.1f} is at least twice the threshold."))
            if f.persistence_count <= p.min_exceedances:
                con.append(Claim(kind="observation", refs=[own_ref], text=f"Only {f.persistence_count} exceeding windows observed so far."))
            for r in recent_sensor_work:
                if f.sensor_id in r["tags"]:
                    con.append(Claim(kind="observation", refs=[rec_refs[r["id"]]], text=f"Sensor work on {f.sensor_id} on {r['date']}: {r['title']}."))
        else:
            ref = ctx_refs.get(f.sensor_id, e_primary)
            sup.append(Claim(kind="observation", refs=[ref], text="Shifted in the same event windows, consistent with the detected change."))
            con.append(Claim(kind="observation", refs=[ref], text="Context sensor: not used for detection, so it cannot confirm the finding on its own."))
        if temp_outside:
            con.append(Claim(kind="observation", refs=[e_env], text="Temperature was outside the reference range, so an environmental cause cannot be excluded."))
        fev.append(FindingEvidence(sensor_id=f.sensor_id, supports=sup, contradicts=con))

    all_ids = [r.ref_id for r in book.refs]

    def fallback() -> NarrativeDraft:
        lead = hyps[0]
        return NarrativeDraft(
            summary=(f"{ps} on {asset.name} deviated from its own baseline from {event.onset_time} "
                     f"({SENSOR_FEATURE_LABELS.get(top.feature, top.feature)}, z = {top.z:+.1f}). "
                     f"The highest-ranked hypothesis is '{lead.title}' ({lead.support} support); this is a "
                     f"hypothesis, not a finding. {len(missing)} evidence gap(s) remain and an inspection by a "
                     f"qualified engineer is needed to confirm or rule out each hypothesis."),
            key_points=[c.text for c in obs[:3]] + [f"Hypothesis ranking: " + ", ".join(
                f"{h.rank}. {h.title} ({h.support})" for h in hyps)],
            citations=sorted({r for c in obs[:3] for r in c.refs}),
            source="deterministic_fallback",
        )

    facts = {"observations": [c.model_dump() for c in obs], "hypotheses": [
        {"title": h.title, "support": h.support, "rank": h.rank} for h in hyps], "missing_evidence": missing}
    narrative = draft("Write a 3-sentence plain-language investigation summary and up to 4 key points.",
                      facts, all_ids, fallback)

    return InvestigationResult(event_id=event.event_id, asset_id=a_id, observations=obs, hypotheses=hyps,
                               missing_evidence=missing, evidence_refs=book.refs, narrative=narrative,
                               tool_calls=rec.calls, rules_version=INVESTIGATOR_RULES_VERSION, finding_evidence=fev)


HYPOTHESIS_RULES = {
    "sensor_fault": "+2 primary quality issues · −1 primary quality OK · −2 corroborated · +2 not corroborated by "
                    "same-type sensor · +1 per sensor work on primary within 60 days",
    "environmental_or_load": "+2 temperature outside reference range (+1 if compensated) · −1 within range · "
                             "−1 feature insensitive to driver (|r|<0.3) · +1 sensitive (|r|≥0.6) and driver above "
                             "p90 · +2 load event overlapping windows · +1 load change within 7 days before onset · "
                             "−1 deviation remains after temperature compensation",
    "structural_behaviour_change": "+1 persistence met · +1 |z| ≥ 2×threshold · +2 corroborated by ≥2 (+1 by 1) · "
                                   "+1 dominant-frequency shift · +1 condition records · +1 no alternative supported · "
                                   "−1 primary quality degraded",
    "support_levels": SUPPORT_RULE,
}
