"""Stage-by-stage work-order accountability (engineer review -> assignment -> officer acceptance -> work execution ->
evidence submission -> engineer evidence approval -> job completed).

Every transition is validated here, on the backend, and written to the append-only event log only AFTER it has succeeded, so a
failed action can never appear in the audit trail as a successful one. Mixed into Engine (it uses the engine's database, clock and lock)."""
from __future__ import annotations

import base64
import hashlib
import re
from datetime import date, timedelta
from typing import Any, Optional

from backend.contracts import (
    Acceptance, AnomalyEvent, ApprovalRecord, ApprovalRequest, Assignment, Attachment, Completion, Decline, PlanStep, Review,
    WorkOrderDraft,
)
from backend.db.database import dumps, loads, now_iso
from backend.orchestrator import pipeline
from backend.orchestrator.wo_common import (
    ACTION_LABEL, APPROVER_ROLES, EVIDENCE_TYPES, EXECUTION_STATES, LIVE_WO, MAX_EVIDENCE_BYTES, MAX_FILES_PER_SUBMISSION, STAGE_LABEL,
    STAGE_OF, WORK_ROLES, AccessDenied, NotFound, WorkflowError,
)
from backend.reports import work_order_report as report
from backend.scenarios.assets import ASSETS, iso
from backend.scenarios.directory import valid_assignment

EDITABLE = ("steps", "reason", "timeframe", "required_evidence", "precautions", "acceptance_criteria")


def _clean_list(v: Any, name: str, limit: int = 20, maxlen: int = 600) -> list[str]:
    if not isinstance(v, list):
        raise WorkflowError(f"{name} must be a list")
    out = [str(x).strip() for x in v if str(x).strip()]
    if len(out) > limit or any(len(x) > maxlen for x in out):
        raise WorkflowError(f"{name}: at most {limit} items of {maxlen} characters")
    return out


def _magic_ok(ctype: str, data: bytes) -> bool:
    if ctype == "application/pdf":
        return data[:5] == b"%PDF-"
    if ctype == "image/png":
        return data[:8] == b"\x89PNG\r\n\x1a\n"
    if ctype == "image/jpeg":
        return data[:3] == b"\xff\xd8\xff"
    if ctype == "text/plain":
        try:
            data.decode("utf-8")
            return b"\x00" not in data
        except UnicodeDecodeError:
            return False
    return False


