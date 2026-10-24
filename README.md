# InfraGuard — AI structural-health early warning (SIMULATED-DATA edition)

AgentOps hackathon · MIT Bengaluru · track: multi-agent systems · team **AKinators**

InfraGuard shortens the gap between "something looks off" and "a qualified human has looked at it", and keeps a
record of every step. Five coordinated agents turn a structural anomaly into a human-approved preventive action, and
a separate Work Orders process makes someone accountable for it and verifies the result.

> **All data is simulated and labelled so in the UI. This is decision support, not a certified structural-safety
> system.** It never says a structure is "safe", never gives a collapse time or probability, and never orders a
> closure or evacuation. Consequential actions need an explicit human decision.

## Run it (fully offline)

Requirements: Python 3.11+, Node 20+.

```bash
python -m venv .venv
.venv/Scripts/python -m pip install fastapi "uvicorn[standard]" pandas numpy pydantic pytest httpx anthropic   # Windows
cd frontend && npm install && cd ..

# terminal 1 — API on :8000 (SQLite at backend/data/infraguard.db)
.venv/Scripts/python -m uvicorn backend.api.main:app --port 8000
# terminal 2 — UI on :3000 (proxies /api to :8000)
cd frontend && npm run dev
```

Open http://localhost:3000. Backend tests: `.venv/Scripts/python -m pytest tests -q` (70 tests).
End-to-end UI journey (needs both servers + Chrome; 119 checks): `cd frontend && node scripts/e2e-check.mjs ../docs/screenshots`.
After restarting the backend, `node scripts/e2e-persist.mjs` re-checks that the completed journey (stage, evidence PDF, reports, audit trail) survived.
Uploads: `INFRAGUARD_MAX_UPLOAD_MB` (default 5) sets the evidence file-size limit.

Agent execution mode: by default the agents run **one stage at a time** ("Next Step"). Set
`INFRAGUARD_AGENT_MODE=auto` to run them back to back as before.

Optional LLM drafting (off by default; the demo needs no network): `INFRAGUARD_LLM=on ANTHROPIC_API_KEY=… `
(model `claude-opus-5-5`, override with `INFRAGUARD_LLM_MODEL`). The LLM only drafts wording on a strict JSON
schema; output is rejected and replaced by the deterministic fallback on timeout, malformed JSON, unknown
citations or banned language (one retry first).

## 5-minute demo script

Click **Guided demo** in the top bar, or follow this. Keyboard: `Space` play/pause, `R` reset, `1`–`4` pages, `Ctrl/Cmd+K` palette.

1. **Overview** — Bridge Alpha only (simulated). Press play or **Run to next event**.
2. **Detect** — at 05 Mar 08:15 a heavy truck spikes peak acceleration for one window: logged as a *transient, no alert*. From 16:00 the dominant frequency drops and stays down: the Sentinel opens **one incident with four findings** (ACC-M1 primary, ACC-Q1 and ACC-P2 corroborating, STR-G1 context). Open the 3D workspace and click a flagged sensor: its mapped component turns red and the panel names it.
3. **Investigate** — **Open this finding**. Four stages, one at a time (*Step n of 4*, **Previous Step / Next Step**): Sentinel - Detection, Investigator - Evidence, Risk Prioritiser - Assessment, Response Planner - Preventive action.
4. **Approve** — at stage 4 **Approve** or **Reject** the proposed action. Nothing becomes a live work order without a human decision.
5. **Engineer review (Stage 1)** — Work Orders, then the order. Read the generated Resource Planner report, edit the tasks / precautions / acceptance criteria, **Save edits** (new report version), then **Approve Work Order** (or **Reject** with a reason).
6. **Assign (Stage 2)** — pick a maintenance team, responsible officer and due date. Switch the demo user (top bar) to that officer.
7. **Officer (Stages 3-5)** — read the report and **Accept Assignment** (or **Decline** with a reason, which returns it to the engineer). Record progress, then **Proceed to evidence submission**: write the completion note, **Attach File** (PDF report), review, **Finalise and submit**.
8. **Engineer approves the evidence (Stage 6)** — open the PDF, then **Approve Evidence** or **Request Further Work** (reason; back to Stage 4). Approval completes the job and the investigation (Stage 7).
9. **Return to 3D Bridge Model** — a clearly labelled *simulated post-completion state*: normal readings, no active flags. The original incident stays in Investigations.
10. **Audit Trail** (sidebar) — the chain of custody: who did what, when, state before/after, report and evidence references, with filters.

