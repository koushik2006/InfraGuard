"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Bot, Check, ChevronDown, CircleDashed, ClipboardList, Hourglass, Loader2, Radar, Scale, ScanSearch, ShieldQuestion, UserCheck, Wrench, X } from "lucide-react";
import { useState } from "react";
import { cx, fmtWall } from "@/lib/format";
import type { AgentRun, IncidentDetail } from "@/lib/types";

type StepStatus = "idle" | "running" | "done" | "fallback_used" | "waiting" | "approved" | "rejected" | "error";

interface StepDef { key: string; label: string; role: string; icon: React.ElementType; human?: boolean }

const STEPS: StepDef[] = [
  { key: "sentinel", label: "Sentinel", role: "Quality checks · robust z · persistence", icon: Radar },
  { key: "investigator", label: "Investigator", role: "Evidence · hypotheses · gaps", icon: ScanSearch },
  { key: "prioritiser", label: "Prioritiser", role: "Documented triage rules", icon: Scale },
  { key: "planner", label: "Planner", role: "Inspection plan · work-order proposal", icon: ClipboardList },
  { key: "human", label: "Human approval", role: "Qualified engineer decides", icon: UserCheck, human: true },
  { key: "verifier", label: "Verifier", role: "Follow-up vs baseline", icon: ShieldQuestion },
];

const RUNNING_STATE: Record<string, string> = { INVESTIGATING: "investigator", PRIORITISING: "prioritiser", PLANNING: "planner", VERIFYING: "verifier" };

function statusFor(step: StepDef, d: IncidentDetail): { status: StepStatus; run?: AgentRun } {
  const state = d.incident.state;
  if (step.human) {
    const last = d.approvals.at(-1);
    if (state === "AWAITING_APPROVAL") return { status: "waiting" };
    if (!last) return { status: "idle" };
    return { status: last.decision === "reject" ? (state === "REJECTED" ? "rejected" : "waiting") : "approved" };
  }
  const runs = d.agent_runs.filter((r) => r.agent === step.key);
  const run = runs.at(-1);
  if (RUNNING_STATE[state] === step.key) return { status: "running", run };
  if (!run) return { status: "idle" };
  return { status: run.status as StepStatus, run };
}

const STATUS_STYLE: Record<StepStatus, { ring: string; text: string; label: string; Icon: React.ElementType }> = {
  idle: { ring: "border-line text-faint", text: "text-faint", label: "Idle", Icon: CircleDashed },
  running: { ring: "border-blue text-blue", text: "text-blue", label: "Running", Icon: Loader2 },
  done: { ring: "border-blue bg-blue text-white", text: "text-blue", label: "Done", Icon: Check },
  fallback_used: { ring: "border-violet bg-violet-soft text-violet", text: "text-violet", label: "Done · fallback used", Icon: Wrench },
  waiting: { ring: "border-amber bg-amber-soft text-amber", text: "text-amber", label: "Awaiting human", Icon: Hourglass },
  approved: { ring: "border-blue bg-blue text-white", text: "text-blue", label: "Approved by human", Icon: UserCheck },
  rejected: { ring: "border-red bg-red-soft text-red", text: "text-red", label: "Rejected", Icon: X },
  error: { ring: "border-red text-red", text: "text-red", label: "Error", Icon: X },
};

