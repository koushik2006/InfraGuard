"use client";

import { ArrowRight, Check, ClipboardCheck, FileUp, Loader2, Plus, RotateCcw, Save, ThumbsDown, ThumbsUp, Trash2, UserCheck, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Card } from "@/components/ui";
import { post, useApi } from "@/lib/api";
import { cx, fmtWall } from "@/lib/format";
import type { Directory, WorkOrderEvent } from "@/lib/types";
import { Instructions, FindingsTable, Facts, Field, ReportPanel, StageCard, Waiting, areaCls, inputCls, isAssignee, isEngineer, type StageProps } from "./shared";

const lines = (t: string) => t.split("\n").map((x) => x.trim()).filter(Boolean);

// ------------------------------------------------------------------ Stage 1 — Engineer review and approval
export function ReviewStage(p: StageProps) {
  const { v, inc, user, busy, act, body } = p;
  const wo = v.work_order;
  const eng = isEngineer(user.role);
  const orig = useMemo(() => ({ steps: wo.steps.map((s) => s.action), reason: wo.reason, timeframe: wo.timeframe, ev: wo.required_evidence.join("\n"), pre: wo.precautions.join("\n"), acc: wo.acceptance_criteria.join("\n") }), [wo]);
  const [steps, setSteps] = useState<string[]>(orig.steps);
  const [reason, setReason] = useState(orig.reason);
  const [timeframe, setTimeframe] = useState(orig.timeframe);
  const [ev, setEv] = useState(orig.ev);
  const [pre, setPre] = useState(orig.pre);
  const [acc, setAcc] = useState(orig.acc);
  const [rejecting, setRejecting] = useState(false);
  const [why, setWhy] = useState("");
  useEffect(() => { setSteps(orig.steps); setReason(orig.reason); setTimeframe(orig.timeframe); setEv(orig.ev); setPre(orig.pre); setAcc(orig.acc); }, [orig]);
  const dirty = JSON.stringify([steps.map((s) => s.trim()).filter(Boolean), reason.trim(), timeframe.trim(), lines(ev), lines(pre), lines(acc)]) !==
    JSON.stringify([orig.steps, orig.reason, orig.timeframe, lines(orig.ev), lines(orig.pre), lines(orig.acc)]);
  const f = inc?.event.findings ?? [];

  return (
    <StageCard n={1} title="Engineer review and approval" subtitle="Review the investigation and the proposed preventive work, edit the instructions if needed, then approve or reject.">
      <div className="rounded-lg border border-line bg-raised/40 p-4 text-sm">
        <p className="text-text"><b>{f.length} finding{f.length === 1 ? "" : "s"}</b> from {new Set(f.map((x) => x.sensor_id)).size} sensors{inc && <> · {inc.asset.name} · priority <b>{wo.priority}</b> ({wo.timeframe})</>}.
          <Link href={`/incidents/${wo.incident_id}`} className="ml-2 text-blue hover:underline">Open the investigation</Link></p>
      </div>
      <FindingsTable inc={inc} />
      <ReportPanel v={v} label="Resource Planner report" defaultOpen />
      {!eng ? <Waiting v={v} /> : (
        <>
          <div className="space-y-4 rounded-lg border border-line p-4">
            <div className="flex items-center justify-between"><p className="text-sm font-semibold text-text">Work instructions {wo.revision > 1 && <Badge tone="blue">edited · revision {wo.revision}</Badge>}</p>
              <p className="text-[11px] text-faint">Edits create a new report version.</p></div>
            <Field label="Reason for the work"><textarea className={areaCls} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            <div>
              <p className="mb-1 text-xs font-medium text-muted">Tasks for the officer</p>
              <ol className="space-y-2">
                {steps.map((s, i) => (
                  <li key={i} className="flex items-start gap-2"><span className="num mt-2 w-5 text-xs text-faint">{i + 1}</span>
                    <textarea aria-label={`Task ${i + 1}`} className={areaCls} rows={2} value={s} onChange={(e) => setSteps(steps.map((x, j) => (j === i ? e.target.value : x)))} />
                    <button type="button" aria-label={`Remove task ${i + 1}`} onClick={() => setSteps(steps.filter((_, j) => j !== i))} className="mt-1.5 rounded p-1.5 text-faint hover:bg-raised hover:text-red"><Trash2 size={14} /></button></li>
                ))}
              </ol>
              <Button size="sm" className="mt-2" onClick={() => setSteps([...steps, ""])}><Plus size={13} /> Add task</Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Response time-frame"><input className={inputCls} value={timeframe} onChange={(e) => setTimeframe(e.target.value)} /></Field>
              <Field label="Expected completion evidence (one per line)"><textarea className={areaCls} rows={3} value={ev} onChange={(e) => setEv(e.target.value)} /></Field>
              <Field label="Precautions (one per line, optional)"><textarea className={areaCls} rows={3} value={pre} onChange={(e) => setPre(e.target.value)} /></Field>
              <Field label="Acceptance criteria (one per line, optional)"><textarea className={areaCls} rows={3} value={acc} onChange={(e) => setAcc(e.target.value)} /></Field>
            </div>
            <Button disabled={busy || !dirty} onClick={() => act(() => post(`/api/work-orders/${wo.work_order_id}/edit`, { ...body, edits: { steps, reason, timeframe, required_evidence: lines(ev), precautions: lines(pre), acceptance_criteria: lines(acc) } }), "Instructions saved — new report version generated")}>
              <Save size={14} /> Save edits</Button>
          </div>
          <div className="rounded-lg border border-amber/40 bg-amber-soft/40 p-4" data-coach="approve">
            <p className="mb-2 text-xs font-semibold text-amber">Pending approval — nothing is authorised until you decide.</p>
            {rejecting ? (
              <div className="flex flex-wrap gap-2">
                <input aria-label="Rejection reason" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Reason for rejection (required)" className={cx(inputCls, "min-w-[260px] flex-1")} />
                <Button variant="danger" disabled={busy || why.trim().length < 3} onClick={() => act(() => post(`/api/incidents/${wo.incident_id}/decision`, { ...body, decision: "reject", note: why }), `${wo.work_order_id} rejected`)}><ThumbsDown size={14} /> Confirm rejection</Button>
                <Button variant="ghost" onClick={() => setRejecting(false)}>Cancel</Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="primary" disabled={busy || dirty} onClick={() => act(() => post(`/api/incidents/${wo.incident_id}/decision`, { ...body, decision: "approve", note: "" }), `${wo.work_order_id} approved by ${user.name}`)}><Check size={14} /> Approve Work Order</Button>
                <Button variant="danger" disabled={busy} onClick={() => setRejecting(true)}><ThumbsDown size={14} /> Reject Work Order</Button>
                {dirty && <span className="text-xs text-amber">Save your edits before approving, so the approved version is exactly what the officer receives.</span>}
              </div>
            )}
          </div>
        </>
      )}
    </StageCard>
  );
}

