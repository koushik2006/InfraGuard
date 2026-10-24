"""Work-order report (Response Planner output for the maintenance officer).

The report is built ONLY from persisted application data (incident, findings, investigation, triage, approvals, work order).
Each generated version is stored as an immutable snapshot (table work_order_reports) and rendered to print-ready HTML on demand,
so any version can be regenerated identically. Anything the data does not contain is shown as "Not available" — never invented.
"""
from __future__ import annotations

from html import escape
from typing import Any, Optional

from backend.scenarios.assets import ASSETS

UNAVAILABLE = "Not available in the recorded data"
STATUS_LABEL = {
    "proposed": "Pending engineer approval", "approved": "Approved — awaiting assignment", "assigned": "Assigned — awaiting officer acceptance",
    "accepted": "Accepted — work to start", "in_progress": "Work in progress", "submitting_evidence": "Preparing evidence submission",
    "awaiting_verification": "Awaiting engineer evidence approval", "verified": "Job completed (evidence approved)",
    "returned": "Returned for further work", "rejected": "Rejected by engineer", "completed": "Completed (legacy)",
}
KIND_LABEL = {"draft": "System draft (unapproved)", "edited": "Edited by engineer", "approved": "Approved by engineer",
              "assigned": "Assignment recorded", "accepted": "Accepted by officer", "completed": "Completed"}
STAGES = [("sentinel", "Sentinel", "Detection"), ("investigator", "Investigator", "Evidence"),
          ("prioritiser", "Risk Prioritiser", "Assessment"), ("planner", "Response Planner", "Preventive action")]


# ----------------------------------------------------------------------------------------------- snapshot
def build_snapshot(engine: Any, wo: Any, kind: str, actor: str, prior: Optional[dict] = None) -> dict:
    from backend.db.database import loads, now_iso
    inc = engine.incident(wo.incident_id)
    ev, inv = inc["event"], inc["investigation"]
    tri = inc["triage"][-1] if inc["triage"] else None
    asset = ASSETS[wo.asset_id]
    det = asset.detection
    sensor_cfg = {s.sensor_id: s for s in asset.sensors}
    findings = []
    for f in ev.get("findings", []):
        cfg = sensor_cfg.get(f["sensor_id"])
        findings.append({**{k: f[k] for k in ("sensor_id", "role", "component_name", "location", "feature_label", "unit", "value", "baseline_median",
                                               "z", "deviation", "deviation_pct", "onset_time", "persistence_count", "persistence_window",
                                               "quality_ok", "trend", "reason")},
                         "can_raise_alerts": bool(cfg and cfg.detection_features)})
    refs = (inv or {}).get("evidence_refs", [])
    first = prior["plan"]["recommended"] if prior else None
    steps_now = [{"order": s.order, "action": s.action, "rationale": s.rationale} for s in wo.steps]
    plan_now = {"reason": wo.reason, "timeframe": wo.timeframe, "steps": steps_now, "required_evidence": list(wo.required_evidence),
                "precautions": list(wo.precautions), "acceptance_criteria": list(wo.acceptance_criteria)}
    recommended = first or plan_now
    events = engine.work_order_history(wo.work_order_id)
    decisions = [{"ts": e["ts"], "actor": e["actor"], "role": e["actor_role"], "action": e["action"], "summary": e["summary"]}
                 for e in events if e["action"] in ("proposed", "proposal_edited", "approved", "approved_with_edits", "rejected",
                                                    "assigned", "reassigned", "assignment_accepted", "assignment_declined")]
    runs = {r["agent"]: r for r in inc["agent_runs"] if r.get("agent") in {a for a, _, _ in STAGES}}
    approved = wo.status not in ("proposed", "rejected")
    return {
        "meta": {"work_order_id": wo.work_order_id, "incident_id": wo.incident_id, "asset_id": wo.asset_id, "asset_name": asset.name,
                 "generated_at": now_iso(), "generated_by": actor, "kind": kind, "status": wo.status},
        "assignment": wo.assignment.model_dump() if wo.assignment else None,
        "priority": wo.priority, "timeframe": wo.timeframe,
        "incident": {"state": inc["incident"]["state"], "state_text": inc["state_text"], "escalation": bool(inc["incident"]["escalation"]),
                     "onset_time": ev["onset_time"], "detected_time": ev["detected_time"], "baseline_version": ev["baseline_version"],
                     "data_quality": ev.get("data_quality", {}), "findings": findings,
                     "detection": {"z_threshold": det.z_threshold, "min_exceedances": det.min_exceedances,
                                   "persistence_windows": det.persistence_windows, "window_minutes": det.window_minutes}},
        "evidence": {"finding_evidence": (inv or {}).get("finding_evidence", []),
                     "hypotheses": [{"rank": h["rank"], "title": h["title"], "support": h["support"],
                                     "for": [c["text"] for c in h["evidence_for"]], "against": [c["text"] for c in h["evidence_against"]]}
                                    for h in (inv or {}).get("hypotheses", [])],
                     "missing": (inv or {}).get("missing_evidence", []),
                     "environment": [{"title": r["title"], "summary": r["summary"], "timestamp": r.get("timestamp")} for r in refs if r["kind"] == "environment_record"],
                     "sensor_health": [{"title": r["title"], "summary": r["summary"]} for r in refs if r["kind"] == "sensor_health"],
                     "records": [{"title": r["title"], "kind": r["kind"], "summary": r["summary"]} for r in refs
                                 if r["kind"] in ("maintenance_record", "inspection_note", "prior_event")]},
        "triage": ({"priority": tri["priority"], "label": tri["priority_label"], "timeframe": tri["timeframe"], "score": tri["demonstration_triage_score"],
                    "factors": tri["factors"], "contributing": tri["contributing_findings"], "uncertainty": tri["uncertainty"],
                    "first_action": tri["recommended_first_action"], "escalation_required": tri["escalation_required"],
                    "escalation_basis": tri["escalation_basis"]} if tri else None),
        "stages": [{"agent": label, "stage": stage, "status": (runs.get(key) or {}).get("status"), "duration_ms": (runs.get(key) or {}).get("duration_ms")}
                   for key, label, stage in STAGES],
        "decisions": decisions,
        "plan": {"recommended": recommended, "current": plan_now, "approved": plan_now if approved else None, "edited": wo.revision > 1,
                 "revision": wo.revision, "approved_by": wo.approved_by, "approved_at": wo.approved_at, "edited_by": wo.edited_by,
                 "edited_at": wo.edited_at},
        "completion": wo.completion.model_dump() if wo.completion else None,
        "review": wo.review.model_dump() if wo.review else None,
    }


