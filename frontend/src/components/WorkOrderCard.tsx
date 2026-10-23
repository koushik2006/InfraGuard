"use client";

import { AlertTriangle, ArrowRight, History } from "lucide-react";
import Link from "next/link";
import { Badge, Button } from "@/components/ui";
import type { WorkOrderRow } from "@/lib/types";
import { WO_STATUS_LABEL } from "@/lib/workflow";

export const STATUS_TONE: Record<string, "amber" | "blue" | "slate" | "red" | "neutral"> = {
  proposed: "amber", approved: "amber", assigned: "blue", in_progress: "blue", awaiting_verification: "amber", verified: "slate", returned: "amber", rejected: "slate",
};

export function attention(w: WorkOrderRow) {
  return w.overdue || w.next_action.urgent;
}

export function WorkOrderCard({ w }: { w: WorkOrderRow }) {
  const hot = attention(w);
  return (
    <li data-wo={w.work_order_id} data-status={w.status} className={`px-5 py-4 ${w.overdue ? "bg-red-soft/40" : hot ? "bg-amber-soft/30" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/work-orders/${w.work_order_id}`} className="num text-sm font-semibold text-blue hover:underline">{w.work_order_id}</Link>
            <span className="text-xs text-faint">for <Link href={`/incidents/${w.incident_id}`} className="num hover:text-text hover:underline">{w.incident_id}</Link></span>
            <Badge tone={STATUS_TONE[w.status] ?? "neutral"}>{WO_STATUS_LABEL[w.status] ?? w.status}</Badge>
            <Badge tone={w.priority === "P1" ? "red" : "neutral"}>{w.priority} · {w.timeframe}</Badge>
            {w.overdue && <Badge tone="red" icon={<AlertTriangle size={11} />}>Overdue{w.escalated ? " · escalated" : ""}</Badge>}
          </div>
          <p className="line-clamp-2 max-w-3xl text-sm text-text">{w.steps_summary || w.reason}</p>
          <p className="text-xs text-muted">
            {w.assignment ? <>Assigned to <b className="text-text">{w.assignment.person}</b> · {w.assignment.team} · due <span className="num text-text">{w.assignment.due_date}</span></> : "Not assigned yet"}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <p className={`text-xs font-semibold ${w.next_action.urgent ? "text-amber" : "text-muted"}`}>Next: {w.next_action.label}</p>
          <div className="flex items-center gap-2">
            <Link href={`/work-orders/${w.work_order_id}#history`} className="inline-flex items-center gap-1 text-xs text-blue hover:underline"><History size={12} /> View Activity History</Link>
            <Link href={`/work-orders/${w.work_order_id}`}><Button size="sm" variant={hot ? "primary" : "secondary"}>Open <ArrowRight size={13} /></Button></Link>
          </div>
        </div>
      </div>
    </li>
  );
}