// ------------------------------------------------------------------ Stage 2 — Assignment
export function AssignForm({ v, busy, act, body, label = "Assign" }: Pick<StageProps, "v" | "busy" | "act" | "body"> & { label?: string }) {
  const { data: dir } = useApi<Directory>("/api/directory");
  const a = v.work_order.assignment;
  const [team, setTeam] = useState(a?.team ?? "");
  const [person, setPerson] = useState(a?.person ?? "");
  const [due, setDue] = useState(a?.due_date ?? "");
  const people = dir?.teams.find((t) => t.name === team)?.people ?? [];
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); act(() => post(`/api/work-orders/${v.work_order.work_order_id}/assign`, { ...body, team, person, due_date: due }), `Assigned to ${person}`); }}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Maintenance team"><select className={inputCls} value={team} onChange={(e) => { setTeam(e.target.value); setPerson(""); }} required><option value="">Select team…</option>{dir?.teams.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}</select></Field>
        <Field label="Responsible officer"><select className={inputCls} value={person} onChange={(e) => setPerson(e.target.value)} required disabled={!team}><option value="">Select officer…</option>{people.map((x) => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Due date"><input type="date" className={inputCls} value={due} min={v.sim_date} onChange={(e) => setDue(e.target.value)} required /></Field>
      </div>
      <Button type="submit" variant="primary" disabled={busy || !team || !person || !due}><ClipboardCheck size={14} /> {label}</Button>
    </form>
  );
}