# ----------------------------------------------------------------------------------------------- HTML
def _e(v: Any) -> str:
    return escape("" if v is None else str(v))


def _num(v: Any, d: int = 4) -> str:
    return UNAVAILABLE if v is None else (f"{v:.{d}f}".rstrip("0").rstrip(".") if isinstance(v, float) else str(v))


def _ts(v: Optional[str]) -> str:
    return "—" if not v else v.replace("T", " ").replace("Z", " UTC")[:23]


def _spark(f: dict) -> str:
    vals = [v for v in f["trend"] if v is not None]
    if len(vals) < 2:
        return "<span class='muted'>no trend data</span>"
    w, h = 220, 44
    lo, hi = min(vals + [f["baseline_median"]]), max(vals + [f["baseline_median"]])
    pad = (hi - lo) * 0.1 or 1e-6
    lo, hi = lo - pad, hi + pad
    n = len(f["trend"])
    x = lambda i: i / (n - 1) * w
    y = lambda v: h - (v - lo) / (hi - lo) * h
    d = ""
    for i, v in enumerate(f["trend"]):
        if v is None:
            continue
        d += ("L" if i and f["trend"][i - 1] is not None else "M") + f"{x(i):.1f},{y(v):.1f}"
    k = f["persistence_count"]
    shade = f"<rect x='{x(n - k):.1f}' y='0' width='{w - x(n - k):.1f}' height='{h}' fill='#f59e0b' opacity='.15'/>" if k else ""
    return (f"<svg width='{w}' height='{h}' viewBox='0 0 {w} {h}' role='img' aria-label='Last {n} windows of {_e(f['sensor_id'])}'>{shade}"
            f"<line x1='0' x2='{w}' y1='{y(f['baseline_median']):.1f}' y2='{y(f['baseline_median']):.1f}' stroke='#64748b' stroke-dasharray='3 3'/>"
            f"<path d='{d}' fill='none' stroke='#2563eb' stroke-width='1.5'/></svg>")


