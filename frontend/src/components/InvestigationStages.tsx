"use client";

import { AlertTriangle, ArrowLeft, ArrowRight, Box, Check, ClipboardCheck, Loader2, Lock, RotateCw, ThumbsDown } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { TimeSeriesChart } from "@/components/charts/TimeSeriesChart";
import { Sparkline } from "@/components/charts/Sparkline";
import { Cite, ClaimRow, HypothesisCard } from "@/components/EvidenceBits";
import { Badge, Button, Card, CardHeader, Skeleton, Term } from "@/components/ui";
import { post, useApi } from "@/lib/api";
import { cx, fmtNum, fmtSim, fmtWall, fmtZ } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { IncidentDetail, NextStage, Series, SensorFinding } from "@/lib/types";

const STAGES = [
  { n: 1, agent: "Sentinel", title: "Detection", question: "What was detected, and why was it flagged?", run: "Checking sensor readings…" },
  { n: 2, agent: "Investigator", title: "Evidence", question: "What evidence supports or contradicts each finding?", run: "Investigating anomaly and gathering evidence…" },
  { n: 3, agent: "Risk Prioritiser", title: "Assessment", question: "How serious is it, and why this priority?", run: "Evaluating priority factors…" },
  { n: 4, agent: "Response Planner", title: "Preventive action", question: "What preventive action is recommended, and why?", run: "Preparing proposed maintenance work order…" },
] as const;

const ROLE_LABEL = { primary: "Primary finding", corroborating: "Corroborating finding", context: "Context observation" } as const;

function FindingTag({ f }: { f: SensorFinding }) {
  return <Badge tone={f.role === "context" ? "slate" : "amber"}>{ROLE_LABEL[f.role]}</Badge>;
}

