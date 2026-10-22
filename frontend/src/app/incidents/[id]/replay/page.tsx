"use client";

import { motion, useReducedMotion } from "framer-motion";
import { CheckCircle2, CircleAlert, History, Lock, Play } from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ActorIcon } from "@/components/Activity";
import { IncidentHeader } from "@/components/IncidentHeader";
import { Badge, Button, Card, CardHeader, Empty, Skeleton } from "@/components/ui";
import { post, useApi } from "@/lib/api";
import { cx, fmtSim, fmtWall } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { IncidentDetail } from "@/lib/types";

interface Step { step: string; label: string; recorded: unknown; replayed: unknown; match: boolean; narrative_note?: string; tool_calls?: unknown[] }
interface ReplayResult {
  replay_id: string; status: "REPRODUCED" | "DISCREPANCY"; read_only: boolean; replayed_at: string; scenario_seed: number;
  baseline_version: string; detection_params: Record<string, unknown>; versions: { recorded: Record<string, string>; current: Record<string, string> };
  version_changes: Record<string, unknown>; steps: Step[]; diff: { field: string; before: unknown; after: unknown }[];
  discrepancies: string[]; fields_compared: number; history_mutations: string | Record<string, unknown>; note: string;
  timeline: { id: number; ts: string; sim_time: string; actor: string; actor_type: string; action: string; summary: string; from_state: string | null; to_state: string | null; replay_check: boolean | null }[];
  run_config: { seed: number; variants: Record<string, string>; environment: string; interventions: unknown[] };
}

const show = (v: unknown) => (Array.isArray(v) ? v.join(" · ") : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v ?? "—"));