export function PipelineStepper({ detail, compact = false }: { detail: IncidentDetail; compact?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const reduce = useReducedMotion();
  const items = STEPS.map((s) => ({ def: s, ...statusFor(s, detail) }));
  const openItem = items.find((i) => i.def.key === open);
  return (
    <div data-coach="pipeline">
      <ol className={cx("grid gap-0", compact ? "grid-cols-6" : "grid-cols-6")} aria-label="Agent pipeline">
        {items.map((it, idx) => {
          const st = STATUS_STYLE[it.status];
          const Icon = it.def.icon;
          const SIcon = st.Icon;
          const next = items[idx + 1];
          const filled = ["done", "fallback_used", "approved"].includes(it.status);
          return (
            <li key={it.def.key} className="relative flex flex-col items-center text-center">
              {next && (
                <div className="absolute left-1/2 top-[19px] h-[2px] w-full bg-line" aria-hidden>
                  <motion.div className="h-full bg-blue" initial={false} animate={{ width: filled ? "100%" : "0%" }} transition={{ duration: reduce ? 0 : 0.25 }} />
                </div>
              )}
              <button
                onClick={() => setOpen(open === it.def.key ? null : it.def.key)}
                disabled={compact}
                aria-expanded={open === it.def.key}
                aria-label={`${it.def.label}: ${st.label}`}
                className={cx("relative z-10 grid h-10 w-10 place-items-center rounded-full border-2 bg-surface transition-colors", st.ring,
                  !compact && "hover:scale-105", open === it.def.key && "ring-4 ring-blue/20")}
              >
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span key={it.status} initial={reduce ? false : { scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={{ duration: 0.18 }}>
                    {it.status === "idle" ? <Icon size={16} /> : <SIcon size={16} className={it.status === "running" ? "animate-spin" : ""} />}
                  </motion.span>
                </AnimatePresence>
              </button>
              <div className="mt-2 px-1">
                <div className="flex items-center justify-center gap-1 text-xs font-semibold text-text">
                  {it.def.human ? <UserCheck size={11} className="text-faint" aria-hidden /> : <Bot size={11} className="text-faint" aria-hidden />}
                  {it.def.label}
                </div>
                <div className={cx("text-[11px] font-medium", st.text)}>{st.label}</div>
                {!compact && <div className="mt-0.5 text-[10px] leading-tight text-faint">{it.def.role}</div>}
                {!compact && it.run && <div className="num mt-0.5 text-[10px] text-faint">{it.run.duration_ms.toFixed(1)} ms · {it.run.tool_calls.length} tool call(s)</div>}
              </div>
              {!compact && (
                <ChevronDown size={12} className={cx("mt-1 text-faint transition-transform", open === it.def.key && "rotate-180")} aria-hidden />
              )}
            </li>
          );
        })}
      </ol>
      <AnimatePresence initial={false}>
        {!compact && openItem && (
          <motion.div key={openItem.def.key} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: reduce ? 0 : 0.2 }} className="overflow-hidden">
            <StepDetail item={openItem} detail={detail} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StepDetail({ item, detail }: { item: { def: StepDef; status: StepStatus; run?: AgentRun }; detail: IncidentDetail }) {
  if (item.def.human) {
    return (
      <div className="mt-4 rounded-lg border border-line bg-raised p-4 text-xs">
        <p className="font-semibold text-text">Human approval gate</p>
        <p className="mt-1 text-muted">Agents never issue work orders, closures or evacuations. A user with the engineer or asset-owner role must approve, edit or reject the proposal.</p>
        {detail.approvals.length === 0 ? <p className="mt-2 text-amber">No decision recorded yet.</p> :
          <ul className="mt-2 space-y-1">{detail.approvals.map((a) => (
            <li key={a.approval_id} className="num text-text">{a.approval_id} · {a.decision} · {a.actor} ({a.role}) · {fmtWall(a.timestamp)}</li>
          ))}</ul>}
      </div>
    );
  }
  const run = item.run;
  if (!run) return <div className="mt-4 rounded-lg border border-line bg-raised p-4 text-xs text-muted">This agent has not run for this incident yet.</div>;
  return (
    <div className="mt-4 grid gap-3 rounded-lg border border-line bg-raised p-4 text-xs lg:grid-cols-2">
      <div className="min-w-0">
        <p className="mb-2 font-semibold text-text">Tool calls <span className="font-normal text-faint">(real function calls, timed)</span></p>
        {run.tool_calls.length === 0 ? <p className="text-muted">No external tool calls — pure rule evaluation on structured inputs.</p> : (
          <table className="w-full text-left">
            <thead className="text-[10px] uppercase tracking-wider text-faint"><tr><th className="py-1 pr-2">Tool</th><th className="py-1 pr-2">Result</th><th className="py-1 text-right">ms</th></tr></thead>
            <tbody>
              {run.tool_calls.map((c, i) => (
                <tr key={i} className="border-t border-line-soft align-top">
                  <td className="py-1.5 pr-2 font-mono text-[11px] text-blue">{c.name}</td>
                  <td className="py-1.5 pr-2 text-muted">{c.result_summary}</td>
                  <td className="num py-1.5 text-right text-faint">{c.duration_ms.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {run.fallback_used && (
          <p className="mt-3 rounded-md border border-violet/30 bg-violet-soft p-2 text-violet">
            Deterministic fallback used for text drafting: {run.fallback_reason}. Decisions are rule-based and unaffected.
          </p>
        )}
        <p className="num mt-3 text-faint">Started {fmtWall(run.started_at)} · finished {fmtWall(run.finished_at)} · {run.duration_ms.toFixed(2)} ms</p>
      </div>
      <div className="min-w-0">
        <p className="mb-2 font-semibold text-text">Structured output <span className="font-normal text-faint">(validated JSON contract)</span></p>
        <pre className="max-h-72 overflow-auto rounded-md border border-line-soft bg-bg p-3 font-mono text-[10.5px] leading-relaxed text-muted">{JSON.stringify(run.output, null, 2)}</pre>
      </div>
    </div>
  );
}