## Architecture

```
backend/
  scenarios/   seeded generator (bridge FFT features, building tilt+temperature, wall), assets config, fixtures, DataSource
  baseline/    robust median/MAD baselines, zero-MAD fallback, temperature model, versioned + hashed
  detector/    data-quality checks (missing/stale/frozen/implausible), robust-z + persistence detector, change-point
  agents/      sentinel · investigator · prioritiser · planner · verifier  (validated pydantic in/out)
  orchestrator/ pipeline (pure), engine (live replay + state machine), whatif, replay
  db/          SQLite schema; audit_events and approvals are append-only (triggers)
  llm/         the single LLM module: timeout, schema validation, one retry, deterministic fallback
  api/         FastAPI;  evaluation.py  detection metrics
frontend/      Next.js 16 + Tailwind 4 + Recharts + Framer Motion
tests/         70 tests
```

Deterministic code owns detection, quality checks, hypothesis scoring, triage, access control and workflow
transitions. Detection: `z = (x − median)/(1.4826·MAD)` per window feature against the asset's *own* baseline; an
event needs ≥k of N exceeding windows (per asset) with all N passing the quality gate. Baselines store a version,
hash, status (provisional/validated/insufficient data) and whether the reference period was reviewed — a learned
baseline is not a safe-state baseline.

Investigation workflow: `DETECTED → INVESTIGATING → PRIORITISING → PLANNING → AWAITING_APPROVAL → APPROVED | REJECTED`, then
`CLOSED_BY_HUMAN` ("investigation completed") when an engineer approves the work-order evidence.
Work-order stages (persisted `status`, enforced by the backend): 1 `proposed` (engineer review) → 2 `approved` (assignment) → 3 `assigned`
(officer acceptance; decline returns to 2) → 4 `accepted` / `in_progress` / `returned` (work execution) → 5 `submitting_evidence` →
6 `awaiting_verification` (engineer evidence approval; *Request Further Work* returns to 4) → 7 `verified` (job completed). Roles:
`engineer` / `asset_owner` edit, approve, assign and review; only the assigned `maintenance` officer accepts, declines, records progress and
submits evidence; `viewer` can do none; the reviewer can never be the person who did or submitted the work. Every transition is validated in
`backend/orchestrator/accountability.py` and recorded only after it succeeds. The Verifier agent and follow-up readings still exist in the
backend (`/follow-up`, `/close`) but are not part of this workflow.

## Signature features

* **Four pages**: **Overview** (active alerts, open investigations, pending work orders, next action), **Infrastructure**
  (monitored assets — currently only Bridge Alpha), **Investigations** and **Work Orders**. Only assets in
  `ACTIVE_ASSET_IDS` (`backend/scenarios/assets.py`) are monitored or shown; the building and retaining wall stay defined
  (config, generators, tests) but inactive, and `Engine(active_assets=[...])` enables them without UI changes.
* **Bridge Alpha workspace** (`/assets/BRG-017`): a full-page interactive 3D cable-stayed bridge (Three.js + React Three
  Fiber): orbit, zoom, rotate/pan mode, reset. 9 clickable sensors on deck, pylon, cable, girder and a pier. A sensor card
  shows value, baseline, z-score, trend, data quality, condition and evidence, with buttons to the evidence-backed
  investigation and the work order. Marker state is computed **by the backend** (`GET /api/assets/BRG-017/sensors`);
  strain/tilt/wind are context sensors that support but cannot trigger an alert. If WebGL is unavailable it falls back to a
  2D schematic. `/assets/BRG-017/telemetry` keeps the chart/baseline detail.