export function AssignStage(p: StageProps) {
  const { v, user } = p;
  const wo = v.work_order;
  return (
    <StageCard n={2} title="Assignment" subtitle="The work order is approved. Assign a maintenance team, a responsible officer and a due date.">
      {wo.last_decline && (
        <div role="status" className="rounded-md border border-amber/40 bg-amber-soft p-3 text-sm text-text"><b>{wo.last_decline.person} declined this assignment</b> ({fmtWall(wo.last_decline.at)}): {wo.last_decline.reason}. Reassign or review the work.</div>
      )}
      <Facts v={v} />
      <Instructions v={v} />
      <ReportPanel v={v} label="Final approved report" />
      {isEngineer(user.role) ? <div className="rounded-lg border border-line p-4" data-coach="assign"><AssignForm {...p} /></div> : <Waiting v={v} />}
    </StageCard>
  );
}

// ------------------------------------------------------------------ Stage 3 — Officer receives and accepts
export function AcceptStage(p: StageProps) {
  const { v, inc, user, busy, act, body } = p;
  const wo = v.work_order;
  const mine = isAssignee(v, user);
  const [declining, setDeclining] = useState(false);
  const [why, setWhy] = useState("");
  const [change, setChange] = useState(false);
  return (
    <StageCard n={3} title="Officer receives the job" subtitle="Review the report and instructions, then accept or decline the assignment.">
      <Facts v={v} />
      <p className="text-sm text-text">{inc ? <>Incident <Link href={`/incidents/${wo.incident_id}`} className="num text-blue hover:underline">{wo.incident_id}</Link> on {inc.asset.name}: {inc.event.findings.length} sensor findings.</> : null}</p>
      <FindingsTable inc={inc} />
      <ReportPanel v={v} label="Report for the assigned officer" defaultOpen={mine} />
      <Instructions v={v} />
      {mine ? (
        <div className="rounded-lg border border-amber/40 bg-amber-soft/40 p-4" data-coach="accept">
          <p className="mb-2 text-xs font-semibold text-amber">Waiting for your decision, {user.name}.</p>
          {declining ? (
            <div className="flex flex-wrap gap-2">
              <input aria-label="Decline reason" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Reason for declining (required)" className={cx(inputCls, "min-w-[260px] flex-1")} />
              <Button variant="danger" disabled={busy || why.trim().length < 3} onClick={() => act(() => post(`/api/work-orders/${wo.work_order_id}/decline`, { ...body, reason: why }), "Assignment declined — returned to the engineer")}><ThumbsDown size={14} /> Confirm decline</Button>
              <Button variant="ghost" onClick={() => setDeclining(false)}>Cancel</Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" disabled={busy} onClick={() => act(() => post(`/api/work-orders/${wo.work_order_id}/accept`, body), "Assignment accepted")}><UserCheck size={14} /> Accept Assignment</Button>
              <Button variant="danger" disabled={busy} onClick={() => setDeclining(true)}><X size={14} /> Decline Assignment</Button>
            </div>
          )}
        </div>
      ) : (
        <>
          <Waiting v={v} />
          {isEngineer(user.role) && (
            <div>
              <Button size="sm" onClick={() => setChange(!change)}>{change ? "Hide" : "Change assignment"}</Button>
              {change && <div className="mt-3 rounded-lg border border-line p-4"><AssignForm {...p} label="Update assignment" /></div>}
            </div>
          )}
        </>
      )}
    </StageCard>
  );
}