def _table(head: list[str], rows: list[list[str]], cls: str = "") -> str:
    if not rows:
        return f"<p class='muted'>{UNAVAILABLE}.</p>"
    th = "".join(f"<th>{_e(h)}</th>" for h in head)
    tr = "".join("<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>" for r in rows)
    return f"<table class='{cls}'><thead><tr>{th}</tr></thead><tbody>{tr}</tbody></table>"


def _list(items: list[str]) -> str:
    return "<ul>" + "".join(f"<li>{_e(i)}</li>" for i in items) + "</ul>" if items else f"<p class='muted'>{UNAVAILABLE}.</p>"


def _kv(rows: list[tuple[str, str]]) -> str:
    return "<table class='kv'><tbody>" + "".join(f"<tr><th>{_e(k)}</th><td>{v}</td></tr>" for k, v in rows) + "</tbody></table>"


def render_html(snap: dict, version: int, total_versions: int, versions: list[dict]) -> str:
    m, inc, ev, tri, plan = snap["meta"], snap["incident"], snap["evidence"], snap["triage"], snap["plan"]
    a, det = snap["assignment"], inc["detection"]
    findings = inc["findings"]
    prim = [f for f in findings if f["role"] == "primary"]
    corr = [f for f in findings if f["role"] == "corroborating"]
    ctx = [f for f in findings if f["role"] == "context"]
    status = m["status"]
    approved = plan["approved"] is not None
    banner = (f"<div class='banner ok'><b>ENGINEER-APPROVED INSTRUCTIONS</b> — approved by {_e(plan['approved_by'])} at {_ts(plan['approved_at'])}"
              f"{' (edited from the system recommendation, revision ' + str(plan['revision']) + ')' if plan['edited'] else ' (no changes to the system recommendation)'}.</div>"
              if approved else
              ("<div class='banner bad'><b>REJECTED</b> — this recommendation was rejected by the engineer and is not authorised work.</div>" if status == "rejected" else
               "<div class='banner warn'><b>UNAPPROVED SYSTEM RECOMMENDATION</b> — generated by the Response Planner"
               + (f" and edited by {_e(plan['edited_by'])} (revision {plan['revision']})" if plan["edited"] else "") + ". This is NOT authorised work until an engineer approves it.</div>"))

    def find_row(f: dict) -> list[str]:
        dev = _num(f["deviation"]) + (f" ({f['deviation_pct']:+.1f}%)" if f["deviation_pct"] is not None else "")
        return [f"<b>{_e(f['sensor_id'])}</b><br><span class='muted'>{_e(f['component_name'] or f['location'])}</span>", _e(f["feature_label"]),
                f"{_num(f['value'])} {_e(f['unit'])}", f"{_num(f['baseline_median'])} {_e(f['unit'])}", dev, f"{f['z']:+.1f}",
                f"{f['persistence_count']} of {f['persistence_window']}", _ts(f["onset_time"]), _spark(f)]
    fhead = ["Sensor / component", "Quantity", "Observed", "Baseline (median)", "Deviation", "Robust z", "Windows exceeding", "Since", "Trend (48 windows)"]

    def ftable(fs: list[dict]) -> str:
        return _table(fhead, [find_row(f) for f in fs])

    fe_rows = []
    for fe in ev["finding_evidence"]:
        fe_rows.append([f"<b>{_e(fe['sensor_id'])}</b>", "<ul>" + "".join(f"<li>{_e(c['text'])}</li>" for c in fe["supports"]) + "</ul>" or "—",
                        "<ul>" + "".join(f"<li>{_e(c['text'])}</li>" for c in fe["contradicts"]) + "</ul>" or "—"])
    hyp_rows = [[str(h["rank"]), f"<b>{_e(h['title'])}</b><br><span class='muted'>support: {_e(h['support'])}</span>", _list(h["for"]), _list(h["against"])] for h in ev["hypotheses"]]
    stage_rows = [[_e(s["agent"]), _e(s["stage"]), _e(s["status"] or "not recorded"), (f"{s['duration_ms']:.0f} ms" if s["duration_ms"] is not None else "—")] for s in snap["stages"]]
    dec_rows = [[_ts(d["ts"]), _e(d["actor"]), _e(d["role"] or "—"), _e(d["action"].replace("_", " ")), _e(d["summary"])] for d in snap["decisions"]]
    cur = plan["approved"] or plan["current"]          # the engineer's current wording (edited or not); the system recommendation is shown for comparison
    steps = cur["steps"]
    step_rows = [[str(s["order"]), _e(s["action"]), _e(s["rationale"])] for s in steps]
    diff = ""
    if plan["edited"]:
        rec_steps = plan["recommended"]["steps"]
        diff = (f"<h4>System recommendation compared with the {'approved' if approved else 'engineer-edited (not yet approved)'} version</h4>" +
                _table(["#", "System recommendation", "Approved instruction" if approved else "Engineer's edited instruction"],
                       [[str(i + 1), _e(rec_steps[i]["action"]) if i < len(rec_steps) else "—", _e(steps[i]["action"]) if i < len(steps) else "— (removed)"]
                        for i in range(max(len(rec_steps), len(steps)))]))
    ver_rows = [[f"v{v['version']}", _e(KIND_LABEL.get(v["kind"], v["kind"])), _ts(v["created_at"]), _e(v["created_by"]), _e(STATUS_LABEL.get(v["wo_status"], v["wo_status"]))] for v in versions]
    comp = snap["completion"]

    nonind = ("<p class='note'>Strain, tilt and wind sensors are <b>context</b> sensors in this configuration: they cannot raise an alert on their own and are not "
              "independent detection sources. They are reported only as supporting context.</p>" if ctx or any(not f["can_raise_alerts"] for f in findings) else "")
    css = """
    @page { size: A4; margin: 16mm 14mm 18mm; @bottom-center { content: "InfraGuard · simulated-data demonstration · Page " counter(page) " of " counter(pages); font: 8pt sans-serif; color:#64748b; } }
    * { box-sizing: border-box; } body { font: 10pt/1.45 'Segoe UI', Arial, sans-serif; color:#0f172a; margin:0; background:#eef1f6; }
    .page { max-width: 210mm; margin: 0 auto; background:#fff; padding: 14mm; }
    header.brand { display:flex; justify-content:space-between; align-items:flex-end; border-bottom:3px solid #1d4ed8; padding-bottom:8px; margin-bottom:10px; }
    .logo { font-size:20pt; font-weight:700; letter-spacing:-.5px; color:#1d4ed8; } .logo span{color:#0f172a}
    h1 { font-size:16pt; margin:0 0 2px; } h2 { font-size:12.5pt; margin:18px 0 6px; padding:4px 8px; background:#e8eefc; border-left:4px solid #1d4ed8; page-break-after:avoid; }
    h3 { font-size:10.5pt; margin:12px 0 4px; } h4 { font-size:10pt; margin:10px 0 4px; }
    table { width:100%; border-collapse:collapse; margin:4px 0 8px; font-size:8.8pt; } th,td { border:1px solid #cbd5e1; padding:4px 6px; text-align:left; vertical-align:top; }
    thead th { background:#f1f5f9; } table.kv th { width:30%; background:#f8fafc; } tr { page-break-inside:avoid; } ul { margin:2px 0; padding-left:16px; }
    .muted { color:#64748b; } .banner { padding:7px 10px; border-radius:4px; margin:8px 0; font-size:9.5pt; border:1px solid; }
    .banner.ok { background:#ecfdf5; border-color:#10b981; } .banner.warn { background:#fffbeb; border-color:#f59e0b; } .banner.bad { background:#fef2f2; border-color:#ef4444; }
    .note { background:#f8fafc; border:1px solid #e2e8f0; padding:6px 8px; font-size:9pt; } .tag { display:inline-block; padding:1px 7px; border-radius:99px; font-size:8pt; border:1px solid #94a3b8; }
    .toolbar { max-width:210mm; margin:10px auto; display:flex; gap:8px; justify-content:flex-end; } .toolbar button { padding:7px 14px; border:1px solid #1d4ed8; background:#1d4ed8; color:#fff; border-radius:6px; cursor:pointer; font:600 10pt sans-serif; }
    @media print { body { background:#fff; } .page { padding:0; max-width:none; } .toolbar { display:none; } }
    """
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>{_e(m['work_order_id'])} report v{version} — InfraGuard</title>
<meta name="viewport" content="width=device-width, initial-scale=1"><style>{css}</style></head><body>
<div class="toolbar"><button onclick="window.print()">Print / Save as PDF</button></div>
<div class="page">
<header class="brand"><div><div class="logo">Infra<span>Guard</span></div><div class="muted">AI structural-health early warning · simulated-data demonstration</div></div>
<div style="text-align:right"><h1>Work Order Report</h1><div class="muted">Prepared by the Response Planner agent · reviewed by an engineer</div></div></header>

