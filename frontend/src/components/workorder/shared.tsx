"use client";

import { ExternalLink, FileText, Lock, Printer } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Card, CardHeader } from "@/components/ui";
import { cx, fmtWall } from "@/lib/format";
import type { IncidentDetail, Role, WorkOrderView } from "@/lib/types";

export const inputCls = "h-9 w-full rounded-md border border-line bg-surface px-3 text-sm text-text disabled:opacity-50";
export const areaCls = "w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-text disabled:opacity-50";

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="block text-xs"><span className="mb-1 block font-medium text-muted">{label}</span>{children}{hint && <span className="mt-1 block text-[11px] text-faint">{hint}</span>}</label>;
}

/** Everything a stage panel needs: the persisted work order, its incident and the acting demo user. */
export interface StageProps {
  v: WorkOrderView;
  inc: IncidentDetail | undefined;
  user: { name: string; role: Role };
  busy: boolean;
  act: (fn: () => Promise<unknown>, ok: string) => Promise<boolean>;
  body: { actor: string; role: Role };
}

export const isEngineer = (r: Role) => r === "engineer" || r === "asset_owner";
export const isAssignee = (v: WorkOrderView, u: { name: string; role: Role }) => u.role === "maintenance" && v.work_order.assignment?.person === u.name;

/** Shown when the current stage belongs to someone else: who owns it, and what they must do (demo: switch user in the top bar). */
export function Waiting({ v }: { v: WorkOrderView }) {
  return (
    <Card className="border-dashed">
      <div className="flex items-start gap-3 p-5">
        <Lock size={16} className="mt-0.5 text-faint" aria-hidden />
        <div className="text-sm">
          <p className="font-semibold text-text">This stage is waiting for {v.next_action.by || "another person"}</p>
          <p className="mt-0.5 text-muted">{v.next_action.label}</p>
          <p className="mt-2 text-xs text-faint">Demo: use the user selector in the top bar to act as that person. Roles are enforced by the backend.</p>
        </div>
      </div>
    </Card>
  );
}

export function StageCard({ n, title, subtitle, children }: { n: number; title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <Card data-stage-panel={n}>
      <CardHeader title={<span><span className="num mr-2 text-amber">Stage {n} of 7</span>{title}</span>} subtitle={subtitle} />
      <div className="space-y-5 p-5">{children}</div>
    </Card>
  );
}

export function Instructions({ v, heading = "Approved instructions" }: { v: WorkOrderView; heading?: string }) {
  const wo = v.work_order;
  const approved = !["proposed", "rejected"].includes(wo.status);
  return (
    <div className="space-y-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-faint">{approved ? heading : "Proposed instructions (not yet authorised)"}</p>
        <p className="mt-1 text-sm text-text">{wo.reason}</p>
        {approved && wo.approved_by && <p className="mt-1 text-xs text-muted">Approved by <b className="text-text">{wo.approved_by}</b> at <span className="num">{fmtWall(wo.approved_at)}</span>{wo.revision > 1 && <> · edited by the engineer (revision {wo.revision})</>}</p>}
      </div>
      <ol className="space-y-2">
        {wo.steps.map((s) => (
          <li key={s.order} className="flex gap-3"><span className="num mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-raised text-xs text-muted">{s.order}</span>
            <div className="min-w-0"><p className="text-sm text-text">{s.action}</p><p className="text-xs text-muted">{s.rationale}</p></div></li>
        ))}
      </ol>
      <div className="grid gap-4 sm:grid-cols-3">
        <ListBlock title="Expected completion evidence" items={wo.required_evidence} />
        <ListBlock title="Precautions" items={wo.precautions} empty="None defined by the engineer" />
        <ListBlock title="Acceptance criteria" items={wo.acceptance_criteria} empty="None defined by the engineer" />
      </div>
    </div>
  );
}

function ListBlock({ title, items, empty }: { title: string; items: string[]; empty?: string }) {
  return (
    <div><p className="text-[11px] font-semibold uppercase tracking-wider text-faint">{title}</p>
      {items.length ? <ul className="mt-1 space-y-1">{items.map((r) => <li key={r} className="text-xs text-muted">• {r}</li>)}</ul> : <p className="mt-1 text-xs text-faint">{empty ?? "—"}</p>}</div>
  );
}