// ------------------------------------------------------------------ Stage 4 — Work execution
export function ExecutionStage(p: StageProps) {
  const { v, inc, user, busy, act, body } = p;
  const wo = v.work_order;
  const mine = isAssignee(v, user);
  const [note, setNote] = useState("");
  const [delay, setDelay] = useState("");
  const [draft, setDraft] = useState(wo.completion_draft ?? "");
  useEffect(() => setDraft(wo.completion_draft ?? ""), [wo.completion_draft]);
  return (
    <StageCard n={4} title="Work execution" subtitle="Carry out the approved instructions and record progress. Proceed to evidence submission when the work is done.">
      {wo.status === "returned" && wo.review && (
        <div role="status" className="rounded-md border border-amber/40 bg-amber-soft p-3 text-sm text-text" data-testid="further-work-banner"><b>Further work requested by {wo.review.reviewer}</b> ({fmtWall(wo.review.at)}): {wo.review.reason}
          <span className="mt-1 block text-xs text-muted">Correct this and submit a new evidence version (the previous submission is kept in the history).</span></div>
      )}
      <Facts v={v} />
      <p className="text-xs text-muted">Status: <b className="text-text">{wo.status === "accepted" ? "Accepted — not started" : wo.status === "returned" ? "Returned for further work" : "In progress"}</b>{wo.delay_reason && <> · reported delay: {wo.delay_reason}</>}</p>
      <Instructions v={v} />
      <FindingsTable inc={inc} />
      {mine ? (
        <>
          <form className="space-y-3 rounded-lg border border-line p-4" onSubmit={(e) => { e.preventDefault(); act(async () => { await post(`/api/work-orders/${wo.work_order_id}/progress`, { ...body, note, delay_reason: delay, completion_note: draft }); setNote(""); setDelay(""); }, "Progress recorded"); }}>
            <p className="text-sm font-semibold text-text">Record progress</p>
            <Field label="What has been done"><textarea className={areaCls} rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            <Field label="Delay or issue (optional)"><input className={inputCls} value={delay} onChange={(e) => setDelay(e.target.value)} /></Field>
            <Field label="Completion note (draft — you can finish it in the next stage)"><textarea className={areaCls} rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} /></Field>
            <Button type="submit" disabled={busy || (!note.trim() && !delay.trim() && !draft.trim())}>Save progress</Button>
          </form>
          <div className="flex justify-end">
            <Button variant="primary" disabled={busy} onClick={() => act(() => post(`/api/work-orders/${wo.work_order_id}/evidence-stage`, { ...body, completion_note: draft }), "Evidence submission opened")}>Proceed to evidence submission <ArrowRight size={14} /></Button>
          </div>
        </>
      ) : <Waiting v={v} />}
    </StageCard>
  );
}

// ------------------------------------------------------------------ Stage 5 — Evidence submission
const EXT_TYPE: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", txt: "text/plain" };
const TYPE_LABEL: Record<string, string> = { "application/pdf": "PDF", "image/png": "PNG image", "image/jpeg": "JPEG image", "text/plain": "Text" };
const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const toB64 = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] ?? ""); r.onerror = () => rej(new Error("The file could not be read")); r.readAsDataURL(f); });