<h2>A. Report header</h2>
{_kv([("Work order", f"<b>{_e(m['work_order_id'])}</b>"), ("Incident", _e(m['incident_id'])), ("Asset", f"{_e(m['asset_name'])} ({_e(m['asset_id'])})"),
      ("Report version", f"v{version} of {total_versions} — {_e(KIND_LABEL.get(m['kind'], m['kind']))}"), ("Generated", f"{_ts(m['generated_at'])} by {_e(m['generated_by'])}"),
      ("Work order status at generation", f"<span class='tag'>{_e(STATUS_LABEL.get(status, status))}</span>"),
      ("Maintenance team", _e(a['team']) if a else "Not yet assigned"), ("Responsible officer", _e(a['person']) if a else "Not yet assigned"),
      ("Priority / time-frame", f"{_e(snap['priority'])} · {_e(snap['timeframe'])}"), ("Due date", _e(a['due_date']) if a else "Not yet set")])}
{banner}

<h2>B. Incident summary</h2>
<p><b>What was detected.</b> A persistent deviation from each sensor's own baseline, first observed {_ts(inc['onset_time'])} and flagged by the Sentinel at {_ts(inc['detected_time'])}.
{len(prim) + len(corr)} sensor finding(s) contribute{'' if len(prim) + len(corr) != 1 else 's'} to the incident ({len(prim)} primary, {len(corr)} corroborating){f', plus {len(ctx)} context observation(s)' if ctx else ''}.</p>
{_kv([("Contributing sensors", ", ".join(_e(f['sensor_id']) + f" ({f['role']})" for f in findings) or UNAVAILABLE), ("First observed", _ts(inc['onset_time'])),
      ("Current investigation status", _e(inc['state_text'])), ("Escalation criterion", "Owner-supplied criterion exceeded" if inc['escalation'] else "Not triggered")])}
