"""Shared exceptions and constants for the work-order workflow (kept apart so the engine and its accountability mixin can both import them)."""
from __future__ import annotations

import os


class WorkflowError(Exception):
    status_code = 409


class AccessDenied(WorkflowError):
    status_code = 403


class NotFound(WorkflowError):
    status_code = 404


APPROVER_ROLES = {"engineer", "asset_owner"}
WORK_ROLES = {"maintenance", "engineer", "asset_owner"}

# Evidence uploads. The size limit is configurable: INFRAGUARD_MAX_UPLOAD_MB (default 5 MB; uploads travel as base64 JSON).
MAX_EVIDENCE_BYTES = int(float(os.environ.get("INFRAGUARD_MAX_UPLOAD_MB", "5")) * 1024 * 1024)
MAX_FILES_PER_SUBMISSION = 10
EVIDENCE_TYPES = {"application/pdf": ".pdf", "image/png": ".png", "image/jpeg": ".jpg", "text/plain": ".txt"}

LIVE_WO = ("assigned", "accepted", "in_progress", "returned", "submitting_evidence")
EXECUTION_STATES = ("accepted", "in_progress", "returned")

STAGE_OF = {"proposed": 1, "approved": 2, "assigned": 3, "accepted": 4, "in_progress": 4, "returned": 4,
            "submitting_evidence": 5, "awaiting_verification": 6, "verified": 7, "rejected": 1, "completed": 7}
STAGE_LABEL = {1: "Engineer review", 2: "Assignment", 3: "Officer acceptance", 4: "Work execution", 5: "Evidence submission",
               6: "Engineer evidence approval", 7: "Job completed"}

ACTION_LABEL = {
    "proposed": "Work order created", "proposal_edited": "Engineer edited the proposal", "approved": "Engineer approved the work order",
    "approved_with_edits": "Engineer edited and approved the work order", "rejected": "Engineer rejected the work order",
    "assigned": "Assignment created", "reassigned": "Assignment changed", "deadline_changed": "Due date changed",
    "assignment_accepted": "Officer accepted the assignment", "assignment_declined": "Officer declined the assignment",
    "progress_update": "Progress updated", "work_started": "Work started", "delay_reported": "Delay recorded",
    "evidence_stage_opened": "Evidence submission started", "returned_to_execution": "Returned to work execution",
    "evidence_file_uploaded": "Evidence file uploaded", "evidence_file_removed": "Evidence file removed",
    "evidence_file_replaced": "Evidence file replaced", "completion_submitted": "Completion note and evidence submitted",
    "evidence_approved": "Engineer approved the evidence", "further_work_requested": "Engineer requested further work",
    "work_order_completed": "Work order marked completed", "investigation_completed": "Investigation marked completed",
    "overdue_escalation": "Overdue — escalation recorded", "report_generated": "Report version generated",
    "completion_evidence_submitted": "Completion evidence submitted", "verified": "Completion verified",
}
