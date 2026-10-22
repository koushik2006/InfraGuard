"use client";

import { CircleSlash, FileClock, Lock, ScrollText, ShieldQuestion, TrendingDown, TrendingUp } from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";
import { AuditTable } from "@/components/Activity";
import { TimeSeriesChart } from "@/components/charts/TimeSeriesChart";
import { IncidentHeader } from "@/components/IncidentHeader";
import { Badge, Button, Card, CardHeader, Empty, Skeleton } from "@/components/ui";
import { post, useApi } from "@/lib/api";
import { cx, FEATURE_LABEL, fmtNum, fmtSim, fmtWall, fmtZ } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { IncidentDetail, Series, Verification } from "@/lib/types";

const SETS = [
  { set: "persists", title: "Deviation persists", body: "Follow-up windows generated with the deviation still present." },
  { set: "improves", title: "Returns toward baseline", body: "Follow-up windows generated without the deviation." },
  { set: "insufficient", title: "Logger outage", body: "Only every 4th follow-up window is delivered." },
] as const;

const OUTCOME = {
  persists: { tone: "amber" as const, Icon: TrendingUp },
  improves: { tone: "blue" as const, Icon: TrendingDown },
  cannot_assess: { tone: "slate" as const, Icon: CircleSlash },
};

function Outcome({ v }: { v: Verification }) {
  const o = OUTCOME[v.outcome];
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <span className={cx("grid h-11 w-11 place-items-center rounded-lg", o.tone === "amber" ? "bg-amber-soft text-amber" : o.tone === "blue" ? "bg-blue-soft text-blue" : "bg-slate-soft text-muted")}><o.Icon size={20} /></span>
        <div>
          <p className="text-base font-semibold text-text">{v.outcome === "cannot_assess" ? "Cannot assess" : v.outcome === "persists" ? "Persists" : "Improves"}</p>
          <p className="text-xs text-muted">{v.outcome_label} · follow-up set “{v.follow_up_set}” · {v._id}</p>
        </div>
      </div>
      <table className="mt-4 w-full text-xs">
        <thead className="text-[10px] uppercase tracking-wider text-faint"><tr><th className="py-1 text-left font-medium">Feature</th><th className="text-right font-medium">Pre median z</th><th className="text-right font-medium">Post median z</th><th className="text-right font-medium">Post exceeding</th><th className="text-right font-medium">Valid windows</th></tr></thead>
        <tbody>
          {v.metrics.map((m) => (
            <tr key={m.feature} className="num border-t border-line-soft">
              <td className="py-1.5 font-sans text-text">{FEATURE_LABEL[m.feature] ?? m.feature}</td>
              <td className="text-right text-amber">{fmtZ(m.pre_median_z)}</td>
              <td className={cx("text-right", m.post_median_z !== null && Math.abs(m.post_median_z) >= m.z_threshold ? "text-amber" : "text-text")}>{fmtZ(m.post_median_z)}</td>
              <td className="text-right">{m.post_fraction_exceeding === null ? "—" : `${Math.round(m.post_fraction_exceeding * 100)}%`}</td>
              <td className={cx("text-right", m.post_windows_valid < m.post_windows_total / 2 ? "text-violet" : "")}>{m.post_windows_valid} / {m.post_windows_total}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="mt-3 space-y-1 text-xs text-muted">{v.reasoning.map((r) => <li key={r}>• {r}</li>)}</ul>
      <p className="mt-3 rounded-md border border-line bg-raised p-2.5 text-xs text-text"><b>Incident status:</b> {v.incident_status}</p>
    </div>
  );
}

export default function VerifyPage() {
  const { id } = useParams<{ id: string }>();
  const { version, user, pushToast, refresh } = useApp();
  const { data: d, reload } = useApi<IncidentDetail>(`/api/incidents/${id}`, version);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const sensor = d?.event.primary_sensor_id;
  const feat = d?.event.deviations[0]?.feature;
  const { data: series } = useApi<Series>(d?.is_current_run ? `/api/assets/${d.asset.asset_id}/series?sensor_id=${sensor}&feature=${feat}&window=120` : null, version);

  if (!d) return <div className="space-y-4"><Skeleton className="h-16 w-96" /><Skeleton className="h-96" /></div>;
  const latest = d.verifications.at(-1);
  const load = async (set: string) => {
    setBusy(set);
    try {
      const r = await post<Verification>(`/api/incidents/${id}/follow-up`, { set, actor: user.name, role: user.role });
      pushToast({ tone: r.outcome === "persists" ? "amber" : r.outcome === "improves" ? "blue" : "slate", title: `Verifier: ${r.outcome_label}`, body: r.incident_status });
    } catch (e) { pushToast({ tone: "red", title: "Follow-up not loaded", body: (e as Error).message }); }
    setBusy(null); await reload(); await refresh();
  };
  const close = async () => {
    try { await post(`/api/incidents/${id}/close`, { actor: user.name, role: user.role, note }); pushToast({ tone: "slate", title: `${id} closed by ${user.name}` }); }
    catch (e) { pushToast({ tone: "red", title: "Cannot close", body: (e as Error).message }); }
    await reload(); await refresh();
  };
  const incSeries = series ? { ...series, follow_up: series.follow_up.filter((p) => p.incident_id === id) } : undefined;

  return (
    <div>
      <IncidentHeader d={d} />
      <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader title="Pre- and post-intervention readings" subtitle={`${sensor} · ${FEATURE_LABEL[feat ?? ""]} · baseline band, anomaly interval and follow-up readings (violet)`} icon={<FileClock size={15} />} />
            <div className="px-3 py-3">{incSeries ? <TimeSeriesChart series={incSeries} height={300} /> : <Skeleton className="h-[300px]" />}</div>
          </Card>
          <Card data-coach="audit">
            <CardHeader title="Audit trail" subtitle="Append-only, timestamped record of every transition, agent run and human decision (database triggers block edits)" icon={<ScrollText size={15} />}
              right={<span className="num text-xs text-faint">{d.audit.length} events</span>} />
            <div className="max-h-[520px] overflow-y-auto"><AuditTable rows={d.audit} /></div>
          </Card>
        </div>
        <div className="space-y-5">
          <Card data-coach="follow-up">
            <CardHeader title="Load follow-up readings" subtitle="Predefined SIMULATED follow-up sets, generated deterministically and processed by the Verifier" icon={<ShieldQuestion size={15} />} />
            <div className="space-y-2 px-5 py-4">
              {!d.follow_up_allowed && (
                <p className="mb-2 flex items-center gap-2 rounded-md border border-line bg-raised p-2.5 text-xs text-muted"><Lock size={13} /> Available after a human approves the work order (current state: {d.incident.state.replaceAll("_", " ").toLowerCase()}).</p>
              )}
              {SETS.map((s) => (
                <button key={s.set} disabled={!d.follow_up_allowed || busy !== null} onClick={() => load(s.set)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border border-line bg-raised px-3 py-2.5 text-left transition-colors hover:border-faint disabled:cursor-not-allowed disabled:opacity-45">
                  <span><span className="block text-sm font-medium text-text">{s.title}</span><span className="block text-xs text-muted">{s.body}</span></span>
                  <span className="font-mono text-[11px] text-faint">{busy === s.set ? "running…" : s.set}</span>
                </button>
              ))}
            </div>
          </Card>
          <Card>
            <CardHeader title="Verifier — monitoring outcome" subtitle="Persists · improves · cannot assess. Never a safety verdict." icon={<ShieldQuestion size={15} />} />
            <div className="px-5 py-4">
              {latest ? <Outcome v={latest} /> : <Empty title="No follow-up readings yet" body="After approval, load a follow-up set. The Verifier compares it with the baseline and the pre-intervention windows." />}
            </div>
            {d.verifications.length > 1 && (
              <div className="border-t border-line-soft px-5 py-3">
                <p className="mb-1 text-xs font-semibold">Verification history</p>
                {d.verifications.map((v) => <p key={v._id} className="num text-xs text-muted">{v._id} · {v.follow_up_set} → <span className="text-text">{v.outcome}</span> · {fmtSim(v._sim_time)}</p>)}
              </div>
            )}
            <p className="border-t border-line-soft px-5 py-3 text-[11px] text-faint">{latest?.disclaimer ?? "Monitoring outcome only. This is not a structural-safety verdict."}</p>
          </Card>
          <Card>
            <CardHeader title="Incident closure" subtitle="Human-only. Allowed only after the Verifier reports “improves”." />
            <div className="px-5 py-4 text-xs">
              {d.incident.closed ? <p className="text-muted">Closed by a human reviewer. History is retained.</p> :
                d.incident.state === "MONITORING_IMPROVED" && user.role !== "viewer" ? (
                  <div className="space-y-2">
                    <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Closure note (required): what the inspection found and why closure is justified"
                      aria-label="Closure note" className="w-full rounded-md border border-line bg-raised p-2 text-sm text-text" />
                    <Button size="sm" disabled={!note.trim()} onClick={close}>Close incident as reviewer</Button>
                  </div>
                ) : <p className="text-muted">The incident stays open: {d.state_text.replace("Open — ", "")}.</p>}
            </div>
          </Card>
          <Card>
            <CardHeader title="Approval history" />
            <ul className="divide-y divide-line-soft">
              {d.approvals.length === 0 && <li className="px-5 py-3 text-xs text-muted">No human decisions yet.</li>}
              {d.approvals.map((a) => (
                <li key={a.approval_id} className="px-5 py-2.5 text-xs">
                  <div className="flex items-center justify-between"><span className="num font-semibold text-text">{a.approval_id}</span><Badge tone={a.decision === "reject" ? "slate" : "blue"}>{a.decision.replace("_", " & ")}</Badge></div>
                  <p className="mt-0.5 text-muted">{a.actor} ({a.role}) · {a.work_order_id} · <span className="num">{fmtWall(a.timestamp)}</span></p>
                  {a.note && <p className="mt-0.5 text-muted">“{a.note}”</p>}
                  {a.edits && <p className="num mt-0.5 text-faint">edits: {Object.keys(a.edits).join(", ")}</p>}
                </li>
              ))}
            </ul>
          </Card>
          <p className="px-1 text-[11px] text-faint">Baseline <span className="num">{d.event.baseline_version}</span> · median {fmtNum(d.event.deviations[0]?.median, 4)} {d.event.deviations[0]?.unit}</p>
        </div>
      </div>
    </div>
  );
}
