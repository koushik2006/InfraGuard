import type { IncidentBrief } from "./types";

/** The investigation journey ends at the human decision on the preventive action. Completion and verification are tracked
 *  separately, per work order, in Work Orders. */
export const JOURNEY = ["Detection", "Evidence", "Assessment", "Preventive action"] as const;

/** Index of the investigation stage an incident is currently in (JOURNEY.length means finished: decided by a human). */
export function journeyStep(state: string): number {
  switch (state) {
    case "DETECTED": return 0;
    case "INVESTIGATING": return 1;
    case "PRIORITISING": return 2;
    case "PLANNING": case "AWAITING_APPROVAL": case "REJECTED": return 3;
    default: return JOURNEY.length; // approved or later: the investigation is complete
  }
}

export interface NextAction { label: string; href: string | null; hint: string; tone: "amber" | "blue" | "slate" }

export const WO_STATUS_LABEL: Record<string, string> = {
  proposed: "Pending engineer approval", approved: "Approved — needs assignment", assigned: "Assigned — awaiting acceptance", accepted: "Accepted — work to start",
  in_progress: "Work in progress", submitting_evidence: "Preparing evidence", awaiting_verification: "Awaiting engineer approval of evidence",
  verified: "Job completed", returned: "Returned for further work", rejected: "Rejected", completed: "Completed (legacy)",
};

/** The seven stages of a work order, in order. Each one is a dedicated view inside Work Orders. */
export const WO_STAGES = ["Engineer review", "Assignment", "Officer acceptance", "Work execution", "Evidence submission", "Evidence approval", "Job completed"] as const;

/** What the user should do next, derived only from backend workflow and work-order state. */
export function nextAction(i: Pick<IncidentBrief, "state" | "incident_id" | "work_order_id" | "work_order_status">): NextAction {
  const inv = `/incidents/${i.incident_id}`;
  const wo = i.work_order_id ? `/work-orders/${i.work_order_id}` : inv;
  switch (i.state) {
    case "DETECTED": case "INVESTIGATING": case "PRIORITISING": case "PLANNING":
      return { label: "Continue investigation", href: inv, hint: "Run the next investigation stage", tone: "blue" };
    case "AWAITING_APPROVAL":
      return { label: "Review proposed action", href: wo, hint: "A preventive action awaits your approval or rejection", tone: "amber" };
    case "REJECTED":
      return { label: "Revise proposal", href: wo, hint: "The proposal was rejected; request a revised one", tone: "amber" };
    case "CLOSED_BY_HUMAN":
      return { label: "Completed", href: wo, hint: "The engineer approved the evidence; investigation completed", tone: "slate" };
    default: {
      const s = i.work_order_status ?? "approved";
      const map: Record<string, [string, NextAction["tone"]]> = {
        approved: ["Assign responsibility", "amber"], assigned: ["Awaiting officer acceptance", "blue"], accepted: ["Track progress", "blue"], in_progress: ["Track progress", "blue"],
        submitting_evidence: ["Track progress", "blue"], returned: ["Resume work", "amber"], awaiting_verification: ["Approve evidence", "amber"], verified: ["Open work order", "slate"],
      };
      const [label, tone] = map[s] ?? ["Open work order", "blue"];
      return { label, href: wo, hint: WO_STATUS_LABEL[s] ?? s, tone };
    }
  }
}

export const STATE_LABEL: Record<string, string> = {
  DETECTED: "Anomaly detected", INVESTIGATING: "Evidence gathered", PRIORITISING: "Priority assessed", PLANNING: "Drafting proposal",
  AWAITING_APPROVAL: "Awaiting approval", REJECTED: "Proposal rejected", APPROVED: "Approved — tracked in Work Orders",
  VERIFYING: "Verifying", MONITORING_PERSISTS: "Deviation persists", MONITORING_IMPROVED: "Monitoring improved",
  CANNOT_ASSESS: "Cannot assess", CLOSED_BY_HUMAN: "Investigation completed",
};
