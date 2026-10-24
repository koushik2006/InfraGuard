"use client";

import { AlertTriangle, Check, FileQuestion, History } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { STATUS_TONE } from "@/components/WorkOrderCard";
import { Badge, Card, Empty, SimulatedTag, Skeleton } from "@/components/ui";
import { AcceptStage, AssignStage, CompletedStage, EvidenceReviewStage, EvidenceStage, ExecutionStage, RejectedStage, ReviewStage } from "@/components/workorder/stages";
import { ErrorLine, type StageProps } from "@/components/workorder/shared";
import { useApi } from "@/lib/api";
import { cx, fmtWall } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { IncidentDetail, WorkOrderView } from "@/lib/types";
import { WO_STAGES, WO_STATUS_LABEL } from "@/lib/workflow";

/** Read-only record of a stage that has already been completed (previously entered information is preserved and visible). */
function PastStage({ n, v }: { n: number; v: WorkOrderView }) {
  const wo = v.work_order, a = wo.assignment, c = wo.completion ?? wo.completion_history.at(-1) ?? null, r = wo.review;
  type Row = [string, React.ReactNode];
  const rows: Row[] = ({
    1: [["Decision", <>Approved by <b>{wo.approved_by}</b> at <span className="num">{fmtWall(wo.approved_at)}</span></>], ["Instruction revision", wo.revision > 1 ? `${wo.revision} (edited by ${wo.edited_by})` : "1 (no edits)"], ["Reason", wo.reason]],
    2: [["Assigned to", a ? <><b>{a.person}</b> · {a.team}</> : "—"], ["Due date", a?.due_date ?? "—"], ["Assigned by", a ? <>{a.assigned_by} at <span className="num">{fmtWall(a.assigned_at)}</span></> : "—"]],
    3: [["Accepted by", wo.acceptance ? <><b>{wo.acceptance.person}</b> at <span className="num">{fmtWall(wo.acceptance.at)}</span></> : "—"]],
    4: [["Work started", wo.started_at ? fmtWall(wo.started_at) : "—"], ["Latest progress note", wo.progress_note ?? "—"], ["Reported delay", wo.delay_reason ?? "None"]],
    5: [["Evidence submitted", c ? <>Version {c.version} by <b>{c.submitted_by}</b> at <span className="num">{fmtWall(c.submitted_at)}</span></> : "—"], ["Completion note", c?.note ?? "—"],
        ["Files", c?.attachments.map((x) => x.filename).join(", ") || "None"]],
    6: [["Evidence approved by", r ? <><b>{r.reviewer}</b> at <span className="num">{fmtWall(r.at)}</span></> : "—"], ["Reason / note", r?.reason || "—"]],
  } as Record<number, Row[]>)[n] ?? [];
  return (
    <Card data-past-stage={n}>
      <div className="p-5">
        <p className="text-sm font-semibold text-text"><Check size={14} className="mr-1 inline text-blue" /> Stage {n}: {WO_STAGES[n - 1]} — completed</p>
        <dl className="mt-3 space-y-2 text-sm">{rows.map(([k, val]) => <div key={k} className="grid gap-1 sm:grid-cols-[180px_1fr]"><dt className="text-xs text-faint">{k}</dt><dd className="text-text">{val}</dd></div>)}</dl>
        <p className="mt-3 text-xs text-faint">Shown for reference. The workflow continues at stage {v.next_action.stage}.</p>
      </div>
    </Card>
  );
}