export default function ReplayPage() {
  const { id } = useParams<{ id: string }>();
  const { version, pushToast } = useApp();
  const { data: d } = useApi<IncidentDetail>(`/api/incidents/${id}`, version);
  const [r, setR] = useState<ReplayResult | null>(null);
  const [busy, setBusy] = useState(false);
  const reduce = useReducedMotion();

  const run = async () => {
    setBusy(true);
    try {
      const res = await post<ReplayResult>(`/api/incidents/${id}/replay`);
      setR(res);
      pushToast({ tone: res.status === "REPRODUCED" ? "blue" : "red", title: `Replay ${res.replay_id}: ${res.status}`, body: `${res.fields_compared} decision fields compared` });
    } catch (e) { pushToast({ tone: "red", title: "Replay failed", body: (e as Error).message }); }
    setBusy(false);
  };

  if (!d) return <div className="space-y-4"><Skeleton className="h-16 w-96" /><Skeleton className="h-96" /></div>;
  return (
    <div>
      <IncidentHeader d={d} right={<Button variant="primary" onClick={run} disabled={busy} data-coach="replay-run"><Play size={15} /> {busy ? "Replaying…" : r ? "Replay again" : "Replay investigation"}</Button>} />
      <div className="mb-5 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-raised px-4 py-3 text-xs text-muted">
        <Lock size={14} className="text-faint" />
        Read-only: re-runs the incident from its recorded seed, inputs, baseline version, detection parameters, fixtures and workflow inputs.
        Human approvals are shown as recorded inputs — never duplicated. No work orders or audit events are created.
      </div>
      {!r ? (
        <Card><Empty icon={<History size={22} />} title="Replay this incident" body="The replay regenerates the simulated readings and data-quality flags, re-derives the baseline, re-runs every agent and diffs the decisions against what was recorded."
          action={<Button variant="primary" onClick={run} disabled={busy}><Play size={14} /> Replay investigation</Button>} /></Card>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
          <div className="min-w-0 space-y-5">
            <Card active>
              <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                <div className="flex items-center gap-3">
                  {r.status === "REPRODUCED" ? <CheckCircle2 size={28} className="text-blue" /> : <CircleAlert size={28} className="text-red" />}
                  <div>
                    <p className={cx("text-lg font-semibold", r.status === "REPRODUCED" ? "text-blue" : "text-red")}>{r.status === "REPRODUCED" ? "Reproduced" : "Reproducibility discrepancy"}</p>
                    <p className="num text-xs text-muted">{r.replay_id} · {r.fields_compared} decision fields compared · {r.diff.length} differ · {fmtWall(r.replayed_at)}</p>
                  </div>
                </div>
                <div className="num grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                  <span className="text-faint">Seed</span><span className="text-text">{r.scenario_seed}</span>
                  <span className="text-faint">Baseline</span><span className="text-text">{r.baseline_version}</span>
                  <span className="text-faint">History mutations</span><span className="text-text">{typeof r.history_mutations === "string" ? "none" : JSON.stringify(r.history_mutations)}</span>
                </div>
              </div>
              {r.discrepancies.length > 0 && <ul className="border-t border-red/30 bg-red-soft px-5 py-3 text-xs text-red">{r.discrepancies.map((x) => <li key={x}>• {x}</li>)}</ul>}
            </Card>
            <Card>
              <CardHeader title="Chronological replay timeline" subtitle="Every row is a persisted audit event; replay checks are attached where a step was re-executed" icon={<History size={15} />} />
              <ol className="relative px-5 py-4">
                <span className="absolute bottom-6 left-[29px] top-6 w-px bg-line" aria-hidden />
                {r.timeline.map((t, i) => (
                  <motion.li key={t.id} initial={reduce ? false : { opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: reduce ? 0 : i * 0.03, duration: 0.18 }} className="relative flex gap-3 py-2">
                    <span className="z-10 mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-line bg-surface"><ActorIcon type={t.actor_type} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-medium text-text">{t.actor}</span>
                        <span className="font-mono text-[10px] text-faint">{t.action}</span>
                        {t.replay_check === true && <Badge tone="blue">replay ✓ match</Badge>}
                        {t.replay_check === false && <Badge tone="red">replay ✗ differs</Badge>}
                        <span className="num ml-auto text-[10px] text-faint">{fmtSim(t.sim_time)} · rec {fmtWall(t.ts)}</span>
                      </div>
                      <p className="text-xs text-muted">{t.summary}</p>
                    </div>
                  </motion.li>
                ))}
              </ol>
            </Card>
          </div>
          <div className="space-y-5">
            <Card>
              <CardHeader title="Re-executed steps" subtitle="Recorded vs replayed" />
              <ul className="divide-y divide-line-soft">
                {r.steps.map((s, i) => (
                  <li key={i} className="px-5 py-3 text-xs">
                    <div className="flex items-center justify-between gap-2"><span className="font-medium text-text">{s.label}</span>
                      {s.match ? <Badge tone="blue">match</Badge> : <Badge tone="red">differs</Badge>}</div>
                    <p className="num mt-1 text-faint">recorded: <span className="text-muted">{show(s.recorded)}</span></p>
                    <p className="num text-faint">replayed: <span className="text-muted">{show(s.replayed)}</span></p>
                    {s.narrative_note && <p className="mt-1 text-[11px] text-faint">{s.narrative_note}</p>}
                  </li>
                ))}
              </ul>
            </Card>
            <Card>
              <CardHeader title="Decision diff" subtitle="Recorded result vs replay result" />
              {r.diff.length === 0 ? <p className="px-5 py-4 text-xs text-muted">No differences across {r.fields_compared} decision fields (narrative wording excluded).</p> : (
                <table className="w-full text-xs"><tbody>{r.diff.map((x) => (
                  <tr key={x.field} className="border-t border-line-soft align-top"><td className="px-5 py-2 font-mono text-text">{x.field}</td><td className="py-2 text-muted">{show(x.before)}</td><td className="py-2 pr-5 text-red">{show(x.after)}</td></tr>
                ))}</tbody></table>
              )}
            </Card>
            <Card>
              <CardHeader title="Recorded versions" subtitle="Software and rule versions at incident time vs now" />
              <table className="num w-full text-xs"><tbody>{Object.entries(r.versions.recorded).map(([k, v]) => (
                <tr key={k} className="border-t border-line-soft"><td className="px-5 py-1.5 text-faint">{k}</td><td className="py-1.5 text-text">{v}</td>
                  <td className={cx("py-1.5 pr-5 text-right", r.versions.current[k] === v ? "text-faint" : "text-red")}>{r.versions.current[k] === v ? "unchanged" : r.versions.current[k]}</td></tr>
              ))}</tbody></table>
            </Card>
            <Card className="p-4 text-xs text-muted">
              <p className="font-semibold text-text">Recorded scenario inputs</p>
              <p className="num mt-1">seed {r.run_config.seed} · env {r.run_config.environment} · {Object.entries(r.run_config.variants).map(([a, v]) => `${a}:${v}`).join(", ")} · {r.run_config.interventions.length} intervention(s)</p>
              <p className="mt-2">{r.note}</p>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