* **Findings, not guesses**: an incident holds one *finding* per contributing sensor (value, baseline, robust z,
  deviation, onset, trend, reason, mapped component). Every flagged bridge marker maps to a real finding of an open incident
  or is explicitly labelled a transient observation / continuation of a closed incident; related sensors are grouped in
  one incident (each still inspectable), all findings feed the risk assessment, and a continuing deviation after closure
  never opens a duplicate incident or work order.
* **Four-stage investigation** (Investigation page): *Step n of 4* with **Previous Step / Next Step**. Each stage shows only
  its agent's job: Detection (readings vs baseline, z, trend, why flagged), Evidence (per-finding supports / contradicts,
  data quality, competing hypotheses, missing evidence, records), Assessment (priority, contributing findings, rule factors,
  persistence, uncertainty), Preventive action (recommended action, why, proposed work order, Approve / Reject). Observed,
  calculated and recommended items are labelled; there are no invented confidence scores. **Next Step** runs the next agent
  via `POST /api/incidents/{id}/advance` (guarded by `expected_state`); progress text appears only while the real request is
  pending and a failure shows the error with **Retry** (a failed stage writes nothing). Completed stages are kept when you
  navigate away or step back.
* **Work Orders, stage by stage** (`/work-orders/<id>`): one current stage is shown at a time with a completed / current / upcoming indicator;
  earlier stages stay readable. Stage 1 engineer review (investigation summary, findings, the generated report, editable instructions,
  Approve / Reject with a required reason), 2 assignment, 3 officer acceptance (Accept / Decline with a reason), 4 work execution (progress,
  delays, completion-note draft), 5 evidence submission (completion note + **Attach File**: PDF reports, PNG/JPEG photos or text; type, size
  and content are validated on client **and** server; replace / remove before submitting; review step; duplicates refused), 6 engineer evidence
  approval (**Approve Evidence** or **Request Further Work**), 7 job completed (links to the final report, evidence and audit trail, and
  **Return to 3D Bridge Model**). Evidence files are stored under `backend/data/evidence/<work order>/` with SHA-256 and a database record
  (`work_order_attachments`); resubmission after further work creates evidence version 2 and keeps version 1.
* **Resource Planner report** (`GET /api/work-orders/<id>/report[?version=n]`): print-ready HTML with InfraGuard branding, sections A-F (header,
  incident summary, sensor readings and technical evidence, investigation and decisions, work instructions, completion requirements), tables,
  inline trend charts from the stored findings, and page numbers; **Download / Print PDF** uses the browser's Save-as-PDF because the project has
  no PDF library. Each version is an immutable snapshot of real application data (`work_order_reports`): draft, each engineer edit, approval,
  assignment and completion. Unapproved work is labelled "UNAPPROVED SYSTEM RECOMMENDATION"; approved work shows the engineer's wording and a
  comparison with the system recommendation. Missing information is shown as "Not available", never invented.
* **Audit Trail / chain of custody** (`/audit`, `GET /api/audit`): a dedicated sidebar page with filters (work order, incident, actor, action,
  dates), newest/oldest-first toggle, expandable details (event ID, state before/after, reason, report version and evidence-file references; file
  metadata only), and links to the work order, incident, report and evidence. Events come from the backend state changes (append-only
  `work_order_events`, mirrored into `audit_events`), survive refresh and restart, and failed actions are not recorded. It is an application-level
  record, not a tamper-proof ledger.
* **Post-completion 3D state**: when the engineer approves the evidence the incident is completed and the bridge's designated post-completion scenario (the
  existing deterministic "improves" reading set, SIMULATED) is persisted (`incident_resolutions`). The 3D model then shows normal sensor states, no
  incident flags or red highlights, and a banner: *Post-completion — simulated state; not physical measurements; not a safety claim*.
  The original incident, findings and audit history remain available.