export function EvidenceStage(p: StageProps) {
  const { v, user, busy, act, body } = p;
  const wo = v.work_order;
  const mine = isAssignee(v, user);
  const [note, setNote] = useState(wo.completion_draft ?? "");
  const [none, setNone] = useState(false);
  const [noneWhy, setNoneWhy] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [up, setUp] = useState<{ name: string; state: "uploading" | "error"; msg?: string } | null>(null);
  const [replacing, setReplacing] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const pending = v.pending_attachments;
  const lim = v.limits;

  const choose = async (file: File | undefined) => {
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const type = file.type && lim.allowed_types.includes(file.type) ? file.type : EXT_TYPE[ext];
    if (!type || !lim.allowed_types.includes(type)) { setUp({ name: file.name, state: "error", msg: "Unsupported file type. Attach a PDF report (or a PNG/JPEG photo, or a plain-text file)." }); return; }
    if (file.size > lim.max_upload_bytes) { setUp({ name: file.name, state: "error", msg: `This file is ${kb(file.size)}; the limit is ${kb(lim.max_upload_bytes)}.` }); return; }
    if (file.size === 0) { setUp({ name: file.name, state: "error", msg: "The file is empty." }); return; }
    setUp({ name: file.name, state: "uploading" });
    const ok = await act(async () => post(`/api/work-orders/${wo.work_order_id}/attachments`, { ...body, filename: file.name, content_type: type, data_base64: await toB64(file), replaces: replacing }), replacing ? "File replaced" : "File uploaded");
    setUp(ok ? null : { name: file.name, state: "error", msg: "Upload failed — see the message above. Nothing was attached." });
    setReplacing(null);
  };
  const pick = (replaceId: string | null) => { setReplacing(replaceId); setUp(null); if (input.current) { input.current.value = ""; input.current.click(); } };
  const canSubmit = note.trim().length >= 10 && (pending.length > 0 || (none && noneWhy.trim().length >= 5));

  return (
    <StageCard n={5} title="Evidence submission" subtitle="Submit your completion note and the inspection or maintenance report(s). The engineer reviews them next.">
      <Instructions v={v} heading="Approved instructions" />
      {!mine ? <Waiting v={v} /> : confirm ? (
        <div className="space-y-4 rounded-lg border border-amber/40 bg-amber-soft/30 p-4" data-testid="submission-review">
          <p className="text-sm font-semibold text-text">Review your submission before finalising</p>
          <div><p className="text-[11px] font-semibold uppercase tracking-wider text-faint">Completion note</p><p className="mt-1 whitespace-pre-wrap text-sm text-text">{note}</p></div>
          <div><p className="text-[11px] font-semibold uppercase tracking-wider text-faint">Attachments ({pending.length})</p>
            {pending.length ? <ul className="mt-1 space-y-1">{pending.map((a) => <li key={a.attachment_id} className="text-sm text-text">{a.filename} <span className="text-xs text-muted">· {TYPE_LABEL[a.content_type] ?? a.content_type} · {kb(a.size)}</span></li>)}</ul>
              : <p className="mt-1 text-sm text-text">None — {noneWhy}</p>}</div>
          <p className="text-xs text-muted">Submitting as <b className="text-text">{user.name}</b>. After submission the files are locked and the work order moves to engineer approval.</p>
          <div className="flex gap-2">
            <Button variant="primary" disabled={busy} onClick={() => act(() => post(`/api/work-orders/${wo.work_order_id}/evidence`, { ...body, note, no_attachment_reason: pending.length ? "" : noneWhy }), "Evidence submitted for engineer approval")}><Check size={14} /> Finalise and submit</Button>
            <Button variant="ghost" onClick={() => setConfirm(false)}>Back to edit</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4 rounded-lg border border-line p-4">
          <Field label="Completion note — describe the work performed (required)"><textarea className={areaCls} rows={4} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <div>
            <p className="mb-1 text-xs font-medium text-muted">Attachments — PDF inspection / maintenance reports (images and text accepted) · max {kb(lim.max_upload_bytes)} each · up to {lim.max_files} files</p>
            <input ref={input} type="file" aria-label="Choose evidence file" data-testid="evidence-file-input" className="sr-only" tabIndex={-1} accept=".pdf,.png,.jpg,.jpeg,.txt,application/pdf,image/png,image/jpeg,text/plain" onChange={(e) => { void choose(e.target.files?.[0]); e.currentTarget.value = ""; }} />
            <Button type="button" disabled={busy || pending.length >= lim.max_files} onClick={() => pick(null)}><FileUp size={14} /> Attach File</Button>
            {up && (
              <p role={up.state === "error" ? "alert" : "status"} className={cx("mt-2 flex items-center gap-2 rounded-md border p-2 text-xs", up.state === "error" ? "border-red/40 bg-red-soft text-red" : "border-blue/30 bg-blue-soft text-blue")}>
                {up.state === "uploading" ? <><Loader2 size={13} className="animate-spin" /> Uploading {up.name}…</> : <><X size={13} /> {up.name}: {up.msg}</>}</p>
            )}
            <ul className="mt-3 space-y-2" aria-label="Attached files">
              {pending.map((a) => (
                <li key={a.attachment_id} data-attachment={a.filename} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-surface px-3 py-2 text-sm">
                  <span className="min-w-0"><b className="text-text">{a.filename}</b> <span className="text-xs text-muted">· {TYPE_LABEL[a.content_type] ?? a.content_type} · {kb(a.size)}</span> <Badge tone="blue">Uploaded</Badge></span>
                  <span className="flex gap-1">
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => pick(a.attachment_id)}><RotateCcw size={12} /> Replace</Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(() => post(`/api/work-orders/${wo.work_order_id}/attachments/${a.attachment_id}/remove`, body), `${a.filename} removed`)}><Trash2 size={12} /> Remove</Button>
                  </span>
                </li>
              ))}
              {pending.length === 0 && <li className="text-xs text-faint">No file attached yet.</li>}
            </ul>
            {pending.length === 0 && (
              <div className="mt-3 text-xs">
                <label className="flex items-center gap-2 text-muted"><input type="checkbox" checked={none} onChange={(e) => setNone(e.target.checked)} /> No document applies to this work</label>
                {none && <input aria-label="Why no document applies" className={cx(inputCls, "mt-2")} value={noneWhy} onChange={(e) => setNoneWhy(e.target.value)} placeholder="Explain why no document is attached (required)" />}
              </div>
            )}
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => act(() => post(`/api/work-orders/${wo.work_order_id}/back-to-execution`, body), "Back to work execution")}>Back to work execution</Button>
            <Button variant="primary" disabled={busy || !canSubmit} onClick={() => setConfirm(true)}>Review submission <ArrowRight size={14} /></Button>
          </div>
        </div>
      )}
    </StageCard>
  );
}