class AccountabilityMixin:
    # ------------------------------------------------------------------ reports (immutable versions)
    def _new_report(self, wo: WorkOrderDraft, kind: str, actor: str) -> int:
        row = self.db.one("SELECT MAX(version) v FROM work_order_reports WHERE work_order_id=?", (wo.work_order_id,))
        version = (row["v"] or 0) + 1
        prior = None
        if version > 1:
            first = self.db.one("SELECT snapshot_json FROM work_order_reports WHERE work_order_id=? AND version=1", (wo.work_order_id,))
            prior = loads(first["snapshot_json"]) if first else None
        snap = report.build_snapshot(self, wo, kind, actor, prior)
        rid = f"{wo.work_order_id}-R{version}"
        self.db.execute("INSERT INTO work_order_reports(report_id, work_order_id, incident_id, version, kind, created_at, created_by, sim_time, "
                        "wo_status, snapshot_json) VALUES (?,?,?,?,?,?,?,?,?,?)",
                        (rid, wo.work_order_id, wo.incident_id, version, kind, snap["meta"]["generated_at"], actor, iso(self.cursor), wo.status, dumps(snap)))
        return version

    def report_versions(self, wo_id: str) -> list[dict]:
        self._wo(wo_id)
        return [{"version": r["version"], "kind": r["kind"], "created_at": r["created_at"], "created_by": r["created_by"],
                 "wo_status": r["wo_status"], "report_id": r["report_id"]}
                for r in self.db.all("SELECT * FROM work_order_reports WHERE work_order_id=? ORDER BY version", (wo_id,))]

    def report_html(self, wo_id: str, version: Optional[int] = None) -> str:
        wo = self._wo(wo_id)
        with self.lock:
            if not self.report_versions(wo_id):
                self._new_report(wo, "regenerated", "System (regenerated from persisted records)")
            versions = self.report_versions(wo_id)
            v = version or versions[-1]["version"]
            row = self.db.one("SELECT snapshot_json FROM work_order_reports WHERE work_order_id=? AND version=?", (wo_id, v))
            if not row:
                raise NotFound(f"report version {v}")
            return report.render_html(loads(row["snapshot_json"]), v, len(versions), versions)

    # ------------------------------------------------------------------ stage 1: engineer review
    def _apply_edits(self, wo: WorkOrderDraft, edits: dict) -> tuple[dict, dict]:
        bad = set(edits) - set(EDITABLE)
        if bad:
            raise WorkflowError(f"Fields not editable: {sorted(bad)}")
        upd: dict[str, Any] = {}
        diff: dict[str, dict] = {}
        if "steps" in edits:
            raw = edits["steps"]
            if not isinstance(raw, list):
                raise WorkflowError("steps must be a list")
            steps: list[PlanStep] = []
            for i, item in enumerate(raw):
                action = str(item.get("action", "") if isinstance(item, dict) else item).strip()
                if not action:
                    continue
                if len(action) > 600:
                    raise WorkflowError("A task may be at most 600 characters")
                base = wo.steps[i] if i < len(wo.steps) else None
                rationale = (str(item.get("rationale")).strip() if isinstance(item, dict) and item.get("rationale") else (base.rationale if base else "Added by the engineer"))
                steps.append(PlanStep(order=len(steps) + 1, action=action, rationale=rationale, refs=list(base.refs) if base else []))
            if not steps:
                raise WorkflowError("At least one task is required")
            if len(steps) > 20:
                raise WorkflowError("At most 20 tasks")
            if [(s.action, s.rationale) for s in steps] != [(s.action, s.rationale) for s in wo.steps]:
                upd["steps"] = steps
                diff["steps"] = {"before": [s.action for s in wo.steps], "after": [s.action for s in steps]}
        for k in ("reason", "timeframe"):
            if k in edits:
                v = str(edits[k]).strip()
                if not v or len(v) > 1000:
                    raise WorkflowError(f"{k} must be 1-1000 characters")
                if v != getattr(wo, k):
                    upd[k] = v
                    diff[k] = {"before": getattr(wo, k), "after": v}
        for k in ("required_evidence", "precautions", "acceptance_criteria"):
            if k in edits:
                v = _clean_list(edits[k], k)
                if k == "required_evidence" and not v:
                    raise WorkflowError("At least one item of expected completion evidence is required")
                if v != list(getattr(wo, k)):
                    upd[k] = v
                    diff[k] = {"before": list(getattr(wo, k)), "after": v}
        return upd, diff

    def edit_work_order(self, wo_id: str, edits: dict, actor: str, role: str) -> dict:
        with self.lock:
            self._require_role(role, APPROVER_ROLES, "edit work instructions")
            wo = self._wo(wo_id)
            if wo.status != "proposed":
                raise WorkflowError(f"Instructions can be edited only while the work order awaits engineer review (status: {wo.status})")
            upd, diff = self._apply_edits(wo, edits)
            if not upd:
                raise WorkflowError("No changes were made to the instructions")
            wo = wo.model_copy(update={**upd, "revision": wo.revision + 1, "edited_by": actor, "edited_at": now_iso(),
                                       "label": "Edited by engineer — awaiting approval"})
            self._save_wo(wo)
            ver = self._new_report(wo, "edited", actor)
            self._wo_event(wo, "proposal_edited", actor, role, f"{actor} edited the proposed instructions ({', '.join(diff)}) — revision {wo.revision}",
                           {"changed": list(diff), "diff": diff}, before="proposed", after="proposed", refs={"report_version": ver})
            return self.work_order_view(wo_id)

    def decide(self, incident_id: str, req: ApprovalRequest) -> dict:
        with self.lock:
            self._require_role(req.role, APPROVER_ROLES, "approve or reject work orders")
            inc = self.db.one("SELECT * FROM incidents WHERE incident_id=?", (incident_id,))
            if not inc:
                raise NotFound(incident_id)
            if inc["state"] != "AWAITING_APPROVAL":
                raise WorkflowError(f"Incident is in state {inc['state']}; no proposal is awaiting review (duplicate approvals are not allowed)")
            wo_row = self.db.one("SELECT * FROM work_orders WHERE incident_id=? AND status='proposed' ORDER BY created_at DESC", (incident_id,))
            wo = WorkOrderDraft.model_validate(loads(wo_row["json"]))
            if req.decision == "reject" and len(req.note.strip()) < 3:
                raise WorkflowError("A reason is required to reject a work order")
            edits = req.edits or {}
            diff: dict = {}
            if req.decision == "reject":
                wo = wo.model_copy(update={"status": "rejected", "label": "Rejected by engineer"})
                to = "REJECTED"
            else:
                upd: dict[str, Any] = {"status": "approved", "approved_by": req.actor, "approved_at": now_iso(),
                                       "label": "Approved work order — assign responsibility"}
                if req.decision == "edit_approve":
                    if "assigned_to" in edits:
                        raise WorkflowError("Responsibility is assigned in the Assignment stage")
                    e_upd, diff = self._apply_edits(wo, edits)
                    upd.update(e_upd)
                    if e_upd:
                        upd.update({"revision": wo.revision + 1, "edited_by": req.actor, "edited_at": now_iso()})
                wo = wo.model_copy(update=upd)
                to = "APPROVED"
            approval_id = self.db.next_id("approval", "APR")
            rec = ApprovalRecord(approval_id=approval_id, incident_id=incident_id, work_order_id=wo.work_order_id, decision=req.decision,
                                 actor=req.actor, role=req.role, note=req.note, edits=edits or None, timestamp=now_iso(), sim_time=iso(self.cursor))
            self.db.execute("INSERT INTO approvals VALUES (?,?,?,?,?,?,?,?,?)",
                            (approval_id, incident_id, wo.work_order_id, inc["asset_id"], req.decision, req.actor, req.role, dumps(rec), rec.timestamp))
            self.db.execute("UPDATE work_orders SET status=?, json=?, updated_at=? WHERE work_order_id=?", (wo.status, dumps(wo), now_iso(), wo.work_order_id))
            verb = {"approve": "approved", "edit_approve": "edited and approved", "reject": "rejected"}[req.decision]
            self._transition(incident_id, to, req.actor, "human", f"Human decision: {verb}")
            ver = self._new_report(wo, "approved", req.actor) if req.decision != "reject" else None
            self.db.audit(action=f"work_order_{req.decision}", actor=req.actor, actor_type="human", run_id=inc["run_id"], incident_id=incident_id,
                          asset_id=inc["asset_id"], sim_time=iso(self.cursor), summary=f"{req.actor} ({req.role}) {verb} {wo.work_order_id}" + (f": {req.note}" if req.note else ""),
                          detail={"approval_id": approval_id, "edits": edits})
            ev_name = {"approve": "approved", "edit_approve": "approved_with_edits" if diff else "approved", "reject": "rejected"}[req.decision]
            self._wo_event(wo, ev_name, req.actor, req.role, f"{verb.capitalize()} by {req.actor} ({req.role})" + (f": {req.note}" if req.note else ""),
                           {"approval_id": approval_id, "priority": wo.priority, "edits": edits or None, "diff": diff or None, "reason": req.note or None},
                           before="proposed", after=wo.status, refs={"report_version": ver} if ver else None)
            return {"approval": rec.model_dump(), "work_order": wo.model_dump()}

    # ------------------------------------------------------------------ stage 2: assignment
    def assign_work_order(self, wo_id: str, team: str, person: str, due_date: str, actor: str, role: str) -> dict:
        with self.lock:
            self._require_role(role, APPROVER_ROLES, "assign work orders")
            wo = self._wo(wo_id)
            if wo.status not in ("approved", "assigned", "accepted", "in_progress", "returned"):
                raise WorkflowError(f"A work order that is '{wo.status}' cannot be assigned (it must be approved by an engineer first)")
            if not valid_assignment(team, person):
                raise WorkflowError("Choose one of the listed demo teams and a person from that team")
            try:
                due = date.fromisoformat(due_date)
            except ValueError:
                raise WorkflowError("Due date must be a valid date (YYYY-MM-DD)")
            if due < self._sim_date():
                raise WorkflowError(f"Due date cannot be before the current simulated date ({self._sim_date().isoformat()})")
            prev = wo.assignment
            new = Assignment(team=team, person=person, due_date=due_date, assigned_by=actor, assigned_at=now_iso(), sim_time=iso(self.cursor))
            person_changed = prev is None or prev.person != person
            if prev and not person_changed and prev.team == team and prev.due_date == due_date:
                raise WorkflowError("Nothing changed: this person, team and due date are already assigned")
            before = wo.status
            status = "assigned" if person_changed else wo.status
            wo = wo.model_copy(update={"assignment": new, "assigned_to": person, "status": status, "last_decline": None,
                                       "acceptance": None if person_changed else wo.acceptance,
                                       "escalated_at": None if prev and prev.due_date != due_date else wo.escalated_at})
            self._save_wo(wo)
            ver = self._new_report(wo, "assigned", actor)
            refs = {"report_version": ver}
            if prev is None:
                self._wo_event(wo, "assigned", actor, role, f"Assigned to {person} ({team}), due {due_date}, by {actor}",
                               {"team": team, "person": person, "due_date": due_date}, before=before, after=status, refs=refs)
            else:
                if person_changed or prev.team != team:
                    self._wo_event(wo, "reassigned", actor, role, f"Reassigned from {prev.person} ({prev.team}) to {person} ({team}) by {actor}",
                                   {"previous": prev.model_dump(), "team": team, "person": person, "due_date": due_date}, before=before, after=status, refs=refs)
                if prev.due_date != due_date:
                    self._wo_event(wo, "deadline_changed", actor, role, f"Due date changed from {prev.due_date} to {due_date} by {actor}",
                                   {"previous_due_date": prev.due_date, "due_date": due_date}, before=prev.due_date, after=due_date, refs=refs)
            return self.work_order_view(wo_id)

    # ------------------------------------------------------------------ stage 3: officer acceptance
    def _require_assignee(self, wo: WorkOrderDraft, actor: str, role: str, what: str) -> None:
        if role != "maintenance" or not wo.assignment or wo.assignment.person != actor:
            who = wo.assignment.person if wo.assignment else "the assigned officer"
            raise AccessDenied(f"Only the assigned maintenance officer ({who}) can {what}")

    def accept_assignment(self, wo_id: str, actor: str, role: str) -> dict:
        with self.lock:
            wo = self._wo(wo_id)
            self._require_assignee(wo, actor, role, "accept this assignment")
            if wo.status != "assigned":
                raise WorkflowError(f"The assignment cannot be accepted while the work order is '{wo.status}' (duplicate acceptance is not allowed)")
            wo = wo.model_copy(update={"status": "accepted", "acceptance": Acceptance(person=actor, at=now_iso(), sim_time=iso(self.cursor))})
            self._save_wo(wo)
            self._wo_event(wo, "assignment_accepted", actor, role, f"{actor} accepted the assignment", {"team": wo.assignment.team},  # type: ignore[union-attr]
                           before="assigned", after="accepted")
            return self.work_order_view(wo_id)

    def decline_assignment(self, wo_id: str, reason: str, actor: str, role: str) -> dict:
        with self.lock:
            wo = self._wo(wo_id)
            self._require_assignee(wo, actor, role, "decline this assignment")
            if wo.status != "assigned":
                raise WorkflowError(f"The assignment cannot be declined while the work order is '{wo.status}'")
            if len(reason.strip()) < 3:
                raise WorkflowError("A reason is required to decline an assignment")
            a = wo.assignment
            dec = Decline(person=actor, team=a.team, reason=reason.strip(), at=now_iso(), sim_time=iso(self.cursor))  # type: ignore[union-attr]
            wo = wo.model_copy(update={"status": "approved", "assignment": None, "assigned_to": None, "last_decline": dec, "acceptance": None,
                                       "label": "Returned to the engineer — reassign or review"})
            self._save_wo(wo)
            self._wo_event(wo, "assignment_declined", actor, role, f"{actor} declined the assignment: {reason.strip()} — returned to the engineer",
                           {"reason": reason.strip(), "previous": a.model_dump()}, before="assigned", after="approved")  # type: ignore[union-attr]
            return self.work_order_view(wo_id)

    # ------------------------------------------------------------------ stage 4: work execution
    def _require_assigned_worker(self, wo: WorkOrderDraft, actor: str, role: str, what: str) -> None:
        self._require_role(role, WORK_ROLES, what)
        if role == "maintenance" and (not wo.assignment or wo.assignment.person != actor):
            raise AccessDenied(f"Only the responsible person ({wo.assignment.person if wo.assignment else 'not yet assigned'}) "
                               f"or an engineer / asset owner may {what}")

    def update_progress(self, wo_id: str, note: str, delay_reason: str, actor: str, role: str, completion_note: str = "") -> dict:
        with self.lock:
            wo = self._wo(wo_id)
            self._require_assigned_worker(wo, actor, role, "update progress")
            if wo.status not in EXECUTION_STATES:
                raise WorkflowError(f"Progress can be recorded only during work execution (the order is '{wo.status}'; the assignment must be accepted first)")
            if not (note.strip() or delay_reason.strip() or completion_note.strip()):
                raise WorkflowError("Enter a progress note, a delay reason or a completion note")
            first = wo.status == "accepted"
            wo = wo.model_copy(update={"status": "in_progress", "progress_note": note.strip() or wo.progress_note,
                                       "delay_reason": delay_reason.strip() or wo.delay_reason,
                                       "completion_draft": completion_note.strip() or wo.completion_draft,
                                       "started_at": wo.started_at or now_iso()})
            self._save_wo(wo)
            if first:
                self._wo_event(wo, "work_started", actor, role, f"Work started by {actor}", {}, before="accepted", after="in_progress")
            if note.strip() or not first:
                self._wo_event(wo, "progress_update", actor, role, f"Progress updated by {actor}" + (f": {note.strip()}" if note.strip() else ""),
                               {"note": note.strip(), "delay_reason": delay_reason.strip()}, before="in_progress", after="in_progress")
            if delay_reason.strip():
                self._wo_event(wo, "delay_reported", actor, role, f"Delay recorded by {actor}: {delay_reason.strip()}", {"delay_reason": delay_reason.strip()})
            return self.work_order_view(wo_id)

    def open_evidence_stage(self, wo_id: str, completion_note: str, actor: str, role: str) -> dict:
        with self.lock:
            wo = self._wo(wo_id)
            self._require_assigned_worker(wo, actor, role, "start the evidence submission")
            if wo.status not in EXECUTION_STATES:
                raise WorkflowError(f"Evidence submission can be started only from work execution (the order is '{wo.status}')")
            before = wo.status
            wo = wo.model_copy(update={"status": "submitting_evidence", "completion_draft": completion_note.strip() or wo.completion_draft,
                                       "started_at": wo.started_at or now_iso()})
            self._save_wo(wo)
            self._wo_event(wo, "evidence_stage_opened", actor, role, f"{actor} finished the work and opened the evidence submission", {}, before=before, after="submitting_evidence")
            return self.work_order_view(wo_id)

    def back_to_execution(self, wo_id: str, actor: str, role: str) -> dict:
        with self.lock:
            wo = self._wo(wo_id)
            self._require_assigned_worker(wo, actor, role, "return to work execution")
            if wo.status != "submitting_evidence":
                raise WorkflowError("Only an order that is preparing its evidence submission can return to work execution")
            wo = wo.model_copy(update={"status": "in_progress"})
            self._save_wo(wo)
            self._wo_event(wo, "returned_to_execution", actor, role, f"{actor} returned to work execution before submitting", {}, before="submitting_evidence", after="in_progress")
            return self.work_order_view(wo_id)

    # ------------------------------------------------------------------ stage 5: evidence files + submission
    def attachments(self, wo_id: str, pending_only: bool = False) -> list[dict]:
        q = "SELECT * FROM work_order_attachments WHERE work_order_id=? AND removed_at IS NULL" + (" AND submission_version IS NULL" if pending_only else "") + " ORDER BY uploaded_at, rowid"
        return [{k: r[k] for k in ("attachment_id", "filename", "content_type", "size", "sha256", "uploaded_by", "uploaded_at", "submission_version")}
                for r in self.db.all(q, (wo_id,))]

    def _store_file(self, wo: WorkOrderDraft, filename: str, content_type: str, data_base64: str, actor: str, role: str) -> dict:
        if content_type not in EVIDENCE_TYPES:
            raise WorkflowError("File type not supported. Attach a PDF report, a PNG or JPEG photo, or a plain-text file.")
        try:
            data = base64.b64decode(data_base64, validate=True)
        except Exception:
            raise WorkflowError("The file could not be read (invalid upload data)")
        if not data:
            raise WorkflowError("The file is empty")
        if len(data) > MAX_EVIDENCE_BYTES:
            raise WorkflowError(f"The file is too large ({len(data) / 1048576:.1f} MB). The limit is {MAX_EVIDENCE_BYTES / 1048576:g} MB.")
        if not _magic_ok(content_type, data):
            raise WorkflowError(f"The file content does not match its type ({EVIDENCE_TYPES[content_type]}). Upload a genuine file.")
        if len(self.attachments(wo.work_order_id, pending_only=True)) >= MAX_FILES_PER_SUBMISSION:
            raise WorkflowError(f"At most {MAX_FILES_PER_SUBMISSION} files per submission")
        base_name = re.split(r"[\\/]", filename or "evidence")[-1].lstrip(".")
        safe = re.sub(r"[^A-Za-z0-9._-]", "_", base_name)[:60] or "evidence"
        aid = self.db.next_id("attachment", "ATT")
        folder = self.evidence_dir / wo.work_order_id
        folder.mkdir(parents=True, exist_ok=True)
        stored = f"{aid}_{safe}"
        (folder / stored).write_bytes(data)
        meta = {"attachment_id": aid, "filename": (base_name or safe)[:120], "stored_as": stored, "content_type": content_type, "size": len(data),
                "sha256": hashlib.sha256(data).hexdigest(), "uploaded_by": actor, "uploaded_at": now_iso()}
        self.db.execute("INSERT INTO work_order_attachments(attachment_id, work_order_id, incident_id, filename, stored_as, content_type, size, sha256, "
                        "uploaded_by, uploaded_role, uploaded_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                        (aid, wo.work_order_id, wo.incident_id, meta["filename"], stored, content_type, len(data), meta["sha256"], actor, role, meta["uploaded_at"]))
        return meta

    def add_attachment(self, wo_id: str, filename: str, content_type: str, data_base64: str, actor: str, role: str, replaces: Optional[str] = None) -> dict:
        with self.lock:
            wo = self._wo(wo_id)
            self._require_assigned_worker(wo, actor, role, "attach evidence")
            if wo.status != "submitting_evidence":
                raise WorkflowError("Files can be attached only during the evidence submission stage")
            old = None
            if replaces:
                old = self.db.one("SELECT * FROM work_order_attachments WHERE attachment_id=? AND work_order_id=? AND removed_at IS NULL AND submission_version IS NULL", (replaces, wo_id))
                if not old:
                    raise NotFound("the file to replace")
            meta = self._store_file(wo, filename, content_type, data_base64, actor, role)
            if old:
                self._remove_file(old, actor)
                self._wo_event(wo, "evidence_file_replaced", actor, role, f"{actor} replaced '{old['filename']}' with '{meta['filename']}'",
                               {"replaced": {"attachment_id": old["attachment_id"], "filename": old["filename"]}, "file": {k: meta[k] for k in ("attachment_id", "filename", "size", "sha256", "content_type")}},
                               refs={"attachments": [meta["attachment_id"]]})
            else:
                self._wo_event(wo, "evidence_file_uploaded", actor, role, f"{actor} uploaded '{meta['filename']}' ({meta['size']} bytes)",
                               {"file": {k: meta[k] for k in ("attachment_id", "filename", "size", "sha256", "content_type")}}, refs={"attachments": [meta["attachment_id"]]})
            return self.work_order_view(wo_id)

    def _remove_file(self, row: Any, actor: str) -> None:
        path = (self.evidence_dir / row["work_order_id"] / row["stored_as"])
        try:
            path.unlink()
        except FileNotFoundError:
            pass
        self.db.execute("UPDATE work_order_attachments SET removed_at=?, removed_by=? WHERE attachment_id=?", (now_iso(), actor, row["attachment_id"]))

    def remove_attachment(self, wo_id: str, attachment_id: str, actor: str, role: str) -> dict:
        with self.lock:
            wo = self._wo(wo_id)
            self._require_assigned_worker(wo, actor, role, "remove evidence")
            if wo.status != "submitting_evidence":
                raise WorkflowError("Files can be removed only before the evidence is submitted")
            row = self.db.one("SELECT * FROM work_order_attachments WHERE attachment_id=? AND work_order_id=? AND removed_at IS NULL AND submission_version IS NULL", (attachment_id, wo_id))
            if not row:
                raise NotFound("attachment (already submitted files cannot be removed)")
            self._remove_file(row, actor)
            self._wo_event(wo, "evidence_file_removed", actor, role, f"{actor} removed '{row['filename']}' before submitting",
                           {"file": {"attachment_id": attachment_id, "filename": row["filename"]}}, refs={"attachments": [attachment_id]})
            return self.work_order_view(wo_id)

    def attachment_path(self, wo_id: str, attachment_id: str):
        self._wo(wo_id)
        row = self.db.one("SELECT * FROM work_order_attachments WHERE attachment_id=? AND work_order_id=? AND removed_at IS NULL", (attachment_id, wo_id))
        if not row:
            raise NotFound("attachment")
        base = (self.evidence_dir / wo_id).resolve()
        path = (base / row["stored_as"]).resolve()
        if base not in path.parents or not path.exists():
            raise NotFound("attachment file is missing from storage")
        return path, row["filename"], row["content_type"]

    def submit_evidence(self, wo_id: str, note: str, no_attachment_reason: str, actor: str, role: str) -> dict:
        """Final submission: completion note + the files uploaded in this stage. Moves the order to Awaiting Engineer Approval only."""
        with self.lock:
            wo = self._wo(wo_id)
            self._require_assigned_worker(wo, actor, role, "submit completion evidence")
            if wo.status != "submitting_evidence":
                raise WorkflowError(f"Evidence cannot be submitted while the work order is '{wo.status}' (it may already have been submitted)")
            if len(note.strip()) < 10:
                raise WorkflowError("Write a completion note describing the work performed (at least 10 characters)")
            pending = self.attachments(wo_id, pending_only=True)
            if not pending and len(no_attachment_reason.strip()) < 5:
                raise WorkflowError("Attach at least one report (PDF preferred), or explain why no document applies")
            version = wo.evidence_version + 1
            atts = []
            for p in pending:
                self.db.execute("UPDATE work_order_attachments SET submission_version=? WHERE attachment_id=?", (version, p["attachment_id"]))
                row = self.db.one("SELECT * FROM work_order_attachments WHERE attachment_id=?", (p["attachment_id"],))
                atts.append(Attachment(filename=row["filename"], stored_as=row["stored_as"], size=row["size"], sha256=row["sha256"], content_type=row["content_type"],
                                       attachment_id=row["attachment_id"], uploaded_by=row["uploaded_by"], uploaded_at=row["uploaded_at"]))
            comp = Completion(note=note.strip(), submitted_by=actor, submitted_at=now_iso(), sim_time=iso(self.cursor), attachments=atts, version=version,
                              no_attachment_reason=no_attachment_reason.strip() or None)
            wo = wo.model_copy(update={"status": "awaiting_verification", "completion": comp, "evidence_version": version})
            self._save_wo(wo)
            self._wo_event(wo, "completion_submitted", actor, role,
                           f"Completion note and evidence (version {version}) submitted by {actor}: {note.strip()}" + (f" · {len(atts)} file(s)" if atts else " · no attachment"),
                           {"note": note.strip(), "version": version, "no_attachment_reason": comp.no_attachment_reason,
                            "files": [{"attachment_id": a.attachment_id, "filename": a.filename, "size": a.size, "sha256": a.sha256} for a in atts]},
                           before="submitting_evidence", after="awaiting_verification", refs={"attachments": [a.attachment_id for a in atts], "evidence_version": version})
            return self.work_order_view(wo_id)

    # ------------------------------------------------------------------ stage 6/7: engineer evidence approval and completion
    def review_work_order(self, wo_id: str, decision: str, reason: str, actor: str, role: str) -> dict:
        with self.lock:
            self._require_role(role, APPROVER_ROLES, "approve evidence or request further work")
            wo = self._wo(wo_id)
            if wo.status != "awaiting_verification" or not wo.completion:
                raise WorkflowError("Only a work order whose evidence has been submitted can be reviewed (it may already have been decided)")
            if actor in (wo.completion.submitted_by, wo.assignment.person if wo.assignment else None):
                raise AccessDenied("The reviewing engineer must be a different person from the officer who did or submitted the work")
            if decision == "verify":
                decision = "approve"
            if decision not in ("approve", "further_work"):
                raise WorkflowError("decision must be 'approve' or 'further_work'")
            if decision == "further_work" and len(reason.strip()) < 3:
                raise WorkflowError("A reason is required when requesting further work: say what is missing or inadequate")
            ver = wo.completion.version
            rv = Review(decision="verified" if decision == "approve" else "further_work", reviewer=actor, role=role, reason=reason.strip(),
                        at=now_iso(), sim_time=iso(self.cursor), evidence_version=ver)
            if decision == "approve":
                wo = wo.model_copy(update={"status": "verified", "review": rv, "label": "Job completed — evidence approved by engineer"})
                self._save_wo(wo)
                self._wo_event(wo, "evidence_approved", actor, role, f"Evidence version {ver} approved by {actor} ({role})" + (f": {reason.strip()}" if reason.strip() else ""),
                               {"reviewer": actor, "reason": reason.strip(), "evidence_version": ver}, before="awaiting_verification", after="verified",
                               refs={"evidence_version": ver, "attachments": [a.attachment_id for a in wo.completion.attachments]})
                inc = self.db.one("SELECT * FROM incidents WHERE incident_id=?", (wo.incident_id,))
                closed = False
                if inc and inc["state"] == "APPROVED":
                    self._transition(wo.incident_id, "CLOSED_BY_HUMAN", actor, "human",
                                     f"Investigation completed by {actor} after approving the evidence for {wo_id}" + (f": {reason.strip()}" if reason.strip() else ""))
                    self._resolve_incident(wo, inc, actor)
                    closed = True
                rver = self._new_report(wo, "completed", actor)
                self._wo_event(wo, "work_order_completed", actor, role, f"{wo.work_order_id} marked completed (job completed)", {"completed_by": actor},
                               before="verified", after="verified", refs={"report_version": rver})
                if closed:
                    self._wo_event(wo, "investigation_completed", actor, role, f"Investigation {wo.incident_id} marked completed",
                                   {"incident_id": wo.incident_id}, before=inc["state"], after="CLOSED_BY_HUMAN")
            else:
                hist = list(wo.completion_history) + [wo.completion]
                wo = wo.model_copy(update={"status": "returned", "review": rv, "completion": None, "completion_history": hist,
                                           "label": "Further work requested by engineer"})
                self._save_wo(wo)
                self._wo_event(wo, "further_work_requested", actor, role, f"Further work requested by {actor}: {reason.strip()}",
                               {"reviewer": actor, "reason": reason.strip(), "evidence_version": ver}, before="awaiting_verification", after="returned",
                               refs={"evidence_version": ver})
            return self.work_order_view(wo_id)

    def _resolve_incident(self, wo: WorkOrderDraft, inc: Any, actor: str) -> None:
        """Smallest consistent post-completion state: the bridge's designated post-completion scenario is the existing 'improves'
        follow-up set (deterministic, SIMULATED, baseline-level readings). It is persisted against the incident so the 3D view can show a
        resolved state. It is NOT a real measurement and does not establish structural safety."""
        a = inc["asset_id"]
        d = self.data.get(a)
        if d is None:
            return
        ev = AnomalyEvent.model_validate(loads(self.db.one("SELECT json FROM anomaly_events WHERE event_id=?", (inc["event_id"],))["json"]))
        start = self.cursor + timedelta(hours=6)
        rows, flags = pipeline.load_follow_up(d, "improves", start, ev)
        out = []
        n = 0
        for s in d.asset.sensors:
            n = max(n, len(rows[s.sensor_id]))
            for j, (r, f) in enumerate(zip(rows[s.sensor_id], flags[s.sensor_id])):
                out.append((self.run_id, a, s.sensor_id, 150000 + j, r["t_start"], r["t_end"], "follow_up", dumps(r["features"]), f.status, f.detail,
                            wo.incident_id, self.run.seed, d.baseline.version, now_iso()))
        self.db.executemany("INSERT OR REPLACE INTO readings VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", out)
        self.db.execute("INSERT OR REPLACE INTO incident_resolutions VALUES (?,?,?,?,?,?,?,?,?,?)",
                        (wo.incident_id, wo.work_order_id, a, self.run_id, now_iso(), iso(self.cursor), actor, "simulated_post_completion", iso(start), n))

    def resolution_for(self, asset_id: str) -> Optional[dict]:
        r = self.db.one("SELECT * FROM incident_resolutions WHERE run_id=? AND asset_id=? ORDER BY resolved_at DESC", (self.run_id, asset_id))
        return dict(r) if r else None

    # ------------------------------------------------------------------ views
    def work_order_next_action(self, wo: WorkOrderDraft, overdue: bool) -> dict:
        s = wo.status
        who = wo.assignment.person if wo.assignment else "the assigned officer"
        table = {
            "proposed": ("Review, edit if needed, then approve or reject the proposed work order", "Engineer / asset owner"),
            "approved": ("Assign a maintenance team, responsible officer and due date" + (f" (declined by {wo.last_decline.person}: {wo.last_decline.reason})" if wo.last_decline else ""), "Engineer / asset owner"),
            "assigned": ("Review the report and accept or decline the assignment", who),
            "accepted": ("Start the work and record progress", who),
            "in_progress": ("Complete the work, then proceed to evidence submission", who),
            "returned": ("Correct the work" + (f" — engineer's note: {wo.review.reason}" if wo.review else "") + " and resubmit evidence", who),
            "submitting_evidence": ("Add the completion note and PDF report, then submit the evidence", who),
            "awaiting_verification": ("Review the submitted evidence: Approve Evidence or Request Further Work", "Engineer / asset owner (not the submitting officer)"),
            "verified": ("None — job completed", ""), "rejected": ("None — rejected by the engineer", ""), "completed": ("Legacy status", ""),
        }
        label, by = table.get(s, ("", ""))
        return {"label": label, "by": by, "urgent": s in ("proposed", "awaiting_verification", "assigned", "approved") or overdue,
                "stage": STAGE_OF.get(s, 1), "stage_label": STAGE_LABEL.get(STAGE_OF.get(s, 1), "")}

    def work_order_view(self, wo_id: str) -> dict:
        wo = self._wo(wo_id)
        overdue = self._overdue(wo)
        inc = self.db.one("SELECT state, asset_id FROM incidents WHERE incident_id=?", (wo.incident_id,))
        res = self.db.one("SELECT * FROM incident_resolutions WHERE incident_id=?", (wo.incident_id,))
        return {"work_order": wo.model_dump(), "overdue": overdue, "escalated": bool(wo.escalated_at),
                "next_action": self.work_order_next_action(wo, overdue), "sim_date": self._sim_date().isoformat(),
                "incident_id": wo.incident_id, "asset_id": wo.asset_id, "incident_state": inc["state"] if inc else None,
                "investigation_completed": bool(inc and inc["state"] == "CLOSED_BY_HUMAN"),
                "pending_attachments": self.attachments(wo_id, pending_only=True), "reports": self.report_versions(wo_id),
                "history_count": self.db.one("SELECT COUNT(*) c FROM work_order_events WHERE work_order_id=?", (wo_id,))["c"],
                "resolution": dict(res) if res else None,
                "limits": {"max_upload_bytes": MAX_EVIDENCE_BYTES, "allowed_types": list(EVIDENCE_TYPES), "max_files": MAX_FILES_PER_SUBMISSION}}

    def work_order_rows(self) -> list[dict]:
        self.check_overdue()
        out = []
        for w in self.db.all("SELECT * FROM work_orders ORDER BY created_at DESC"):
            inc = self.db.one("SELECT * FROM incidents WHERE incident_id=?", (w["incident_id"],))
            if not inc or inc["run_id"] != self.run_id or inc["asset_id"] not in self.active:
                continue
            wo = WorkOrderDraft.model_validate(loads(w["json"]))
            overdue = self._overdue(wo)
            na = self.work_order_next_action(wo, overdue)
            out.append({"work_order_id": w["work_order_id"], "incident_id": w["incident_id"], "asset_id": w["asset_id"], "status": w["status"],
                        "priority": wo.priority, "timeframe": wo.timeframe, "reason": wo.reason,
                        "steps_summary": wo.steps[0].action if wo.steps else "", "assignment": wo.assignment.model_dump() if wo.assignment else None,
                        "overdue": overdue, "escalated": bool(wo.escalated_at), "next_action": na, "stage": na["stage"], "stage_label": na["stage_label"],
                        "incident_state": inc["state"], "created_at": w["created_at"], "approved_by": wo.approved_by,
                        "completion_submitted": bool(wo.completion), "reviewed_by": wo.review.reviewer if wo.review else None})
        return out

    # ------------------------------------------------------------------ audit trail / chain of custody
    def audit_trail(self, work_order_id: Optional[str] = None, incident_id: Optional[str] = None, actor: Optional[str] = None,
                    action: Optional[str] = None, date_from: Optional[str] = None, date_to: Optional[str] = None,
                    order: str = "asc", all_runs: bool = False) -> list[dict]:
        rows: list[dict] = []
        runs = "" if all_runs else " AND i.run_id=?"
        args: tuple = () if all_runs else (self.run_id,)
        for r in self.db.all("SELECT e.* FROM work_order_events e JOIN incidents i ON i.incident_id=e.incident_id WHERE 1=1" + runs, args):
            d = loads(r["detail_json"])
            rows.append({"event_id": f"WOE-{r['id']:05d}", "source": "work_order", "work_order_id": r["work_order_id"], "incident_id": r["incident_id"],
                         "action": r["action"], "action_label": ACTION_LABEL.get(r["action"], r["action"].replace("_", " ").capitalize()),
                         "actor": r["actor"], "actor_role": r["actor_role"], "ts": r["ts"], "sim_time": r["sim_time"],
                         "before": d.get("before"), "after": d.get("after"), "summary": r["summary"], "refs": d.get("refs") or {}, "detail": {k: v for k, v in d.items() if k not in ("before", "after", "refs")}})
        for r in self.db.all("SELECT a.* FROM audit_events a JOIN incidents i ON i.incident_id=a.incident_id WHERE a.action NOT LIKE 'wo\\_%' ESCAPE '\\' "
                             "AND a.action NOT LIKE 'work\\_order\\_%' ESCAPE '\\'" + runs.replace("i.run_id", "i.run_id"), args):
            wo = self.db.one("SELECT work_order_id FROM work_orders WHERE incident_id=? ORDER BY created_at DESC", (r["incident_id"],))
            rows.append({"event_id": f"AUD-{r['id']:05d}", "source": "investigation", "work_order_id": wo["work_order_id"] if wo else None, "incident_id": r["incident_id"],
                         "action": r["action"], "action_label": ACTION_LABEL.get(r["action"], r["action"].replace("_", " ").capitalize()),
                         "actor": r["actor"], "actor_role": r["actor_type"], "ts": r["ts"], "sim_time": r["sim_time"], "before": r["from_state"], "after": r["to_state"],
                         "summary": r["summary"], "refs": {}, "detail": loads(r["detail_json"])})
        if work_order_id:
            rows = [x for x in rows if x["work_order_id"] == work_order_id]
        if incident_id:
            rows = [x for x in rows if x["incident_id"] == incident_id]
        if actor:
            rows = [x for x in rows if actor.lower() in x["actor"].lower()]
        if action:
            rows = [x for x in rows if x["action"] == action]
        if date_from:
            rows = [x for x in rows if x["ts"][:10] >= date_from]
        if date_to:
            rows = [x for x in rows if x["ts"][:10] <= date_to]
        rows.sort(key=lambda x: (x["ts"], x["event_id"]), reverse=(order == "desc"))
        return rows
