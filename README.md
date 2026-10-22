# InfraGuard — AI structural-health early warning (SIMULATED-DATA edition)

AgentOps hackathon · MIT Bengaluru · track: multi-agent systems · team **AKinators**

InfraGuard shortens the gap between "something looks off" and "a qualified human has looked at it", and keeps a
record of every step. Five coordinated agents turn a structural anomaly into a human-approved, verified inspection.

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

Open http://localhost:3000. Tests: `.venv/Scripts/python -m pytest tests -q` (35 tests).
Screenshots for design review: `cd frontend && node scripts/screens.mjs ../docs/screenshots` (needs Chrome).

Optional LLM drafting (off by default; the demo needs no network): `INFRAGUARD_LLM=on ANTHROPIC_API_KEY=… `
(model `claude-opus-5-5`, override with `INFRAGUARD_LLM_MODEL`). The LLM only drafts wording on a strict JSON
schema; output is rejected and replaced by the deterministic fallback on timeout, malformed JSON, unknown
citations or banned language (one retry first).

## 5-minute demo script

Press **Guided demo** in the top bar (or follow below). Keyboard: `Space` play/pause, `R` reset, `1`–`9` screens, `Ctrl/Cmd+K` palette.

1. **Opening** — three assets, three different baselines/windows/thresholds (Command Centre, Simulation Controls).
2. **Act 1** — play the bridge replay. At 05 Mar 08:15 a heavy truck makes peak acceleration z ≈ +7 for one window: logged as a *transient, not alerted* (persistence rule 3 of 3).
3. **Act 2** — from 16:00 the dominant frequency drops and stays down → anomaly event; interval highlighted; statistics in **Why was this flagged?**
4. **Act 3** — Investigation Centre: pipeline stepper (click any agent for tool calls + structured JSON), three cited hypotheses, missing evidence.
5. **Act 4** — Inspection Planner: transparent triage-score table, proposed work order → **Approve** (engineer role).
6. **Act 5** — Verification: load *Logger outage* → **Cannot assess**, incident stays open; load *Persists*/*Improves*.
7. **What-If** — freeze `ACC-M1` from 05 Mar 12:00: sandbox re-run, honest before/after, reproducibility check. **Decision Replay** — read-only, REPRODUCED, empty diff.
8. Run on to 06 Mar: the building drift triggers the labelled *Demo criterion (not an engineering limit)* → "Escalation required".

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
tests/         35 tests
```

Deterministic code owns detection, quality checks, hypothesis scoring, triage, access control and workflow
transitions. Detection: `z = (x − median)/(1.4826·MAD)` per window feature against the asset's *own* baseline; an
event needs ≥k of N exceeding windows (per asset) with all N passing the quality gate. Baselines store a version,
hash, status (provisional/validated/insufficient data) and whether the reference period was reviewed — a learned
baseline is not a safe-state baseline.

Workflow: `DETECTED → INVESTIGATING → PRIORITISING → PLANNING → AWAITING_APPROVAL → APPROVED/REJECTED → VERIFYING →
MONITORING_PERSISTS | MONITORING_IMPROVED | CANNOT_ASSESS → (human) CLOSED`. Invalid transitions are rejected and
every valid one is audited with a timestamp. Roles: `viewer` cannot approve/reject/close.

## Signature features

* **Bridge schematic** (`/schematic`, also on the Command Centre): SVG, keyboard operable, text-alternative table,
  markers bound to real sensor IDs/state; shape + symbol + label as well as colour; labelled as an explanatory
  schematic, not an engineering drawing.
* **What-If Lab** (`/whatif`): frozen/stale sensor, scenario variant, bounded environment preset (±8 °C), predefined
  follow-up sets. Each runs the real pipeline in a sandbox, diffs only affected fields, explains no-change results
  from the actual rules, shows seed/intervention/timestamp, and can be replayed for a reproducibility digest.
  Sandbox proposals are never approvable and never touch live incidents.
* **Decision Replay** (`/incidents/<id>/replay`): regenerates inputs from recorded seed/config, re-derives the
  baseline, re-runs all agents, diffs against recorded outputs, compares recorded vs current software/rule
  versions, flags a *reproducibility discrepancy* instead of hiding it, and verifies no history rows changed.
  Human approvals are replayed as recorded inputs, never re-executed.

## Detection metrics (simulated scenarios only)

`/metrics` runs the detector live over every labelled variant for 10 seeds (+ heatwave): **0 false alerts, 0
missed events, 0 benign-spike alerts**; bridge detection delay 2 windows (30 min, within the 3-window target);
building drift median delay 6 hourly windows (**misses the 3-window target** — drift must exceed noise and then
persist 4 windows). *These results do not show real-world generalisation.*

## Honest limitations / known issues

* Everything is simulated; the generators were written alongside the detector, so metrics are optimistic by construction.
* LLM drafting path is implemented and unit-tested with injected transports; it was **not** exercised against the live API in this build (offline).
* Hypothesis ranking uses documented additive rules, not a statistical model; support labels are heuristic.
* Follow-up sets are three predefined generators, not user-uploaded data. Building follow-up "improves" is a synthetic return toward baseline.
* The event is the first persistent run per asset; a second distinct event on the same asset while one is open is folded into it.
* "Change-point" is a single mean-shift estimate; for the building it can precede detection by several windows.
* Auth is a role dropdown for the demo (simulated users), not real authentication. CORS is open for local use.
* Dev-server first-load compile is slow (Next dev); run `npm run build && npm start` for a snappier rehearsal.
* The Playwright script requires an installed Chrome (`channel: "chrome"`).
* Mobile phone layout is not tuned; desktop-first (1440 px), graceful at 1024 px.