// ------------------------------------------------------------------ Stage 6 — Engineer reviews evidence
export function EvidenceReviewStage(p: StageProps) {
  const { v, user, busy, act, body } = p;
  const wo = v.work_order;
  const c = wo.completion;
  const eng = isEngineer(user.role);
  const [reason, setReason] = useState("");
  const { data: hist } = useApi<WorkOrderEvent[]>(`/api/work-orders/${wo.work_order_id}/history`, wo.status);
  const self = eng && (user.name === c?.submitted_by || user.name === wo.assignment?.person);
  return (
    <StageCard n={6} title="Engineer reviews the evidence" subtitle="Compare the submitted evidence with the approved instructions, then approve it or request further work.">
      {c && (
        <div className="space-y-3 rounded-lg border border-line p-4" data-testid="submitted-evidence">
          <p className="text-sm font-semibold text-text">Submitted evidence <Badge tone="neutral">version {c.version}</Badge></p>
          <p className="text-xs text-muted">By <b className="text-text">{c.submitted_by}</b> at <span className="num">{fmtWall(c.submitted_at)}</span></p>
          <div><p className="text-[11px] font-semibold uppercase tracking-wider text-faint">Completion note</p><p className="mt-1 whitespace-pre-wrap text-sm text-text">{c.note}</p></div>
          <div><p className="text-[11px] font-semibold uppercase tracking-wider text-faint">Attachments</p>
            {c.attachments.length ? (
              <ul className="mt-1 space-y-1">{c.attachments.map((a) => (
                <li key={a.attachment_id} className="text-sm"><a className="font-medium text-blue hover:underline" href={`/api/work-orders/${wo.work_order_id}/attachments/${a.attachment_id}/file`} target="_blank" rel="noreferrer" data-testid="evidence-link">{a.filename}</a>
                  <span className="text-xs text-muted"> · {TYPE_LABEL[a.content_type] ?? a.content_type} · {kb(a.size)} · sha256 {a.sha256.slice(0, 10)}…</span></li>))}</ul>
            ) : <p className="mt-1 text-sm text-text">No attachment — reason given: {c.no_attachment_reason}</p>}</div>
        </div>
      )}
      <Instructions v={v} heading="Original approved instructions" />
      {wo.acceptance_criteria.length > 0 && <p className="rounded-md border border-line bg-raised/40 p-3 text-xs text-muted">Compare the evidence against each acceptance criterion above and the expected completion evidence.</p>}
      <ReportPanel v={v} label="Approved report" />
      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-faint">Work-order history</p>
        <ol className="space-y-1 text-xs text-muted">{(hist ?? []).slice(-6).map((h) => <li key={h.id}><span className="num text-faint">{fmtWall(h.ts)}</span> · {h.summary}</li>)}</ol>
        <Link href={`/audit?work_order=${wo.work_order_id}`} className="mt-1 inline-block text-xs text-blue hover:underline">Open the full audit trail</Link>
      </div>
      {!eng ? <Waiting v={v} /> : self ? <p className="rounded-md border border-line p-3 text-sm text-muted">You did or submitted this work, so you cannot approve it. Another engineer or the asset owner must review it.</p> : (
        <div className="space-y-3 rounded-lg border border-amber/40 bg-amber-soft/30 p-4" data-coach="verify">
          <Field label="Reason (required to request further work)"><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What is missing or inadequate?" /></Field>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={busy} onClick={() => act(() => post(`/api/work-orders/${wo.work_order_id}/review`, { ...body, decision: "approve", reason }), "Evidence approved — job completed")}><ThumbsUp size={14} /> Approve Evidence</Button>
            <Button disabled={busy || reason.trim().length < 3} onClick={() => act(() => post(`/api/work-orders/${wo.work_order_id}/review`, { ...body, decision: "further_work", reason }), "Further work requested — returned to the officer")}><RotateCcw size={14} /> Request Further Work</Button>
          </div>
        </div>
      )}
    </StageCard>
  );
}

