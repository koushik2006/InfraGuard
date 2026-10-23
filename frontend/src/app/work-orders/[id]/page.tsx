"use client";

import { AlertTriangle, Check, ChevronDown, ClipboardCheck, FileUp, FileQuestion, Lock, RotateCcw, ThumbsDown, UserCheck } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { STATUS_TONE } from "@/components/WorkOrderCard";
import { Badge, Button, Card, CardHeader, Empty, SimulatedTag, Skeleton } from "@/components/ui";
import { post, useApi } from "@/lib/api";
import { cx, fmtSim, fmtWall } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { Directory, IncidentDetail, WorkOrderEvent, WorkOrderView } from "@/lib/types";
import { WO_STATUS_LABEL } from "@/lib/workflow";

const ACTION_LABEL: Record<string, string> = {
  proposed: "Proposed", approved: "Approved", rejected: "Rejected", assigned: "Assigned", reassigned: "Reassigned", deadline_changed: "Deadline changed",
  progress_update: "Progress update", started: "Work started", delay_reported: "Delay reported", overdue_escalation: "Overdue — escalated",
  completion_evidence_submitted: "Completion evidence submitted", proposal_updated: "Proposal updated", verified: "Verified", further_work_requested: "Further work requested", approved_with_edits: "Approved with edits",
};
const EV_TONE: Record<string, string> = { overdue_escalation: "bg-red", rejected: "bg-faint", verified: "bg-blue", further_work_requested: "bg-amber", delay_reported: "bg-amber", completion_evidence_submitted: "bg-blue" };

