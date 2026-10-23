"""SQLite persistence. audit_events and approvals are append-only (enforced by triggers)."""
from __future__ import annotations

import json
import os
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

DB_PATH = Path(os.environ.get("INFRAGUARD_DB", Path(__file__).resolve().parents[1] / "data" / "infraguard.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY, kind TEXT NOT NULL, label TEXT NOT NULL, config_json TEXT NOT NULL,
  versions_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sim_state (
  id INTEGER PRIMARY KEY CHECK (id = 1), run_id TEXT NOT NULL, cursor_time TEXT NOT NULL,
  running INTEGER NOT NULL, speed REAL NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS assets (asset_id TEXT PRIMARY KEY, type TEXT, name TEXT, config_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sensors (sensor_id TEXT PRIMARY KEY, asset_id TEXT NOT NULL REFERENCES assets(asset_id),
  kind TEXT, config_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS baseline_configs (
  version TEXT NOT NULL, asset_id TEXT NOT NULL REFERENCES assets(asset_id), run_id TEXT NOT NULL,
  status TEXT NOT NULL, reference_reviewed INTEGER NOT NULL, config_json TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY (version, run_id));
CREATE TABLE IF NOT EXISTS readings (
  run_id TEXT NOT NULL, asset_id TEXT NOT NULL, sensor_id TEXT NOT NULL, window_index INTEGER NOT NULL,
  t_start TEXT NOT NULL, t_end TEXT NOT NULL, phase TEXT NOT NULL, features_json TEXT NOT NULL,
  quality TEXT NOT NULL, quality_detail TEXT, incident_id TEXT, scenario_seed INTEGER NOT NULL,
  baseline_version TEXT, ingested_at TEXT NOT NULL,
  PRIMARY KEY (run_id, sensor_id, window_index));
CREATE TABLE IF NOT EXISTS incidents (
  incident_id TEXT PRIMARY KEY, asset_id TEXT NOT NULL REFERENCES assets(asset_id), run_id TEXT NOT NULL,
  event_id TEXT NOT NULL, state TEXT NOT NULL, status_text TEXT NOT NULL, escalation INTEGER NOT NULL DEFAULT 0,
  closed INTEGER NOT NULL DEFAULT 0, scenario_seed INTEGER NOT NULL, baseline_version TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, sim_time TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS anomaly_events (
  event_id TEXT PRIMARY KEY, incident_id TEXT NOT NULL, asset_id TEXT NOT NULL, run_id TEXT NOT NULL,
  scenario_seed INTEGER NOT NULL, baseline_version TEXT NOT NULL, detection_params_json TEXT NOT NULL,
  json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS investigations (
  incident_id TEXT PRIMARY KEY, asset_id TEXT NOT NULL, json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS evidence_refs (
  incident_id TEXT NOT NULL, ref_id TEXT NOT NULL, asset_id TEXT NOT NULL, kind TEXT NOT NULL,
  source_id TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (incident_id, ref_id));
CREATE TABLE IF NOT EXISTS triage_results (
  incident_id TEXT NOT NULL, seq INTEGER NOT NULL, asset_id TEXT NOT NULL, reason TEXT NOT NULL,
  window_index INTEGER, json TEXT NOT NULL, created_at TEXT NOT NULL, sim_time TEXT NOT NULL,
  PRIMARY KEY (incident_id, seq));
CREATE TABLE IF NOT EXISTS work_orders (
  work_order_id TEXT PRIMARY KEY, incident_id TEXT NOT NULL, asset_id TEXT NOT NULL, status TEXT NOT NULL,
  json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS approvals (
  approval_id TEXT PRIMARY KEY, incident_id TEXT NOT NULL, work_order_id TEXT NOT NULL, asset_id TEXT NOT NULL,
  decision TEXT NOT NULL, actor TEXT NOT NULL, role TEXT NOT NULL, json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS verification_results (
  verification_id TEXT PRIMARY KEY, incident_id TEXT NOT NULL, asset_id TEXT NOT NULL, outcome TEXT NOT NULL,
  json TEXT NOT NULL, created_at TEXT NOT NULL, sim_time TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS agent_runs (
  run_key TEXT PRIMARY KEY, incident_id TEXT, asset_id TEXT, agent TEXT NOT NULL, status TEXT NOT NULL,
  json TEXT NOT NULL, started_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS workflow_inputs (
  incident_id TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, sim_time TEXT, run_id TEXT, incident_id TEXT,
  asset_id TEXT, actor TEXT NOT NULL, actor_type TEXT NOT NULL, action TEXT NOT NULL, from_state TEXT,
  to_state TEXT, summary TEXT NOT NULL, detail_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS whatif_runs (
  whatif_id TEXT PRIMARY KEY, created_at TEXT NOT NULL, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS replay_runs (
  replay_id TEXT PRIMARY KEY, incident_id TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL,
  json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS work_order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, sim_time TEXT, work_order_id TEXT NOT NULL,
  incident_id TEXT NOT NULL, actor TEXT NOT NULL, actor_role TEXT, action TEXT NOT NULL, summary TEXT NOT NULL,
  detail_json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_wo_events ON work_order_events(work_order_id, id);
CREATE TRIGGER IF NOT EXISTS wo_events_no_update BEFORE UPDATE ON work_order_events
  BEGIN SELECT RAISE(ABORT, 'work_order_events is append-only'); END;
CREATE TRIGGER IF NOT EXISTS wo_events_no_delete BEFORE DELETE ON work_order_events
  BEGIN SELECT RAISE(ABORT, 'work_order_events is append-only'); END;
CREATE TABLE IF NOT EXISTS work_order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, sim_time TEXT, work_order_id TEXT NOT NULL,
  incident_id TEXT NOT NULL, actor TEXT NOT NULL, actor_role TEXT, action TEXT NOT NULL, summary TEXT NOT NULL,
  detail_json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_wo_events ON work_order_events(work_order_id, id);
CREATE TRIGGER IF NOT EXISTS wo_events_no_update BEFORE UPDATE ON work_order_events
  BEGIN SELECT RAISE(ABORT, 'work_order_events is append-only'); END;
CREATE TRIGGER IF NOT EXISTS wo_events_no_delete BEFORE DELETE ON work_order_events
  BEGIN SELECT RAISE(ABORT, 'work_order_events is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_events
  BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_events
  BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
CREATE TRIGGER IF NOT EXISTS approvals_no_update BEFORE UPDATE ON approvals
  BEGIN SELECT RAISE(ABORT, 'approvals are append-only'); END;
CREATE TRIGGER IF NOT EXISTS approvals_no_delete BEFORE DELETE ON approvals
  BEGIN SELECT RAISE(ABORT, 'approvals are append-only'); END;
CREATE INDEX IF NOT EXISTS ix_readings_asset ON readings(run_id, asset_id, window_index);
CREATE INDEX IF NOT EXISTS ix_audit_incident ON audit_events(incident_id);
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")[:-4] + "Z"


class Database:
    def __init__(self, path: Path | str = DB_PATH):
        self.path = str(path)
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL" if self.path != ":memory:" else "PRAGMA journal_mode=MEMORY")
        self.conn.execute("PRAGMA foreign_keys=ON")
        self.lock = threading.RLock()
        self.conn.executescript(SCHEMA)
        # at most one live (non-rejected) work order per incident: a second one for the same event is refused by the database
        try:
            self.conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_wo_one_live_per_incident ON work_orders(incident_id) "
                              "WHERE status != 'rejected'")
        except sqlite3.IntegrityError:
            pass  # legacy data from an earlier version already contains duplicates; the engine still checks in code
        # at most one live (non-rejected) work order per incident: a second one for the same event is refused by the database
        try:
            self.conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_wo_one_live_per_incident ON work_orders(incident_id) "
                              "WHERE status != 'rejected'")
        except sqlite3.IntegrityError:
            pass  # legacy data from an earlier version already contains duplicates; the engine still checks in code

    # -- generic helpers --------------------------------------------------------------
    def execute(self, sql: str, params: tuple | dict = ()) -> sqlite3.Cursor:
        with self.lock:
            return self.conn.execute(sql, params)

    def executemany(self, sql: str, rows: list[tuple]) -> None:
        with self.lock:
            self.conn.execute("BEGIN")
            try:
                self.conn.executemany(sql, rows)
                self.conn.execute("COMMIT")
            except Exception:
                self.conn.execute("ROLLBACK")
                raise

    def one(self, sql: str, params: tuple = ()) -> Optional[dict]:
        with self.lock:
            r = self.conn.execute(sql, params).fetchone()
        return dict(r) if r else None

    def all(self, sql: str, params: tuple = ()) -> list[dict]:
        with self.lock:
            return [dict(r) for r in self.conn.execute(sql, params).fetchall()]

    def next_id(self, name: str, prefix: str) -> str:
        with self.lock:
            self.conn.execute("INSERT INTO counters(name, value) VALUES (?, 0) ON CONFLICT(name) DO NOTHING", (name,))
            self.conn.execute("UPDATE counters SET value = value + 1 WHERE name = ?", (name,))
            v = self.conn.execute("SELECT value FROM counters WHERE name = ?", (name,)).fetchone()[0]
        return f"{prefix}-{v:04d}"

    # -- audit ------------------------------------------------------------------------
    def audit(self, *, action: str, summary: str, actor: str, actor_type: str, run_id: Optional[str] = None,
              incident_id: Optional[str] = None, asset_id: Optional[str] = None, sim_time: Optional[str] = None,
              from_state: Optional[str] = None, to_state: Optional[str] = None,
              detail: Optional[dict[str, Any]] = None) -> int:
        cur = self.execute(
            "INSERT INTO audit_events(ts, sim_time, run_id, incident_id, asset_id, actor, actor_type, action, "
            "from_state, to_state, summary, detail_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (now_iso(), sim_time, run_id, incident_id, asset_id, actor, actor_type, action, from_state, to_state,
             summary, json.dumps(detail or {}, default=str)))
        return cur.lastrowid


def dumps(obj: Any) -> str:
    if hasattr(obj, "model_dump_json"):
        return obj.model_dump_json()
    return json.dumps(obj, default=str)


def loads(s: Optional[str]) -> Any:
    return json.loads(s) if s else None