// ------------------------------------------------------------------ Stage 7 — Completed
export function CompletedStage({ v }: StageProps) {
  const wo = v.work_order;
  const c = wo.completion;
  const r = wo.review;
  return (
    <StageCard n={7} title="Job completed" subtitle="The engineer approved the evidence. The history stays available in the audit trail.">
      <div className="flex flex-wrap gap-3" data-testid="completed-status">
        <span className="inline-flex items-center gap-2 rounded-lg border border-blue/40 bg-blue-soft px-4 py-2 text-sm font-semibold text-blue"><Check size={16} /> Job Completed</span>
        {v.investigation_completed && <span className="inline-flex items-center gap-2 rounded-lg border border-blue/40 bg-blue-soft px-4 py-2 text-sm font-semibold text-blue"><Check size={16} /> Investigation Completed</span>}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-3">
        <div><dt className="text-faint">Work order</dt><dd className="num mt-0.5 text-sm text-text">{wo.work_order_id}</dd></div>
        <div><dt className="text-faint">Incident</dt><dd className="mt-0.5 text-sm"><Link href={`/incidents/${wo.incident_id}`} className="num text-blue hover:underline">{wo.incident_id}</Link></dd></div>
        <div><dt className="text-faint">Assigned officer</dt><dd className="mt-0.5 text-sm text-text">{wo.assignment?.person ?? "—"}</dd></div>
        <div><dt className="text-faint">Approving engineer</dt><dd className="mt-0.5 text-sm text-text">{r?.reviewer ?? "—"}</dd></div>
        <div><dt className="text-faint">Evidence approved</dt><dd className="num mt-0.5 text-sm text-text">{r ? fmtWall(r.at) : "—"}{r?.evidence_version ? ` (version ${r.evidence_version})` : ""}</dd></div>
        <div><dt className="text-faint">Evidence submitted</dt><dd className="num mt-0.5 text-sm text-text">{c ? fmtWall(c.submitted_at) : "—"}</dd></div>
      </dl>
      <div className="rounded-lg border border-line bg-raised/40 p-4 text-sm"><p className="text-[11px] font-semibold uppercase tracking-wider text-faint">Summary of the completed work</p>
        <p className="mt-1 text-text">{wo.reason}</p>{c && <p className="mt-2 whitespace-pre-wrap text-muted">Officer&apos;s note: {c.note}</p>}{r?.reason && <p className="mt-2 text-muted">Engineer&apos;s note: {r.reason}</p>}</div>
      <ReportPanel v={v} label="Final approved report" />
      {c && c.attachments.length > 0 && (
        <div><p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-faint">Submitted evidence</p>
          <ul className="space-y-1">{c.attachments.map((a) => <li key={a.attachment_id} className="text-sm"><a className="text-blue hover:underline" href={`/api/work-orders/${wo.work_order_id}/attachments/${a.attachment_id}/file`} target="_blank" rel="noreferrer">{a.filename}</a></li>)}</ul></div>
      )}
      <p className="rounded-md border border-line bg-raised/40 p-3 text-xs text-muted">Approval of the evidence closes this work order and investigation in the application. In this demo, the 3D model then shows a clearly labelled <b>simulated post-completion state</b>; it is not a physical measurement and does not by itself establish that the structure is safe.</p>
      <div className="flex flex-wrap gap-2">
        <Link href="/assets/BRG-017" data-testid="return-3d"><Button variant="primary">Return to 3D Bridge Model <ArrowRight size={14} /></Button></Link>
        <Link href={`/audit?work_order=${wo.work_order_id}`}><Button>View audit trail</Button></Link>
        <Link href={`/incidents/${wo.incident_id}`}><Button variant="ghost">View investigation</Button></Link>
      </div>
    </StageCard>
  );
}

export function RejectedStage({ v }: StageProps) {
  const wo = v.work_order;
  return (
    <Card><div className="p-5 text-sm"><p className="font-semibold text-text">This work order was rejected by the engineer.</p>
      <p className="mt-1 text-muted">It never became live and cannot be assigned. The decision and reason are in the audit trail.</p>
      <Link href={`/audit?work_order=${wo.work_order_id}`} className="mt-2 inline-block text-xs text-blue hover:underline">Open the audit trail</Link></div></Card>
  );
}