function History({ id, count, open, setOpen }: { id: string; count: number; open: boolean; setOpen: (v: boolean) => void }) {
  const { version } = useApp();
  const { data, loading } = useApi<WorkOrderEvent[]>(open ? `/api/work-orders/${id}/history` : null, version);
  return (
    <Card id="history">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center justify-between px-5 py-3.5 text-left">
        <span className="text-sm font-semibold">View Activity History <span className="num ml-1 text-xs font-normal text-muted">{count} event{count === 1 ? "" : "s"}</span></span>
        <ChevronDown size={16} className={cx("text-muted transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="border-t border-line-soft px-5 py-4">
          {!data && loading && <Skeleton className="h-24" />}
          <ol className="relative space-y-4 border-l border-line pl-5" aria-label="Activity history">
            {(data ?? []).map((e) => (
              <li key={e.id} className="relative" data-event={e.action}>
                <span className={cx("absolute -left-[25px] top-1 h-2.5 w-2.5 rounded-full ring-2 ring-surface", EV_TONE[e.action] ?? "bg-blue")} aria-hidden />
                <p className="text-sm text-text"><b>{ACTION_LABEL[e.action] ?? e.action}</b> <span className="text-muted">· {e.summary}</span></p>
                <p className="num mt-0.5 text-[11px] text-faint">{fmtWall(e.ts)}{e.sim_time && <> · simulated clock {fmtSim(e.sim_time)} UTC</>} · {e.actor}{e.actor_role && ` (${e.actor_role})`}</p>
              </li>
            ))}
          </ol>
        </div>
      )}
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-xs"><span className="mb-1 block font-medium text-muted">{label}</span>{children}</label>;
}
const inputCls = "h-9 w-full rounded-md border border-line bg-surface px-3 text-sm text-text";

export default function WorkOrderPage() {
  const { id } = useParams<{ id: string }>();
  const { version, refresh, user, pushToast } = useApp();
  const { data: v, error, reload } = useApi<WorkOrderView>(`/api/work-orders/${id}`, version);
  const { data: dir } = useApi<Directory>("/api/directory");
  const { data: inc, reload: reloadInc } = useApi<IncidentDetail>(v ? `/api/incidents/${v.incident_id}` : null, version);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [histOpen, setHistOpen] = useState(false);
  const [team, setTeam] = useState(""); const [person, setPerson] = useState(""); const [due, setDue] = useState("");
  const [note, setNote] = useState(""); const [delay, setDelay] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [reason, setReason] = useState(""); const [rejectNote, setRejectNote] = useState(""); const [rejecting, setRejecting] = useState(false);
  const [reassign, setReassign] = useState(false);

  useEffect(() => { if (typeof window !== "undefined" && window.location.hash === "#history") setHistOpen(true); }, []);
  useEffect(() => { if (v?.work_order.assignment) { setTeam(v.work_order.assignment.team); setPerson(v.work_order.assignment.person); setDue(v.work_order.assignment.due_date); } }, [v?.work_order.assignment]);

  if (error) return <Empty icon={<FileQuestion size={22} />} title="Work order not found" body={error} />;
  if (!v) return <div className="space-y-4"><Skeleton className="h-16 w-96" /><Skeleton className="h-60" /></div>;
  const wo = v.work_order;
  const a = wo.assignment;
  const isReviewerRole = user.role === "engineer" || user.role === "asset_owner";
  const isWorker = user.role === "maintenance" && a?.person === user.name;
  const people = dir?.teams.find((t) => t.name === team)?.people ?? [];
  const body = { actor: user.name, role: user.role };
  const act = async (fn: () => Promise<unknown>, ok: string, after?: () => void) => {
    setBusy(true); setErr(null);
    try { await fn(); await reload(); await reloadInc(); await refresh(); pushToast({ tone: "blue", title: ok }); after?.(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };
  const toB64 = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] ?? ""); r.onerror = () => rej(new Error("Could not read the file")); r.readAsDataURL(f); });

  const status = wo.status;
  const canAssign = isReviewerRole && ["approved", "assigned", "in_progress", "returned"].includes(status);
  const canWork = isWorker && ["assigned", "in_progress", "returned"].includes(status);
  const canReview = isReviewerRole && status === "awaiting_verification";
  const fileMeta = wo.completion?.attachment;

  return (
    <div className="space-y-5">
      <div>
        <Breadcrumbs items={[{ label: "Work Orders", href: "/work-orders" }, { label: <span className="num">{wo.work_order_id}</span> }]} />
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="num text-xl font-semibold tracking-tight">{wo.work_order_id}</h1>
          <Badge tone={STATUS_TONE[status] ?? "neutral"} className="text-xs">{WO_STATUS_LABEL[status] ?? status}</Badge>
          <Badge tone={wo.priority === "P1" ? "red" : "neutral"}>{wo.priority} · {wo.timeframe}</Badge>
          {v.overdue && <Badge tone="red" icon={<AlertTriangle size={11} />}>Overdue{v.escalated ? " · escalated" : ""}</Badge>}
          <SimulatedTag />
        </div>
        <p className="mt-1 text-sm text-muted">Linked incident <Link href={`/incidents/${v.incident_id}`} className="num text-blue hover:underline">{v.incident_id}</Link> · {inc?.asset.name ?? v.asset_id} · simulated date <span className="num">{v.sim_date}</span></p>
      </div>

      <Card className={cx(v.next_action.urgent && "border-amber/50")}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
          <p className="text-sm"><span className="text-xs font-semibold uppercase tracking-wider text-faint">Next required action</span><br /><b className={v.next_action.urgent ? "text-amber" : "text-text"}>{v.next_action.label}</b> <span className="text-muted">— by {v.next_action.by}</span></p>
          <p className="text-xs text-muted">Acting as <b className="text-text">{user.name}</b></p>
        </div>
      </Card>
      {err && <p role="alert" className="rounded-md border border-red/40 bg-red-soft p-3 text-sm text-red">{err}</p>}

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Preventive action" subtitle="A proposal for qualified people. InfraGuard does not perform or certify any work." />
            <div className="space-y-4 p-5">
              <p className="text-sm text-text">{wo.reason}</p>
              <ol className="space-y-2">{wo.steps.map((s) => (
                <li key={s.order} className="flex gap-3"><span className="num mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-raised text-xs text-muted">{s.order}</span>
                  <div><p className="text-sm text-text">{s.action}</p><p className="text-xs text-muted">{s.rationale}</p></div></li>))}</ol>
              <div><p className="text-[11px] font-semibold uppercase tracking-wider text-faint">The inspection should provide</p>
                <ul className="mt-1 space-y-1">{wo.required_evidence.map((r) => <li key={r} className="text-xs text-muted">• {r}</li>)}</ul></div>
            </div>
          </Card>

          {(wo.completion || wo.review) && (
            <Card>
              <CardHeader title="Completion evidence" subtitle="Submitted by the responsible person — not verified until a reviewer decides" />
              <div className="space-y-3 p-5 text-sm">
                {wo.completion && <>
                  <p className="text-text">{wo.completion.note}</p>
                  <p className="text-xs text-muted">Submitted by <b className="text-text">{wo.completion.submitted_by}</b> · <span className="num">{fmtWall(wo.completion.submitted_at)}</span></p>
                  {fileMeta && <p className="text-xs"><FileUp size={12} className="mr-1 inline text-blue" /><a className="text-blue hover:underline" href={`/api/work-orders/${wo.work_order_id}/evidence-file`} target="_blank" rel="noreferrer">{fileMeta.filename}</a> <span className="text-faint">· {(fileMeta.size / 1024).toFixed(1)} KB · sha256 {fileMeta.sha256.slice(0, 10)}…</span></p>}
                </>}
                {wo.review && (
                  <p className={cx("rounded-md border p-3 text-xs", wo.review.decision === "verified" ? "border-blue/40 bg-blue-soft text-text" : "border-amber/40 bg-amber-soft text-text")}>
                    <b>{wo.review.decision === "verified" ? "Verified" : "Further work requested"}</b> by {wo.review.reviewer} at <span className="num">{fmtWall(wo.review.at)}</span>{wo.review.reason && <> — {wo.review.reason}</>}
                  </p>
                )}
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-5">
          {status === "proposed" && (
            <Card className="border-amber/40" data-coach="approve">
              <CardHeader title="Approval" subtitle="Not a live work order until a human approves it" />
              <div className="space-y-3 p-5">
                {!isReviewerRole ? <p className="flex items-center gap-2 text-sm text-muted"><Lock size={14} /> Only an engineer or asset owner can approve or reject. Switch the demo user in the top bar.</p> : rejecting ? (
                  <>
                    <Field label="Reason for rejection (required)"><input className={inputCls} value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} /></Field>
                    <div className="flex gap-2"><Button variant="danger" disabled={busy || !rejectNote.trim()} onClick={() => act(() => post(`/api/incidents/${v.incident_id}/decision`, { ...body, decision: "reject", note: rejectNote }), `${wo.work_order_id} rejected`)}><ThumbsDown size={14} /> Confirm reject</Button>
                      <Button variant="ghost" onClick={() => setRejecting(false)}>Cancel</Button></div>
                  </>
                ) : (
                  <div className="flex gap-2">
                    <Button variant="primary" disabled={busy} onClick={() => act(() => post(`/api/incidents/${v.incident_id}/decision`, { ...body, decision: "approve", note: "" }), `${wo.work_order_id} approved by ${user.name}`)}><Check size={14} /> Approve</Button>
                    <Button variant="danger" disabled={busy} onClick={() => setRejecting(true)}><ThumbsDown size={14} /> Reject</Button>
                  </div>
                )}
                {inc && inc.incident.state !== "AWAITING_APPROVAL" && <p className="text-xs text-muted">The investigation is not yet at its final stage — <Link className="text-blue hover:underline" href={`/incidents/${v.incident_id}`}>continue it</Link> first.</p>}
              </div>
            </Card>
          )}

          <Card>
            <CardHeader title="Accountability" icon={<UserCheck size={15} />} />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 p-5 text-xs">
              <div><dt className="text-faint">Approved by</dt><dd className="mt-0.5 text-sm text-text">{wo.approved_by ?? "—"}</dd></div>
              <div><dt className="text-faint">Approved at</dt><dd className="num mt-0.5 text-sm text-text">{wo.approved_at ? fmtWall(wo.approved_at) : "—"}</dd></div>
              <div><dt className="text-faint">Maintenance team</dt><dd className="mt-0.5 text-sm text-text">{a?.team ?? "—"}</dd></div>
              <div><dt className="text-faint">Responsible person</dt><dd className="mt-0.5 text-sm text-text">{a?.person ?? "—"}</dd></div>
              <div><dt className="text-faint">Due date</dt><dd className={cx("num mt-0.5 text-sm", v.overdue ? "font-semibold text-red" : "text-text")}>{a?.due_date ?? "—"}</dd></div>
              <div><dt className="text-faint">Assigned by</dt><dd className="mt-0.5 text-sm text-text">{a?.assigned_by ?? "—"}</dd></div>
            </dl>
            {wo.delay_reason && <p className="mx-5 mb-4 rounded-md border border-amber/40 bg-amber-soft p-2.5 text-xs text-text"><b>Reported delay:</b> {wo.delay_reason}</p>}
            {v.overdue && <p className="mx-5 mb-4 rounded-md border border-red/40 bg-red-soft p-2.5 text-xs text-red">Past its due date on the simulated clock{v.escalated ? "; an escalation event was recorded." : "."}</p>}
          </Card>

          {canAssign && (!a || reassign || status === "approved" || status === "returned") && (
            <Card data-coach="assign">
              <CardHeader title={a ? "Reassign" : "Assign"} subtitle="Fictional demo teams and officers" />
              <form className="space-y-3 p-5" onSubmit={(e) => { e.preventDefault(); act(() => post(`/api/work-orders/${wo.work_order_id}/assign`, { ...body, team, person, due_date: due }), a ? "Assignment updated" : `Assigned to ${person}`, () => setReassign(false)); }}>
                <Field label="Maintenance team"><select className={inputCls} value={team} onChange={(e) => { setTeam(e.target.value); setPerson(""); }} required><option value="">Select team…</option>{dir?.teams.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}</select></Field>
                <Field label="Responsible person"><select className={inputCls} value={person} onChange={(e) => setPerson(e.target.value)} required disabled={!team}><option value="">Select person…</option>{people.map((p) => <option key={p}>{p}</option>)}</select></Field>
                <Field label="Due date"><input type="date" className={inputCls} value={due} min={v.sim_date} onChange={(e) => setDue(e.target.value)} required /></Field>
                <Button type="submit" variant="primary" disabled={busy || !team || !person || !due}><ClipboardCheck size={14} /> {a ? "Update assignment" : "Assign"}</Button>
              </form>
            </Card>
          )}
          {canAssign && a && !reassign && status !== "approved" && status !== "returned" && <Button onClick={() => setReassign(true)}><RotateCcw size={14} /> Reassign or change due date</Button>}

          {canWork && (
            <>
              <Card>
                <CardHeader title="Progress update" subtitle={`Responsible person only (${a?.person})`} />
                <form className="space-y-3 p-5" onSubmit={(e) => { e.preventDefault(); act(() => post(`/api/work-orders/${wo.work_order_id}/progress`, { ...body, note, delay_reason: delay }), "Progress recorded", () => { setNote(""); setDelay(""); }); }}>
                  <Field label="What has been done"><textarea className={cx(inputCls, "h-20 py-2")} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
                  <Field label="Delay reason (optional)"><input className={inputCls} value={delay} onChange={(e) => setDelay(e.target.value)} /></Field>
                  <Button type="submit" disabled={busy || (!note.trim() && !delay.trim())}>Record progress</Button>
                </form>
              </Card>
              <Card>
                <CardHeader title="Submit completion evidence" subtitle="Moves the work order to Awaiting Verification — it is not verified automatically" />
                <form className="space-y-3 p-5" onSubmit={(e) => { e.preventDefault(); act(async () => {
                  const attachment = file ? { filename: file.name, content_type: file.type || "application/octet-stream", data_base64: await toB64(file) } : null;
                  await post(`/api/work-orders/${wo.work_order_id}/evidence`, { ...body, note: reason, attachment });
                }, "Evidence submitted for verification", () => { setReason(""); setFile(null); }); }}>
                  <Field label="Completion note (required)"><textarea className={cx(inputCls, "h-20 py-2")} value={reason} onChange={(e) => setReason(e.target.value)} required /></Field>
                  <Field label="Evidence file (photo, PDF or text — up to 3 MB)"><input type="file" accept="image/png,image/jpeg,application/pdf,text/plain" className="text-xs text-muted" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label="Evidence file" /></Field>
                  <Button type="submit" variant="primary" disabled={busy || !reason.trim()}><FileUp size={14} /> Submit evidence</Button>
                </form>
              </Card>
            </>
          )}
          {!canWork && ["assigned", "in_progress", "returned"].includes(status) && <p className="flex items-center gap-2 text-xs text-muted"><Lock size={12} /> Progress and evidence can only be recorded by {a?.person ?? "the responsible person"}. Switch the demo user in the top bar to act as them.</p>}

          {canReview && (
            <Card className="border-amber/40" data-coach="verify">
              <CardHeader title="Verification" subtitle="You are the reviewer; the person who submitted the evidence cannot verify it" />
              <div className="space-y-3 p-5">
                <Field label="Reason (required for further work)"><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" disabled={busy} onClick={() => act(() => post(`/api/work-orders/${wo.work_order_id}/review`, { ...body, decision: "verify", reason }), "Completion verified", () => setReason(""))}><Check size={14} /> Verify Completion</Button>
                  <Button disabled={busy || !reason.trim()} onClick={() => act(() => post(`/api/work-orders/${wo.work_order_id}/review`, { ...body, decision: "further_work", reason }), "Further work requested", () => setReason(""))}><RotateCcw size={14} /> Request Further Work</Button>
                </div>
              </div>
            </Card>
          )}
          {status === "awaiting_verification" && !canReview && <p className="flex items-center gap-2 text-xs text-muted"><Lock size={12} /> Waiting for an engineer or asset owner to verify.</p>}
        </div>
      </div>

      <History id={wo.work_order_id} count={v.history_count} open={histOpen} setOpen={setHistOpen} />
    </div>
  );
}