* **3D bridge**: more realistic geometry (railings, road markings, lamp posts, embankments with approach road, shore, river)
  with real-time shadows. Selecting a finding highlights its **actual mapped component** in red (deck section, girder,
  stay cable, tower, tower top, pier); a normal sensor gets a neutral blue location highlight; no mapping gives "Component
  mapping unavailable" and nothing is highlighted. The highlight shows location, never proof of damage. Deselecting restores
  the model. A legend explains marker states and highlights.
* **Sandbox impact preview** (Simulation strip of the bridge workspace; API `POST /api/whatif`): frozen/stale sensor, scenario variant, bounded environment preset (±8 °C), predefined
  follow-up sets. Each runs the real pipeline in a sandbox, diffs only affected fields, explains no-change results
  from the actual rules, shows seed/intervention/timestamp, and can be replayed for a reproducibility digest.
  Sandbox proposals are never approvable and never touch live incidents.
* **Decision Replay** (`/incidents/<id>/replay`): regenerates inputs from recorded seed/config, re-derives the
  baseline, re-runs all agents, diffs against recorded outputs, compares recorded vs current software/rule
  versions, flags a *reproducibility discrepancy* instead of hiding it, and verifies no history rows changed.
  Human approvals are replayed as recorded inputs, never re-executed.

## Detection metrics (simulated scenarios only)

`GET /api/metrics` (no longer a UI page) runs the detector live over every labelled variant of all defined assets, including the inactive building and wall, for 10 seeds (+ heatwave): **0 false alerts, 0
missed events, 0 benign-spike alerts**; bridge detection delay 2 windows (30 min, within the 3-window target);
building drift median delay 6 hourly windows (**misses the 3-window target** — drift must exceed noise and then
persist 4 windows). *These results do not show real-world generalisation.*

## Honest limitations / known issues

* Everything is simulated; the generators were written alongside the detector, so metrics are optimistic by construction.
* LLM drafting path is implemented and unit-tested with injected transports; it was **not** exercised against the live API in this build (offline).
* Hypothesis ranking uses documented additive rules, not a statistical model; support labels are heuristic.
* Follow-up sets (backend / what-if only) are three predefined generators, not user-uploaded data.
* A work-order *proposal* row exists from the Planner stage but is shown and treated as "pending approval"; it becomes a live order only on human approval. Overdue is evaluated on the simulated clock, not wall time.
* The report is HTML printed to PDF by the browser (page numbers need a recent Chrome/Edge); no server-side PDF generator is bundled. Acceptance criteria and precautions appear only if the engineer enters them.
* The post-completion 3D state is the simulated recovery scenario; it continues to show that state after later replay steps and is not derived from new measurements.
* Evidence upload is base64-in-JSON (default limit 5 MB, `INFRAGUARD_MAX_UPLOAD_MB`; pdf/png/jpeg/txt, checked by content signature), stored on local disk; no virus scanning or object storage.
* Component highlighting uses a fixed sensor-to-component map of the simulated bridge model; it is an explanatory model, not an engineering drawing.
* The event is the first persistent run per asset; a second distinct event on the same asset while one is open is folded into it.
* "Change-point" is a single mean-shift estimate; for the building it can precede detection by several windows.
* Auth is a demo-identity dropdown (fictional users and officers), not real authentication; the backend enforces role rules on every action. CORS is open for local use.
* Dev-server first-load compile is slow (Next dev); run `npm run build && npm start` for a snappier rehearsal.
* The Playwright script requires an installed Chrome (`channel: "chrome"`).
* Mobile phone layout is not tuned; desktop-first (1440 px), graceful at 1280 and 1024 px. The 3D view needs WebGL (software rendering works but is slow); otherwise the 2D fallback is shown.
* The bridge now has 9 simulated sensors (5 added: tower tilt, pier tilt, girder strain, cable strain, wind). The 2D SVG schematic remains only as the no-WebGL fallback of the bridge workspace.