export default function WorkOrderPage() {
  const { id } = useParams<{ id: string }>();
  const { version, refresh, user, pushToast } = useApp();
  const { data: v, error, reload } = useApi<WorkOrderView>(`/api/work-orders/${id}`, version);
  const { data: inc, reload: reloadInc } = useApi<IncidentDetail>(v ? `/api/incidents/${v.incident_id}` : null, version);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<number | null>(null);
  const status = v?.work_order.status;
  useEffect(() => { setView(null); setErr(null); }, [status]);

  if (error) return <Empty icon={<FileQuestion size={22} />} title="Work order not found" body={error} />;
  if (!v) return <div className="space-y-4"><Skeleton className="h-16 w-96" /><Skeleton className="h-60" /></div>;
  const wo = v.work_order;
  const current = wo.status === "rejected" ? 1 : v.next_action.stage;
  const shown = view ?? current;
  const body = { actor: user.name, role: user.role };

  const act: StageProps["act"] = async (fn, ok) => {
    setBusy(true); setErr(null);
    try { await fn(); await reload(); await reloadInc(); await refresh(); pushToast({ tone: "blue", title: ok }); return true; }
    catch (e) { setErr((e as Error).message); return false; }
    finally { setBusy(false); }
  };
  const props: StageProps = { v, inc, user, busy, act, body };

  return (
    <div className="space-y-5">
      <div>
        <Breadcrumbs items={[{ label: "Work Orders", href: "/work-orders" }, { label: <span className="num">{wo.work_order_id}</span> }]} />
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="num text-xl font-semibold tracking-tight">{wo.work_order_id}</h1>
          <Badge tone={STATUS_TONE[wo.status] ?? "neutral"} className="text-xs">{WO_STATUS_LABEL[wo.status] ?? wo.status}</Badge>
          <Badge tone={wo.priority === "P1" ? "red" : "neutral"}>{wo.priority} · {wo.timeframe}</Badge>
          {v.overdue && <Badge tone="red" icon={<AlertTriangle size={11} />}>Overdue{v.escalated ? " · escalated" : ""}</Badge>}
          <SimulatedTag />
          <Link href={`/audit?work_order=${wo.work_order_id}`} className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-blue hover:underline"><History size={13} /> Audit trail ({v.history_count})</Link>
        </div>
        <p className="mt-1 text-sm text-muted">Linked incident <Link href={`/incidents/${v.incident_id}`} className="num text-blue hover:underline">{v.incident_id}</Link> · {inc?.asset.name ?? v.asset_id} · simulated date <span className="num">{v.sim_date}</span> · acting as <b className="text-text">{user.name}</b></p>
      </div>

      {/* stage indicator: completed, current, upcoming */}
      <Card>
        <ol className="flex flex-wrap items-center gap-x-1 gap-y-2 px-4 py-3" aria-label="Work order stages" data-testid="stage-indicator">
          {WO_STAGES.map((label, i) => {
            const n = i + 1, done = n < current || (n === 7 && wo.status === "verified"), here = n === current, reachable = n <= current;
            return (
              <li key={label} className="flex items-center gap-1">
                {i > 0 && <span className={cx("h-px w-3", done || here ? "bg-blue" : "bg-line")} aria-hidden />}
                <button type="button" disabled={!reachable} onClick={() => setView(n === current ? null : n)} aria-current={here ? "step" : undefined} data-stage={n} data-state={here ? "current" : done ? "done" : "upcoming"}
                  aria-label={`Stage ${n}: ${label} — ${here ? "current" : done ? "completed" : "upcoming"}`}
                  className={cx("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed",
                    n === shown ? "ring-2 ring-blue/40" : "", here ? "border-amber bg-amber-soft text-amber" : done ? "border-blue/40 text-blue hover:bg-blue-soft" : "border-line text-faint")}>
                  {done ? <Check size={12} /> : <span className="num">{n}</span>}<span className="hidden lg:inline">{label}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </Card>

      <Card className={cx(v.next_action.urgent && "border-amber/50")}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
          <p className="text-sm"><span className="text-xs font-semibold uppercase tracking-wider text-faint">Stage {current} · {v.next_action.stage_label || "Engineer review"} — next required action</span><br />
            <b className={v.next_action.urgent ? "text-amber" : "text-text"}>{v.next_action.label}</b>{v.next_action.by && <span className="text-muted"> — by {v.next_action.by}</span>}</p>
          {view !== null && view !== current && <button onClick={() => setView(null)} className="text-xs font-medium text-blue hover:underline">Back to the current stage</button>}
        </div>
      </Card>
      <ErrorLine msg={err} />

      <div data-current-stage={current} data-shown-stage={shown}>
        {wo.status === "rejected" ? <RejectedStage {...props} /> : shown < current ? <PastStage n={shown} v={v} /> :
          current === 1 ? <ReviewStage {...props} /> : current === 2 ? <AssignStage {...props} /> : current === 3 ? <AcceptStage {...props} /> :
          current === 4 ? <ExecutionStage {...props} /> : current === 5 ? <EvidenceStage {...props} /> : current === 6 ? <EvidenceReviewStage {...props} /> : <CompletedStage {...props} />}
      </div>
    </div>
  );
}