<p><b>Why it requires attention.</b> {_e(tri['first_action']) if tri else UNAVAILABLE} The deviation persisted across consecutive analysis windows and passed the data-quality gate,
so it is treated as a real change in the measured response and not as a one-off spike. This is decision support: it does not establish the cause, and it is not a statement about structural safety.</p>

<h2>C. Sensor readings and technical evidence</h2>
<p class="muted">Detection rule: robust z-score against each sensor's own baseline (version {_e(inc['baseline_version'])}); threshold |z| ≥ {det['z_threshold']}; an event needs at least
{det['min_exceedances']} exceeding windows out of {det['persistence_windows']} ({det['window_minutes']}-minute windows). All readings are simulated.</p>
<h3>Primary finding(s)</h3>{ftable(prim)}
<h3>Corroborating observation(s)</h3>{ftable(corr) if corr else f"<p class='muted'>None.</p>"}
<h3>Context observation(s) — not independent detection sources</h3>{ftable(ctx) if ctx else f"<p class='muted'>None.</p>"}{nonind}
<h3>Supporting and contradicting observations (per finding)</h3>{_table(["Sensor", "Supports", "Contradicts / limits"], fe_rows)}
<h3>Environmental factors</h3>{_table(["Record", "Summary"], [[_e(r['title']), _e(r['summary'])] for r in ev['environment']])}
<h3>Sensor-quality limitations</h3>{_kv([("Data-quality gate", "Passed" if inc['data_quality'].get('passed') else "Not passed / not recorded"),
                                       ("Issues", ", ".join(_e(i) for i in inc['data_quality'].get('issues', [])) or "None recorded")])}
{_table(["Record", "Summary"], [[_e(r['title']), _e(r['summary'])] for r in ev['sensor_health']]) if ev['sensor_health'] else ""}
<h3>Unresolved uncertainties and missing evidence</h3>{_list(ev['missing'] + (tri['uncertainty'] if tri else []))}