// ------------------------------------------------------------------ stage 1: Sentinel — Detection
function DetectionStage({ d, selected, onSelect }: { d: IncidentDetail; selected: string | null; onSelect: (id: string) => void }) {
  const e = d.event;
  const sensors = new Set(e.findings.map((f) => f.sensor_id)).size;
  return (
    <div className="space-y-4">
      <p className="text-sm text-text"><b>{e.findings.length} finding{e.findings.length === 1 ? "" : "s"}</b> from {sensors} sensor{sensors === 1 ? "" : "s"} on {d.asset.name}, first flagged {fmtSim(e.onset_time)} UTC. Readings are <b>observed (simulated)</b>; the deviation and z-score are <b>calculated</b> against each sensor&apos;s own baseline.</p>
      <ul className="space-y-3">
        {e.findings.map((f) => (
          <li key={f.sensor_id}>
            <div role="button" tabIndex={0} onClick={() => onSelect(f.sensor_id)} onKeyDown={(k) => (k.key === "Enter" || k.key === " ") && onSelect(f.sensor_id)} aria-pressed={selected === f.sensor_id} data-finding={f.sensor_id}
              className={cx("cursor-pointer rounded-xl border bg-surface p-4 transition-colors hover:border-faint", selected === f.sensor_id ? "border-amber/60 ring-1 ring-amber/30" : "border-line")}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-sm font-semibold text-text">{f.sensor_id}</span><FindingTag f={f} /></div>
                  <p className="mt-0.5 text-xs text-muted">{f.component_name ?? f.location}{!f.component_name && " · component mapping unavailable"}</p>
                </div>
                <Link href={`/assets/${d.asset.asset_id}?sensor=${f.sensor_id}`} onClick={(ev) => ev.stopPropagation()} className="inline-flex items-center gap-1 text-xs font-medium text-blue hover:underline"><Box size={12} /> View on bridge</Link>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-5">
                <div><dt className="text-faint">Observed · {f.feature_label}</dt><dd className="num mt-0.5 text-sm font-semibold text-text">{fmtNum(f.value, 4)} <span className="text-[11px] font-normal text-muted">{f.unit}</span></dd></div>
                <div><dt className="text-faint">Baseline (median)</dt><dd className="num mt-0.5 text-sm text-text">{fmtNum(f.baseline_median, 4)} {f.unit}</dd></div>
                <div><dt className="text-faint">Deviation</dt><dd className="num mt-0.5 text-sm text-text">{f.deviation >= 0 ? "+" : "−"}{fmtNum(Math.abs(f.deviation), 4)}{f.deviation_pct !== null && <span className="text-muted"> ({f.deviation_pct >= 0 ? "+" : "−"}{Math.abs(f.deviation_pct).toFixed(1)}%)</span>}</dd></div>
                <div><dt className="text-faint"><Term t="robust z-score">Robust z</Term> · calculated</dt><dd className="num mt-0.5 text-sm font-semibold text-amber">{fmtZ(f.z)}</dd></div>
                <div><dt className="text-faint">Since</dt><dd className="num mt-0.5 text-sm text-text">{fmtSim(f.onset_time)} <span className="text-muted">· {f.persistence_count} win.</span></dd></div>
              </dl>
              <div className="mt-3 flex items-center gap-4">
                <div className="shrink-0"><p className="mb-0.5 text-[10px] text-faint">Trend (last {f.trend.length} windows)</p>
                  <Sparkline width={170} height={34} median={f.baseline_median} label={`${f.sensor_id} trend`} points={f.trend.map((v, i) => ({ i, v, q: v === null ? "missing" : "ok", x: i >= f.trend.length - f.persistence_count }))} /></div>
                <p className="text-xs leading-relaxed text-muted"><b className="text-text">Why flagged:</b> {f.reason}</p>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ stage 2: Investigator — Evidence
function EvidenceStage({ d, selected, onSelect }: { d: IncidentDetail; selected: string | null; onSelect: (id: string) => void }) {
  const inv = d.investigation!;
  const f = d.event.findings.find((x) => x.sensor_id === selected) ?? d.event.findings[0];
  const { version } = useApp();
  const { data: series } = useApi<Series>(`/api/assets/${d.asset.asset_id}/series?sensor_id=${f.sensor_id}&feature=${f.feature}&window=200`, version);
  const [hl, setHl] = useState<string | null>(null);
  const onCite = (id: string) => { setHl(id); document.getElementById(`ev-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }); setTimeout(() => setHl(null), 1800); };
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Sensor history" subtitle={`${f.sensor_id} · ${f.feature_label} — observed readings against this sensor's baseline band`}
          right={<div className="flex gap-1">{d.event.findings.map((x) => <button key={x.sensor_id} onClick={() => onSelect(x.sensor_id)} aria-pressed={x.sensor_id === f.sensor_id} className={cx("rounded-md px-2 py-1 font-mono text-[11px]", x.sensor_id === f.sensor_id ? "bg-blue-soft text-blue" : "text-muted hover:text-text")}>{x.sensor_id}</button>)}</div>} />
        <div className="px-3 py-3">{series ? <TimeSeriesChart series={series} height={220} compact /> : <Skeleton className="h-[220px]" />}</div>
      </Card>

      <div>
        <h3 className="mb-2 text-sm font-semibold">Evidence for each finding</h3>
        <div className="grid gap-4 lg:grid-cols-2">
          {d.event.findings.map((fi) => {
            const fe = inv.finding_evidence.find((x) => x.sensor_id === fi.sensor_id);
            return (
              <Card key={fi.sensor_id} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold"><span className="font-mono">{fi.sensor_id}</span> <span className="font-normal text-muted">· {fi.component_name ?? fi.location}</span></p>
                  <Badge tone={fi.quality_ok ? "neutral" : "violet"}>Data quality: {fi.quality_ok ? "gate passed" : "issues"}</Badge>
                </div>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <div><p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-blue">Supports</p>
                    {fe?.supports.length ? <ul className="space-y-1.5">{fe.supports.map((c, i) => <ClaimRow key={i} c={c} onCite={onCite} />)}</ul> : <p className="text-xs text-muted">Nothing retrieved.</p>}</div>
                  <div><p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber">Contradicts / limits</p>
                    {fe?.contradicts.length ? <ul className="space-y-1.5">{fe.contradicts.map((c, i) => <ClaimRow key={i} c={c} onCite={onCite} />)}</ul> : <p className="text-xs text-muted">Nothing found against it.</p>}</div>
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">Competing hypotheses <span className="ml-1 text-xs font-normal text-muted">hypotheses, not findings — ranked by documented rule points</span></h3>
        <div className="grid gap-4 lg:grid-cols-3">{inv.hypotheses.map((h) => <HypothesisCard key={h.key} h={h} onCite={onCite} />)}</div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-amber/30">
          <CardHeader title="Uncertainty — evidence still missing" />
          <ul className="space-y-2 px-5 py-4">{inv.missing_evidence.map((m) => <li key={m} className="flex gap-2 text-xs text-text"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber" />{m}</li>)}</ul>
        </Card>
        <Card>
          <details>
            <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3.5 text-sm font-semibold">Records retrieved <span className="text-xs font-normal text-blue">{inv.evidence_refs.length} · show / hide</span></summary>
            <ol className="max-h-[420px] divide-y divide-line-soft overflow-y-auto border-t border-line-soft">
              {[...inv.evidence_refs].sort((a, b) => (a.timestamp ?? "9").localeCompare(b.timestamp ?? "9")).map((r) => (
                <li key={r.ref_id} id={`ev-${r.ref_id}`} className={cx("px-5 py-2.5 transition-colors", hl === r.ref_id && "bg-blue-soft")}>
                  <p className="flex items-center gap-2 text-xs"><Cite id={r.ref_id} /><span className="font-medium text-text">{r.title}</span><Badge tone="violet" className="ml-auto">Simulated</Badge></p>
                  <p className="mt-0.5 text-xs text-muted">{r.summary}</p>
                </li>
              ))}
            </ol>
          </details>
        </Card>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ stage 3: Risk Prioritiser — Assessment
function AssessmentStage({ d }: { d: IncidentDetail }) {
  const t = d.triage.at(-1)!;
  const e = d.event;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-4">
        <span className={cx("num grid h-14 w-14 place-items-center rounded-xl text-xl font-bold", t.escalation_required ? "bg-red-soft text-red" : "bg-amber-soft text-amber")}>{t.priority}</span>
        <div>
          <p className="text-base font-semibold text-text">{t.priority_label}</p>
          <p className="text-sm text-muted">Recommended response time-frame for a qualified engineer: <b className="text-text">{t.timeframe}</b></p>
          <p className="mt-0.5 text-xs text-faint">Calculated by documented rules · demonstration triage score <b className="num text-muted">{t.demonstration_triage_score}</b> · not a failure probability</p>
        </div>
      </div>
      {t.escalation_required && <p className="rounded-md border border-red/40 bg-red-soft p-3 text-sm text-red">{t.escalation_basis}</p>}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Contributing findings" subtitle={`${t.contributing_findings.length} findings considered`} />
          <ul className="divide-y divide-line-soft">
            {t.contributing_findings.map((c) => (
              <li key={c.sensor_id} className="flex flex-wrap items-start justify-between gap-2 px-5 py-3 text-xs">
                <div><p className="text-sm"><span className="font-mono font-semibold">{c.sensor_id}</span> <span className="text-muted">· {c.component_name}</span></p>
                  <p className="mt-0.5 text-muted">{c.feature_label} · {c.persistence_count} exceeding windows</p></div>
                <div className="text-right"><p className="num text-sm font-semibold text-amber">z {fmtZ(c.z)}</p><p className="mt-0.5 max-w-[210px] text-[11px] text-faint">{c.counted_as}</p></div>
              </li>
            ))}
          </ul>
        </Card>
        <Card data-coach="priority">
          <CardHeader title="Severity rationale" subtitle="Each rule's points, from the documented triage rules" />
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase tracking-wider text-faint"><tr><th className="px-5 py-1.5 text-left font-medium">Factor</th><th className="text-left font-medium">Observed</th><th className="px-5 text-right font-medium">Points</th></tr></thead>
            <tbody>
              {t.factors.map((f) => (
                <tr key={f.name} className="border-t border-line-soft" title={f.rule}>
                  <td className="px-5 py-1.5 text-text">{f.name}</td><td className="py-1.5 pr-2 text-muted">{f.observed}</td>
                  <td className={cx("num px-5 py-1.5 text-right", f.points > 0 ? "text-amber" : f.points < 0 ? "text-blue" : "text-faint")}>{f.points > 0 ? "+" : ""}{f.points}</td>
                </tr>
              ))}
              <tr className="border-t border-line"><td className="px-5 py-1.5 font-semibold" colSpan={2}>Total (demonstration triage score)</td><td className="num px-5 text-right font-semibold">{t.demonstration_triage_score}</td></tr>
            </tbody>
          </table>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Persistence" />
          <p className="px-5 py-4 text-sm text-text">The deviation persisted in <b className="num">{e.persistence_count}</b> windows (rule: ≥{e.persistence_required} of {e.persistence_window}, {e.window_minutes}-minute windows), starting {fmtSim(e.onset_time)} UTC, and passed the data-quality gate.</p>
        </Card>
        <Card className="border-amber/30">
          <CardHeader title="Uncertainty" subtitle="What this assessment cannot tell you" />
          <ul className="space-y-2 px-5 py-4">{t.uncertainty.length ? t.uncertainty.map((u) => <li key={u} className="flex gap-2 text-xs text-text"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber" />{u}</li>) : <li className="text-xs text-muted">No additional uncertainty recorded.</li>}</ul>
        </Card>
      </div>
      <p className="rounded-lg border border-line bg-raised p-3 text-xs text-muted"><b className="text-text">Recommended response:</b> {t.recommended_first_action} {t.disclaimer}</p>
    </div>
  );
}

// ------------------------------------------------------------------ stage 4: Response Planner — Preventive action
function ActionStage({ d, busy, onDecide }: { d: IncidentDetail; busy: boolean; onDecide: (decision: "approve" | "reject", note: string) => void }) {
  const { user } = useApp();
  const wo = d.work_orders.at(-1)!;
  const awaiting = d.incident.state === "AWAITING_APPROVAL" && wo.status === "proposed";
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const lead = d.investigation?.hypotheses[0];
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Recommended preventive action" subtitle="A proposal for a qualified engineer — InfraGuard does not order or perform any action"
          right={<Link href={`/work-orders/${wo.work_order_id}`} className="num text-xs font-semibold text-blue hover:underline">{wo.work_order_id}</Link>} />
        <div className="grid gap-6 p-5 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-4">
            <div><p className="text-[11px] font-semibold uppercase tracking-wider text-faint">Why it is recommended</p>
              <p className="mt-1 text-sm text-text">{wo.reason}</p>
              {lead && <p className="mt-1 text-xs text-muted">Leading <span className="text-violet">hypothesis</span>: {lead.title} ({lead.support} support) — to be confirmed by inspection.</p>}</div>
            <div><p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">Proposed inspection steps</p>
              <ol className="space-y-2">{wo.steps.map((s) => (
                <li key={s.order} className="flex gap-3"><span className="num mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-raised text-xs text-muted">{s.order}</span>
                  <div className="min-w-0"><p className="text-sm text-text">{s.action}</p><p className="text-xs text-muted">{s.rationale}{s.refs.map((r) => <span key={r} className="ml-1 inline-block align-middle"><Cite id={r} /></span>)}</p></div></li>
              ))}</ol></div>
          </div>
          <div className="space-y-4">
            <div><p className="text-[11px] font-semibold uppercase tracking-wider text-faint">Proposed work order</p>
              <div className="mt-1 flex flex-wrap items-center gap-2"><Badge tone={wo.status === "proposed" ? "amber" : wo.status === "rejected" ? "slate" : "blue"} className="capitalize">{wo.status === "proposed" ? "Pending approval" : wo.status.replace("_", " ")}</Badge><Badge tone="neutral">{wo.priority} · {wo.timeframe}</Badge></div></div>
            <div><p className="text-[11px] font-semibold uppercase tracking-wider text-faint">The inspection should provide</p>
              <ul className="mt-1 space-y-1">{wo.required_evidence.map((r) => <li key={r} className="text-xs text-muted">• {r}</li>)}</ul></div>
          </div>
        </div>
        <div className="rounded-b-[11px] border-t border-line bg-raised/60 px-5 py-4" data-coach="approve">
          {awaiting ? (
            user.role === "viewer" || user.role === "maintenance" ? <p className="flex items-center gap-2 text-sm text-muted"><Lock size={14} /> Only an engineer or asset owner can approve or reject. Switch the demo user in the top bar.</p> : (
              <div>
                <p className="mb-2 text-xs font-semibold text-amber">Pending approval — nothing is approved or actioned until a human decides.</p>
                {rejecting ? (
                  <div className="flex flex-wrap gap-2">
                    <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason for rejection (required)" aria-label="Rejection reason" className="h-9 min-w-[240px] flex-1 rounded-md border border-line bg-surface px-3 text-sm" />
                    <Button variant="danger" disabled={busy} onClick={() => onDecide("reject", note)}><ThumbsDown size={14} /> Confirm reject</Button>
                    <Button variant="ghost" onClick={() => setRejecting(false)}>Cancel</Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="primary" disabled={busy} onClick={() => onDecide("approve", "")}><Check size={14} /> Approve</Button>
                    <Button variant="danger" disabled={busy} onClick={() => setRejecting(true)}><ThumbsDown size={14} /> Reject</Button>
                    <Link href={`/work-orders/${wo.work_order_id}`} className="text-xs font-medium text-blue hover:underline">Edit in Work Orders</Link>
                  </div>
                )}
              </div>
            )
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-text"><Check size={14} className="mr-1 inline text-blue" />{wo.status === "rejected" ? "Rejected" : "Approved"} by <b>{wo.approved_by ?? d.approvals.at(-1)?.actor}</b>{d.approvals.at(-1) && <> at <span className="num">{fmtWall(d.approvals.at(-1)!.timestamp)}</span></>}. The investigation is complete.</p>
              <Link href={`/work-orders/${wo.work_order_id}`}><Button variant="primary"><ClipboardCheck size={14} /> Assign and track in Work Orders <ArrowRight size={14} /></Button></Link>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ the sequential wizard
export function InvestigationStages({ d, onChange, selectedFinding }: { d: IncidentDetail; onChange: () => Promise<void> | void; selectedFinding?: string | null }) {
  const { user, pushToast } = useApp();
  const id = d.incident.incident_id;
  const executed = [true, !!d.investigation, d.triage.length > 0, d.work_orders.length > 0];
  const last = executed.lastIndexOf(true);          // highest executed stage index
  const [view, setView] = useState(last);
  const [selected, setSelected] = useState<string | null>(selectedFinding ?? null);
  const [running, setRunning] = useState<{ stage: number; message: string } | null>(null);
  const [error, setError] = useState<{ message: string; retry: () => void } | null>(null);
  const next: NextStage | null = d.next_stage;
  useEffect(() => { setView((v) => Math.min(v, last)); }, [last]);
  useEffect(() => { if (selectedFinding) setSelected(selectedFinding); }, [selectedFinding]);
  const stage = STAGES[view];
  const sel = useMemo(() => selected ?? d.event.findings[0]?.sensor_id ?? null, [selected, d.event.findings]);

  const run = async (target: number, message: string, call: () => Promise<unknown>, thenView = true) => {
    setError(null); setRunning({ stage: target, message });
    try { await call(); await onChange(); if (thenView) setView(target); }
    catch (e) { setError({ message: (e as Error).message, retry: () => run(target, message, call, thenView) }); }
    finally { setRunning(null); }
  };
  const goNext = () => {
    if (view < last) { setView(view + 1); return; }
    if (next) run(view + 1, STAGES[view + 1].run, () => post(`/api/incidents/${id}/advance`, { actor: user.name, role: user.role, expected_state: next.expected_state }));
  };
  const decide = (decision: "approve" | "reject", note: string) => {
    if (decision === "reject" && !note.trim()) { pushToast({ tone: "amber", title: "A reason is required to reject" }); return; }
    run(3, "Recording your decision…", async () => {
      await post(`/api/incidents/${id}/decision`, { decision, actor: user.name, role: user.role, note });
      pushToast({ tone: decision === "reject" ? "slate" : "blue", title: `${d.work_orders.at(-1)?.work_order_id} ${decision === "reject" ? "rejected" : "approved"} by ${user.name}`, body: "Recorded in the work-order history." });
    }, false);
  };
  const canAdvance = view < last || (!!next && view === last && view < 3);

  return (
    <div data-coach="pipeline">
      <Card className="mb-4">
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div>
            <p data-testid="step-indicator" className="text-[11px] font-semibold uppercase tracking-wider text-amber" aria-live="polite">{`Step ${stage.n} of ${STAGES.length}`}</p>
            <h2 className="mt-0.5 text-lg font-semibold tracking-tight">{stage.agent} <span className="font-normal text-muted">— {stage.title}</span></h2>
            <p className="text-sm text-muted">{stage.question}</p>
          </div>
          <ol className="flex items-center gap-1.5" aria-label="Investigation stages">
            {STAGES.map((s, i) => {
              const done = executed[i], here = i === view, reachable = i <= last;
              return (
                <li key={s.n} className="flex items-center gap-1.5">
                  {i > 0 && <span className={cx("h-px w-5", done ? "bg-blue" : "bg-line")} aria-hidden />}
                  <button type="button" disabled={!reachable || running !== null} onClick={() => setView(i)} aria-current={here ? "step" : undefined} aria-label={`Stage ${s.n}: ${s.agent} — ${s.title}${done ? ", completed" : ""}`}
                    className={cx("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed",
                      here ? "border-amber bg-amber-soft text-amber" : done ? "border-blue/40 text-blue hover:bg-blue-soft" : "border-line text-faint")}>
                    {running?.stage === i ? <Loader2 size={12} className="animate-spin" /> : done && !here ? <Check size={12} /> : <span className="num">{s.n}</span>}
                    <span className="hidden md:inline">{s.title}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </Card>

      {running && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-blue/30 bg-blue-soft px-4 py-3 text-sm text-blue" role="status" aria-live="polite"><Loader2 size={15} className="animate-spin" /> {running.message}</div>
      )}
      {error && (
        <div className="mb-4 rounded-lg border border-red/40 bg-red-soft p-4 text-sm" role="alert">
          <p className="flex items-center gap-2 font-medium text-red"><AlertTriangle size={15} /> This step did not complete</p>
          <p className="mt-1 text-xs text-text">{error.message}</p>
          <p className="mt-1 text-[11px] text-muted">Nothing was recorded for this step, so retrying cannot create duplicate records.</p>
          <Button size="sm" className="mt-2" onClick={error.retry}><RotateCw size={13} /> Retry</Button>
        </div>
      )}

      <div data-stage={stage.n}>
        {view === 0 && <DetectionStage d={d} selected={sel} onSelect={setSelected} />}
        {view === 1 && d.investigation && <EvidenceStage d={d} selected={sel} onSelect={setSelected} />}
        {view === 2 && d.triage.length > 0 && <AssessmentStage d={d} />}
        {view === 3 && d.work_orders.length > 0 && <ActionStage d={d} busy={running !== null} onDecide={decide} />}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <Button disabled={view === 0 || running !== null} onClick={() => setView(view - 1)}><ArrowLeft size={14} /> Previous Step</Button>
        <p className="text-xs text-muted">{view < 3 ? (canAdvance ? (view < last ? "Results of the next stage are already available." : `Next: ${STAGES[view + 1].agent} — ${STAGES[view + 1].title}`) : "No further stage can be run for this incident.") : "Final stage — the decision is made by a human."}</p>
        {view < 3 && <Button variant="primary" disabled={!canAdvance || running !== null} onClick={goNext} data-coach="continue">{running ? "Running…" : "Next Step"} <ArrowRight size={14} /></Button>}
      </div>
    </div>
  );
}
