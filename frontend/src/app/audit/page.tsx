"use client";

import { ArrowDownUp, ChevronDown, FileText, Filter, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { Badge, Button, Card, Empty, PageHeader, SimulatedTag, Skeleton } from "@/components/ui";
import { useApi } from "@/lib/api";
import { cx, fmtWall } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { AuditEvent, AuditResp, WorkOrderRow } from "@/lib/types";

const sel = "h-9 w-full rounded-md border border-line bg-surface px-2 text-sm text-text";
const TONE: Record<string, "blue" | "amber" | "red" | "slate" | "violet" | "neutral"> = {
  proposed: "violet", approved: "blue", approved_with_edits: "blue", rejected: "slate", assignment_declined: "amber", further_work_requested: "amber",
  evidence_approved: "blue", work_order_completed: "blue", investigation_completed: "blue", overdue_escalation: "red", delay_reported: "amber",
};
const stateName = (s: string | null) => (s ? s.replace(/_/g, " ").toLowerCase() : "—");

function Detail({ e }: { e: AuditEvent }) {
  const d = e.detail as Record<string, unknown>;
  const files = ([] as { filename: string; size?: number; sha256?: string; attachment_id?: string }[]).concat((d.files as never) ?? [], d.file ? [d.file as never] : []);
  const reason = (d.reason ?? d.note ?? d.delay_reason ?? d.no_attachment_reason) as string | undefined;
  const changed = d.changed as string[] | undefined;
  const wo = e.work_order_id;
  return (
    <dl className="mt-3 grid gap-x-6 gap-y-3 text-xs sm:grid-cols-2" data-testid="audit-detail">
      <div><dt className="text-faint">Event ID</dt><dd className="num mt-0.5 text-text">{e.event_id}</dd></div>
      <div><dt className="text-faint">State change</dt><dd className="mt-0.5 text-text">{e.before || e.after ? <>{stateName(e.before)} <span className="text-faint">→</span> {stateName(e.after)}</> : "No state change"}</dd></div>
      <div><dt className="text-faint">Simulated clock</dt><dd className="num mt-0.5 text-text">{e.sim_time ? e.sim_time.replace("T", " ").replace("Z", " UTC").slice(0, 19) : "—"}</dd></div>
      <div><dt className="text-faint">Actor</dt><dd className="mt-0.5 text-text">{e.actor}{e.actor_role && <span className="text-muted"> ({e.actor_role})</span>}</dd></div>
      {reason && <div className="sm:col-span-2"><dt className="text-faint">Reason / note</dt><dd className="mt-0.5 whitespace-pre-wrap text-text">{reason}</dd></div>}
      {changed && changed.length > 0 && <div className="sm:col-span-2"><dt className="text-faint">Instructions changed</dt><dd className="mt-0.5 text-text">{changed.join(", ")}</dd></div>}
      {files.length > 0 && (
        <div className="sm:col-span-2"><dt className="text-faint">Evidence files (metadata only)</dt>
          <dd className="mt-0.5 space-y-0.5">{files.map((f, i) => (
            <p key={i} className="text-text"><FileText size={11} className="mr-1 inline text-muted" />
              {wo && f.attachment_id ? <a className="text-blue hover:underline" href={`/api/work-orders/${wo}/attachments/${f.attachment_id}/file`} target="_blank" rel="noreferrer">{f.filename}</a> : f.filename}
              <span className="text-muted"> {f.size ? `· ${Math.max(1, Math.round(f.size / 1024))} KB` : ""} {f.sha256 ? `· sha256 ${f.sha256.slice(0, 10)}…` : ""}</span></p>))}</dd></div>
      )}
      {(e.refs.report_version || e.refs.evidence_version) && (
        <div className="sm:col-span-2"><dt className="text-faint">References</dt><dd className="mt-0.5 flex flex-wrap gap-3 text-text">
          {e.refs.report_version && wo && <a className="text-blue hover:underline" target="_blank" rel="noreferrer" href={`/api/work-orders/${wo}/report?version=${e.refs.report_version}`}>Report version {e.refs.report_version}</a>}
          {e.refs.evidence_version && <span>Evidence version {e.refs.evidence_version}</span>}</dd></div>
      )}
    </dl>
  );
}

function Row({ e }: { e: AuditEvent }) {
  const [open, setOpen] = useState(false);
  return (
    <li data-event={e.action} data-source={e.source} className="px-5 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={TONE[e.action] ?? "neutral"}>{e.action_label}</Badge>
            {e.source === "investigation" && <Badge tone="slate">Investigation</Badge>}
            <span className="text-sm text-text"><b>{e.actor}</b>{e.actor_role && <span className="text-muted"> · {e.actor_role.replace("_", " ")}</span>}</span>
          </div>
          <p className="mt-1 text-sm text-muted">{e.summary}</p>
          <p className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-faint">
            <span className="num">{fmtWall(e.ts)}</span>
            {e.work_order_id && <Link href={`/work-orders/${e.work_order_id}`} className="num text-blue hover:underline">{e.work_order_id}</Link>}
            <Link href={`/incidents/${e.incident_id}`} className="num text-blue hover:underline">{e.incident_id}</Link>
          </p>
        </div>
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="inline-flex items-center gap-1 text-xs font-medium text-blue hover:underline">Details <ChevronDown size={13} className={cx("transition-transform", open && "rotate-180")} /></button>
      </div>
      {open && <Detail e={e} />}
    </li>
  );
}

function AuditPage() {
  const q = useSearchParams();
  const { version, state } = useApp();
  const [wo, setWo] = useState(q.get("work_order") ?? "");
  const [inc, setInc] = useState(q.get("incident") ?? "");
  const [actor, setActor] = useState("");
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const qs = useMemo(() => {
    const p = new URLSearchParams({ order });
    if (wo) p.set("work_order_id", wo); if (inc) p.set("incident_id", inc); if (actor) p.set("actor", actor); if (action) p.set("action", action);
    if (from) p.set("date_from", from); if (to) p.set("date_to", to);
    return p.toString();
  }, [wo, inc, actor, action, from, to, order]);
  const { data } = useApi<AuditResp>(`/api/audit?${qs}`, version);
  const { data: wos } = useApi<WorkOrderRow[]>("/api/work-orders", version);
  const clear = () => { setWo(""); setInc(""); setActor(""); setAction(""); setFrom(""); setTo(""); };
  const active = [wo, inc, actor, action, from, to].some(Boolean);

  return (
    <div>
      <PageHeader title="Audit Trail" subtitle="Chain of custody: every consequential action on a work order and its investigation, who did it, when, and what changed. Read-only; this is an application-level record, not a tamper-proof ledger."
        right={<SimulatedTag />} />
      <Card className="mb-5">
        <div className="flex items-center gap-2 border-b border-line-soft px-5 py-3 text-sm font-semibold"><Filter size={14} className="text-muted" /> Filters
          {active && <button onClick={clear} className="ml-auto text-xs font-medium text-blue hover:underline">Clear filters</button>}</div>
        <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-6">
          <label className="text-xs text-muted">Work order<select aria-label="Filter by work order" className={sel} value={wo} onChange={(e) => setWo(e.target.value)}><option value="">All</option>{(wos ?? []).map((w) => <option key={w.work_order_id}>{w.work_order_id}</option>)}</select></label>
          <label className="text-xs text-muted">Incident<select aria-label="Filter by incident" className={sel} value={inc} onChange={(e) => setInc(e.target.value)}><option value="">All</option>{(state?.incidents ?? []).map((i) => <option key={i.incident_id}>{i.incident_id}</option>)}</select></label>
          <label className="text-xs text-muted">Actor<select aria-label="Filter by actor" className={sel} value={actor} onChange={(e) => setActor(e.target.value)}><option value="">All</option>{(data?.actors ?? []).map((a) => <option key={a}>{a}</option>)}</select></label>
          <label className="text-xs text-muted">Action<select aria-label="Filter by action" className={sel} value={action} onChange={(e) => setAction(e.target.value)}><option value="">All</option>{Object.entries(data?.actions ?? {}).sort((a, b) => a[1].localeCompare(b[1])).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label className="text-xs text-muted">From<input aria-label="From date" type="date" className={sel} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="text-xs text-muted">To<input aria-label="To date" type="date" className={sel} value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
      </Card>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-5 py-3">
          <p className="text-sm text-muted"><ShieldCheck size={14} className="mr-1 inline text-blue" /><b className="num text-text" data-testid="audit-count">{data?.count ?? "…"}</b> events · sorted <b className="text-text">{order === "desc" ? "newest first" : "oldest first"}</b></p>
          <Button size="sm" onClick={() => setOrder(order === "desc" ? "asc" : "desc")} aria-label={`Sort ${order === "desc" ? "oldest first" : "newest first"}`}><ArrowDownUp size={13} /> {order === "desc" ? "Show oldest first" : "Show newest first"}</Button>
        </div>
        {!data ? <Skeleton className="m-5 h-40" /> : data.events.length === 0 ? (
          <Empty title="No audit events" body={active ? "No events match these filters." : "Events appear here as work orders are proposed, approved, assigned, executed and completed."} />
        ) : <ol className="divide-y divide-line-soft" aria-label="Audit events">{data.events.map((e) => <Row key={e.event_id} e={e} />)}</ol>}
      </Card>
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<Skeleton className="h-80" />}><AuditPage /></Suspense>;
}
