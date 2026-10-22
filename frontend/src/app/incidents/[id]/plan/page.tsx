"use client";

import { ArrowRight, Check, ClipboardList, Lock, Pencil, Plus, Scale, Siren, ThumbsDown, Trash2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { IncidentHeader } from "@/components/IncidentHeader";
import { Badge, Button, Card, CardHeader, Skeleton, Term } from "@/components/ui";
import { post, useApi } from "@/lib/api";
import { cx, fmtSim, fmtWall } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { IncidentDetail, WorkOrder } from "@/lib/types";

const WO_NEXT: Record<string, { to: string; label: string }> = {
  approved: { to: "assigned", label: "Mark assigned" },
  assigned: { to: "in_progress", label: "Mark in progress" },
  in_progress: { to: "completed", label: "Mark work completed" },
};

export default function PlannerPage() {
  const { id } = useParams<{ id: string }>();
  const { version, user, pushToast, refresh } = useApp();
  const { data: d, reload } = useApi<IncidentDetail>(`/api/incidents/${id}`, version);
  const [mode, setMode] = useState<"view" | "edit" | "reject">("view");
  const [optimistic, setOptimistic] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [steps, setSteps] = useState<string[]>([]);
  const [timeframe, setTimeframe] = useState("");
  const [assignee, setAssignee] = useState("");
  const wo: WorkOrder | undefined = d?.work_orders.at(-1);

  useEffect(() => {
    if (wo && mode === "view") { setSteps(wo.steps.map((s) => s.action)); setTimeframe(wo.timeframe); setAssignee(wo.assigned_to ?? ""); }
  }, [wo, mode]);
  useEffect(() => { setOptimistic(null); }, [wo?.status, wo?.work_order_id]);

  if (!d || !wo) return <div className="space-y-4"><Skeleton className="h-16 w-96" /><Skeleton className="h-[480px]" /></div>;
  const tri = d.triage.at(-1)!;
  const awaiting = d.incident.state === "AWAITING_APPROVAL" && wo.status === "proposed";
  const canDecide = user.role !== "viewer";
  const status = optimistic ?? wo.status;

  const decide = async (decision: "approve" | "edit_approve" | "reject") => {
    if (decision === "reject" && !note.trim()) { pushToast({ tone: "amber", title: "A reason is required to reject" }); return; }
    setBusy(true);
    setOptimistic(decision === "reject" ? "rejected" : "approved");
    try {
      const edits = decision === "edit_approve" ? { steps, timeframe, ...(assignee ? { assigned_to: assignee } : {}) } : undefined;
      await post(`/api/incidents/${id}/decision`, { decision, actor: user.name, role: user.role, note, edits });
      pushToast({ tone: decision === "reject" ? "slate" : "blue", title: decision === "reject" ? `${wo.work_order_id} rejected` : `${wo.work_order_id} approved by ${user.name}`, body: "Recorded in the audit trail." });
      setMode("view"); setNote("");
    } catch (e) {
      setOptimistic(null);
      pushToast({ tone: "red", title: "Decision not recorded", body: (e as Error).message });
    } finally {
      setBusy(false); await reload(); await refresh();
    }
  };
  const advance = async (to: string) => {
    try { await post(`/api/work-orders/${wo.work_order_id}/status`, { status: to, actor: user.name, role: user.role }); }
    catch (e) { pushToast({ tone: "red", title: "Not allowed", body: (e as Error).message }); }
    await reload(); await refresh();
  };
  const replan = async () => {
    try { await post(`/api/incidents/${id}/replan`, { actor: user.name, role: user.role }); }
    catch (e) { pushToast({ tone: "red", title: "Not allowed", body: (e as Error).message }); }
    await reload(); await refresh();
  };

  return (
    <div>
      <IncidentHeader d={d} />
      <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
        <Card className={cx(awaiting && "card-active")}>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-t-[11px] border-b border-amber/30 bg-amber-soft px-5 py-3">
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-amber"><TriangleAlert size={16} /> {wo.label}</span>
            <Badge tone={status === "proposed" ? "amber" : status === "rejected" ? "slate" : "blue"} className="capitalize">Work order: {status.replace("_", " ")}{optimistic ? " · saving…" : ""}</Badge>
          </div>
          <div className="grid gap-4 border-b border-line-soft px-5 py-4 sm:grid-cols-4">
            <Field k="Work order" v={<span className="num">{wo.work_order_id}</span>} />
            <Field k="Asset" v={<span className="num">{wo.asset_id}</span>} />
            <Field k="Priority" v={<span className="num">{wo.priority}</span>} />
            <Field k="Recommended time-frame" v={mode === "edit" ? <input value={timeframe} onChange={(e) => setTimeframe(e.target.value)} aria-label="Time-frame" className="h-8 w-full rounded-md border border-line bg-raised px-2 text-sm" /> : wo.timeframe} />
          </div>
          <div className="border-b border-line-soft px-5 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-faint">Reason</p>
            <p className="mt-1 text-sm text-text">{wo.reason}</p>
          </div>
          <div className="px-5 py-4">
            <p className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-faint"><ClipboardList size={13} /> Proposed inspection steps</p>
            <ol className="space-y-3">
              {(mode === "edit" ? steps : wo.steps.map((s) => s.action)).map((a, i) => {
                const st = wo.steps[i];
                return (
                  <li key={i} className="flex gap-3">
                    <span className="num mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-raised text-xs text-muted">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      {mode === "edit" ? (
                        <div className="flex gap-2">
                          <textarea value={a} onChange={(e) => setSteps(steps.map((x, k) => (k === i ? e.target.value : x)))} rows={2} aria-label={`Step ${i + 1}`}
                            className="w-full rounded-md border border-line bg-raised p-2 text-sm text-text" />
                          <button onClick={() => setSteps(steps.filter((_, k) => k !== i))} aria-label={`Remove step ${i + 1}`} className="text-faint hover:text-red"><Trash2 size={15} /></button>
                        </div>
                      ) : <p className="text-sm text-text">{a}</p>}
                      {st && mode !== "edit" && (
                        <p className="mt-0.5 text-xs text-muted">{st.rationale} {st.refs.map((r) => <span key={r} className="num ml-1 rounded border border-blue/30 bg-blue-soft px-1 text-[10px] text-blue">{r}</span>)}</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
            {mode === "edit" && <Button size="sm" variant="ghost" className="mt-2" onClick={() => setSteps([...steps, ""])}><Plus size={13} /> Add step</Button>}
          </div>
          <div className="border-t border-line-soft px-5 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-faint">Evidence the inspection should provide</p>
            <ul className="mt-2 space-y-1">{wo.required_evidence.map((r) => <li key={r} className="text-xs text-muted">• {r}</li>)}</ul>
          </div>
          {mode === "edit" && (
            <div className="border-t border-line-soft px-5 py-4">
              <label className="text-xs text-faint">Assign to (optional)
                <input value={assignee} onChange={(e) => setAssignee(e.target.value)} className="mt-1 h-8 w-full rounded-md border border-line bg-raised px-2 text-sm text-text" placeholder="e.g. Bridge inspection team B (simulated)" />
              </label>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 rounded-b-[11px] border-t border-line bg-raised/60 px-5 py-4" data-coach="approve">
            {awaiting && !optimistic ? (
              canDecide ? (
                mode === "reject" ? (
                  <>
                    <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason for rejection (required)" aria-label="Rejection reason"
                      className="h-9 min-w-[260px] flex-1 rounded-md border border-line bg-surface px-3 text-sm" />
                    <Button variant="danger" disabled={busy} onClick={() => decide("reject")}><ThumbsDown size={15} /> Confirm reject</Button>
                    <Button variant="ghost" onClick={() => setMode("view")}>Cancel</Button>
                  </>
                ) : (
                  <>
                    <Button variant="primary" disabled={busy} onClick={() => decide(mode === "edit" ? "edit_approve" : "approve")}>
                      <Check size={15} /> {mode === "edit" ? "Save edits & approve" : "Approve work order"}
                    </Button>
                    {mode === "edit" ? <Button variant="ghost" onClick={() => setMode("view")}>Cancel edit</Button>
                      : <Button onClick={() => setMode("edit")}><Pencil size={14} /> Edit</Button>}
                    <Button variant="danger" onClick={() => setMode("reject")}><ThumbsDown size={14} /> Reject</Button>
                    <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Approval note (optional)" aria-label="Approval note"
                      className="h-9 min-w-[200px] flex-1 rounded-md border border-line bg-surface px-3 text-sm" />
                  </>
                )
              ) : (
                <p className="flex items-center gap-2 text-sm text-muted"><Lock size={15} /> Your role (viewer) cannot approve. Switch to an engineer or asset owner in the top bar.</p>
              )
            ) : status === "rejected" ? (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm text-muted">Proposal rejected. The incident stays open.</p>
                {d.incident.state === "REJECTED" && <Button onClick={replan}>Request revised proposal</Button>}
              </div>
            ) : (
              <div className="flex w-full flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-text">
                  <Check size={15} className="mr-1 inline text-blue" />
                  {d.approvals.filter((a) => a.decision !== "reject").at(-1)
                    ? <>Approved by <b>{d.approvals.filter((a) => a.decision !== "reject").at(-1)!.actor}</b> at <span className="num">{fmtWall(d.approvals.filter((a) => a.decision !== "reject").at(-1)!.timestamp)}</span></>
                    : "Approval saved"}
                </p>
                <div className="flex flex-wrap gap-2">
                  {WO_NEXT[wo.status] && canDecide && <Button size="sm" onClick={() => advance(WO_NEXT[wo.status].to)}>{WO_NEXT[wo.status].label}</Button>}
                  <Link href={`/incidents/${id}/verify`}><Button size="sm" variant="primary">Follow-up & verification <ArrowRight size={13} /></Button></Link>
                </div>
              </div>
            )}
          </div>
          {wo.status === "completed" && <p className="px-5 pb-4 text-xs text-amber">Work order complete does not mean the anomaly is gone. Load follow-up readings so the Verifier can compare them with the baseline.</p>}
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Priority rationale" subtitle="Documented deterministic triage rules — decision support" icon={<Scale size={15} />} right={<span className="num text-[10px] text-faint">{tri.rules_version}</span>} />
            <div className="px-5 py-4">
              <div className="flex items-center gap-3">
                <span className={cx("num grid h-12 w-12 place-items-center rounded-lg text-lg font-bold", tri.escalation_required ? "bg-red-soft text-red" : "bg-amber-soft text-amber")}>{tri.priority}</span>
                <div>
                  <p className="text-sm font-semibold text-text">{tri.priority_label}</p>
                  <p className="text-xs text-muted">Recommended time-frame for a qualified engineer to look: <b className="text-text">{tri.timeframe}</b></p>
                </div>
              </div>
              {tri.escalation_required && (
                <p className="mt-3 flex gap-2 rounded-md border border-red/40 bg-red-soft p-2.5 text-xs text-red"><Siren size={14} className="shrink-0" /> {tri.escalation_basis}</p>
              )}
              {tri.insufficient_evidence && (
                <p className="mt-3 rounded-md border border-violet/40 bg-violet-soft p-2.5 text-xs text-violet">Evidence insufficient: {tri.insufficient_evidence_reason}</p>
              )}
              <p className="mt-3 text-xs text-muted"><b className="text-text">First action:</b> {tri.recommended_first_action}</p>
            </div>
            <div className="border-t border-line-soft px-5 py-4">
              <p className="mb-2 text-xs font-semibold text-text"><Term t="triage score">Demonstration triage score</Term> = <span className="num">{tri.demonstration_triage_score}</span></p>
              <table className="w-full text-xs">
                <thead className="text-[10px] uppercase tracking-wider text-faint"><tr><th className="py-1 text-left font-medium">Factor</th><th className="text-left font-medium">Observed</th><th className="text-right font-medium">Points</th></tr></thead>
                <tbody>
                  {tri.factors.map((f) => (
                    <tr key={f.name} className="border-t border-line-soft align-top" title={f.rule}>
                      <td className="py-1.5 pr-2 text-text">{f.name}</td><td className="py-1.5 pr-2 text-muted">{f.observed}</td>
                      <td className={cx("num py-1.5 text-right", f.points > 0 ? "text-amber" : f.points < 0 ? "text-blue" : "text-faint")}>{f.points > 0 ? "+" : ""}{f.points}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-line"><td className="py-1.5 font-semibold" colSpan={2}>Total</td><td className="num text-right font-semibold">{tri.demonstration_triage_score}</td></tr>
                </tbody>
              </table>
              <p className="num mt-3 text-[10px] leading-relaxed text-faint">{tri.score_formula}</p>
              <p className="mt-2 text-[11px] text-faint">Score → priority: ≥10 P1 (24 h) · 7–9 P2 (72 h) · 4–6 P3 (14 days) · ≤3 P4. Hover a factor for its rule. Not a risk or failure probability.</p>
            </div>
            {d.triage.length > 1 && (
              <div className="border-t border-line-soft px-5 py-3 text-xs">
                <p className="mb-1 font-semibold text-text">Triage history</p>
                {d.triage.map((t, i) => <p key={i} className="num text-muted">{i + 1}. {t.priority} · {t._reason.replaceAll("_", " ")} · {fmtSim(t._sim_time)}</p>)}
              </div>
            )}
          </Card>
          <Card className="p-4 text-xs text-muted">
            <p className="font-semibold text-text">Human approval gate</p>
            <p className="mt-1">The Response Planner only drafts proposals. Approve, edit or reject requires the engineer or asset-owner role; every decision is appended to the audit trail. The system never orders closures or evacuations — any operational decision rests with the responsible engineer and asset owner.</p>
            {wo.plan_text && <p className="mt-2 text-[11px]">Plan wording: {wo.plan_text.source === "llm" ? `LLM draft (${wo.plan_text.model})` : "deterministic fallback"}.</p>}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Field({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="min-w-0"><p className="text-[11px] text-faint">{k}</p><div className="mt-1 text-sm font-medium text-text">{v}</div></div>;
}