export function Facts({ v }: { v: WorkOrderView }) {
  const wo = v.work_order, a = wo.assignment;
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-4">
      <div><dt className="text-faint">Priority</dt><dd className="mt-0.5 text-sm text-text">{wo.priority} · {wo.timeframe}</dd></div>
      <div><dt className="text-faint">Team</dt><dd className="mt-0.5 text-sm text-text">{a?.team ?? "Not assigned"}</dd></div>
      <div><dt className="text-faint">Responsible officer</dt><dd className="mt-0.5 text-sm text-text">{a?.person ?? "Not assigned"}</dd></div>
      <div><dt className="text-faint">Due date</dt><dd className={cx("num mt-0.5 text-sm", v.overdue ? "font-semibold text-red" : "text-text")}>{a?.due_date ?? "—"}{v.overdue && " · overdue"}</dd></div>
    </dl>
  );
}

/** Findings of the incident with their components — what the officer needs to know without reconstructing the investigation. */
export function FindingsTable({ inc }: { inc: IncidentDetail | undefined }) {
  const fs = inc?.event.findings ?? [];
  if (!fs.length) return null;
  return (
    <div className="overflow-x-auto">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-faint">Sensor findings and component locations (simulated)</p>
      <table className="w-full text-xs">
        <thead className="text-[10px] uppercase tracking-wider text-faint"><tr><th className="py-1 text-left font-medium">Sensor</th><th className="text-left font-medium">Component</th><th className="text-left font-medium">Role</th><th className="text-right font-medium">Observed</th><th className="text-right font-medium">Baseline</th><th className="text-right font-medium">z</th></tr></thead>
        <tbody>
          {fs.map((f) => (
            <tr key={f.sensor_id} className="border-t border-line-soft">
              <td className="py-1.5 font-mono font-semibold text-text">{f.sensor_id}</td><td className="text-muted">{f.component_name ?? f.location}</td>
              <td className="text-muted">{f.role}</td>
              <td className="num text-right text-text">{f.value.toFixed(3)} {f.unit}</td><td className="num text-right text-muted">{f.baseline_median.toFixed(3)}</td>
              <td className="num text-right text-amber">{f.z > 0 ? "+" : ""}{f.z.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[11px] text-faint">Strain, tilt and wind are context sensors: they support the picture but cannot raise an alert on their own.</p>
    </div>
  );
}

/** The generated Resource Planner report: preview, version picker, open / print as PDF. */
export function ReportPanel({ v, label = "Work order report", defaultOpen = false }: { v: WorkOrderView; label?: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [pick, setPick] = useState<number | null>(null);
  const latest = v.reports.at(-1)?.version;
  const ver = pick ?? latest;
  const id = v.work_order.work_order_id;
  const url = `/api/work-orders/${id}/report${ver ? `?version=${ver}` : ""}`;
  const meta = v.reports.find((r) => r.version === ver);
  return (
    <div className="rounded-lg border border-line bg-raised/40" data-testid="report-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2 text-sm"><FileText size={15} className="text-blue" aria-hidden /><b className="text-text">{label}</b>
          {meta && <Badge tone="neutral">v{meta.version} · {meta.kind}</Badge>}</div>
        <div className="flex flex-wrap items-center gap-2">
          {v.reports.length > 1 && (
            <select aria-label="Report version" value={ver ?? ""} onChange={(e) => setPick(Number(e.target.value))} className="h-8 rounded-md border border-line bg-surface px-2 text-xs">
              {v.reports.map((r) => <option key={r.version} value={r.version}>v{r.version} — {r.kind}</option>)}
            </select>
          )}
          <Button size="sm" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Hide preview" : "Preview report"}</Button>
          <a href={url} target="_blank" rel="noreferrer"><Button size="sm"><ExternalLink size={13} /> Open report</Button></a>
          <a href={url} target="_blank" rel="noreferrer" title="Opens the report; use its Print / Save as PDF button"><Button size="sm" variant="primary"><Printer size={13} /> Download / Print PDF</Button></a>
        </div>
      </div>
      {open && <iframe key={`${id}-${ver}-${v.work_order.status}`} src={url} title="Work order report preview" className="h-[560px] w-full rounded-b-lg border-t border-line bg-white" />}
    </div>
  );
}

export function ErrorLine({ msg }: { msg: string | null }) {
  return msg ? <p role="alert" className="rounded-md border border-red/40 bg-red-soft p-3 text-sm text-red">{msg}</p> : null;
}