<h2>D. Investigation and decision summary</h2>
{_table(["Agent", "Stage", "Run status", "Duration"], stage_rows)}
<h3>Hypotheses produced by the Investigator (hypotheses, not findings)</h3>{_table(["Rank", "Hypothesis", "Supporting", "Contradicting"], hyp_rows)}
<h3>Rationale for the assigned priority</h3>
{(_kv([("Priority", f"<b>{_e(tri['priority'])}</b> — {_e(tri['label'])}"), ("Recommended response time-frame", _e(tri['timeframe'])),
       ("Demonstration triage score", f"{tri['score']} (a rule-based score, not a probability of failure)")]) + _table(["Factor", "Observed", "Points"], [[_e(f['name']), _e(f['observed']), f"{f['points']:+d}"] for f in tri['factors']])) if tri else f"<p class='muted'>{UNAVAILABLE}.</p>"}
<h3>Human decisions</h3>{_table(["Time", "Actor", "Role", "Action", "Detail"], dec_rows)}

<h2>E. Work instructions</h2>
{banner}
<p><b>Reason for the work.</b> {_e(cur['reason'])}</p>
<h3>{'Approved tasks for the officer' if approved else 'Recommended tasks (not yet authorised)'}</h3>{_table(["#", "Task", "Why"], step_rows)}
{diff}
<h3>Components and sensor locations</h3>{_table(["Sensor", "Component / location"], [[_e(f['sensor_id']), _e(f['component_name'] or f['location'])] for f in findings])}
<h3>Precautions</h3>{_list(cur['precautions']) if cur['precautions'] else "<p class='muted'>None defined by the engineer for this work order.</p>"}
<h3>Expected completion evidence</h3>{_list(cur['required_evidence'])}
<h3>Acceptance criteria / expected outcome</h3>{_list(cur['acceptance_criteria']) if cur['acceptance_criteria'] else "<p class='muted'>None defined by the engineer for this work order. The engineer judges the submitted evidence against the tasks above.</p>"}
<h3>Assignment and escalation</h3>{_kv([("Team", _e(a['team']) if a else "Not yet assigned"), ("Responsible officer", _e(a['person']) if a else "Not yet assigned"),
   ("Due date", _e(a['due_date']) if a else "Not yet set"), ("Assigned by", f"{_e(a['assigned_by'])} at {_ts(a['assigned_at'])}" if a else "—"),
   ("Escalation", "If the due date passes without evidence being approved, the order is flagged overdue and an escalation event is recorded for the asset owner (simulated — no message is sent).")])}

<h2>F. Completion and approval requirements</h2>
<h3>What the officer must record</h3>{_list(["A written completion note describing the work actually performed, any deviations from the tasks above, and any issues or delays.",
   "The date and who performed the work (recorded automatically from the submission)."])}
<h3>Attachments to submit</h3>{_list(["The inspection and/or maintenance report(s) as PDF (images and plain-text notes are also accepted).",
   "Any other document the instructions above list as expected completion evidence. If no document applies, state why in the submission."])}
<h3>What the engineer reviews before approving the evidence</h3>{_list(["The completion note against the approved tasks and the expected completion evidence.", "Every submitted attachment (open each file).",
   "The acceptance criteria, where defined, and the work-order history."])}
<h3>If the evidence is insufficient</h3><p>The engineer selects <b>Request Further Work</b> and states what is missing. The order returns to Work Execution, the officer sees the reason, and a new evidence version must be submitted. Nothing is marked complete until an engineer selects <b>Approve Evidence</b>.</p>
{('<h3>Submitted evidence (version ' + str(comp['version']) + ')</h3>' + _kv([("Submitted by", f"{_e(comp['submitted_by'])} at {_ts(comp['submitted_at'])}"), ("Completion note", _e(comp['note'])),
   ("Attachments", ", ".join(_e(x['filename']) for x in comp['attachments']) or _e(comp.get('no_attachment_reason') or 'None'))])) if comp else ''}

<h2>Report versions</h2>{_table(["Version", "Type", "Generated", "By", "Work order status then"], ver_rows)}
<p class="muted" style="font-size:8pt">Simulated-data demonstration. This report supports human decisions; it is not a structural-safety certification, and an approved work order does not by itself establish that the structure is safe.</p>
</div></body></html>"""
