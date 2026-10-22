"use client";

import { ArrowRight, BookOpenCheck, CircleHelp, FileQuestion, Lightbulb, ListTree, Microscope } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { TimeSeriesChart } from "@/components/charts/TimeSeriesChart";
import { IncidentHeader } from "@/components/IncidentHeader";
import { PipelineStepper } from "@/components/PipelineStepper";
import { Badge, Button, Card, CardHeader, Empty, SimulatedTag, Skeleton, Term } from "@/components/ui";
import { WhyFlaggedDrawer } from "@/components/WhyFlagged";
import { useApi } from "@/lib/api";
import { cx, FEATURE_LABEL, fmtNum, fmtSim, fmtZ } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { Claim, Hypothesis, IncidentDetail, Series } from "@/lib/types";

const SUPPORT_TONE = { strong: "amber", moderate: "blue", weak: "slate", insufficient: "slate" } as const;
const KIND_LABEL: Record<string, string> = {
  reading_window: "Readings", baseline: "Baseline", maintenance_record: "Maintenance", inspection_note: "Inspection",
  environment_record: "Environment", sensor_health: "Sensor health", prior_event: "Prior event",
};

function Cite({ id, onClick }: { id: string; onClick: (id: string) => void }) {
  return (
    <button onClick={() => onClick(id)} className="num rounded border border-blue/30 bg-blue-soft px-1 text-[10px] font-semibold text-blue hover:border-blue" aria-label={`Show evidence ${id}`}>
      {id}
    </button>
  );
}

function ClaimRow({ c, onCite }: { c: Claim; onCite: (id: string) => void }) {
  return (
    <li className="flex gap-2 text-xs leading-relaxed">
      <Badge tone={c.kind === "observation" ? "neutral" : "violet"} className="mt-0.5 shrink-0 self-start">{c.kind}</Badge>
      <span className="text-text">{c.text} <span className="inline-flex gap-1 align-middle">{c.refs.map((r) => <Cite key={r} id={r} onClick={onCite} />)}</span></span>
    </li>
  );
}

function HypothesisCard({ h, onCite }: { h: Hypothesis; onCite: (id: string) => void }) {
  return (
    <Card className={cx("p-4", h.rank === 1 && "card-active")}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="num text-[11px] text-faint">Rank {h.rank} · labelled <span className="text-violet">hypothesis</span></p>
          <p className="mt-0.5 text-sm font-semibold text-text">{h.title}</p>
        </div>
        <Badge tone={SUPPORT_TONE[h.support]} className="capitalize">{h.support} support · {h.support_points >= 0 ? "+" : ""}{h.support_points} pts</Badge>
      </div>
      <div className="mt-3 grid gap-3">
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">Evidence for</p>
          {h.evidence_for.length ? <ul className="space-y-1.5">{h.evidence_for.map((c, i) => <ClaimRow key={i} c={c} onCite={onCite} />)}</ul> : <p className="text-xs text-muted">None retrieved.</p>}
        </div>
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">Evidence against</p>
          {h.evidence_against.length ? <ul className="space-y-1.5">{h.evidence_against.map((c, i) => <ClaimRow key={i} c={c} onCite={onCite} />)}</ul> : <p className="text-xs text-muted">None retrieved.</p>}
        </div>
      </div>
    </Card>
  );
}

export default function InvestigationPage() {
  const { id } = useParams<{ id: string }>();
  const { version } = useApp();
  const { data: d, error } = useApi<IncidentDetail>(`/api/incidents/${id}`, version);
  const [why, setWhy] = useState(false);
  const [hl, setHl] = useState<string | null>(null);
  const sensor = d?.event.primary_sensor_id;
  const feat = d?.event.deviations[0]?.feature;
  const { data: series } = useApi<Series>(d && d.is_current_run ? `/api/assets/${d.asset.asset_id}/series?sensor_id=${sensor}&feature=${feat}&window=200` : null, version);

  useEffect(() => { if (new URLSearchParams(window.location.search).get("why")) setWhy(true); }, []);

  if (error) return <Empty icon={<FileQuestion size={22} />} title="Incident not found" body={error} />;
  if (!d) return <div className="space-y-4"><Skeleton className="h-16 w-96" /><Skeleton className="h-40" /><Skeleton className="h-80" /></div>;
  const inv = d.investigation;
  const e = d.event;
  const top = e.deviations[0];
  const onCite = (rid: string) => {
    setHl(rid);
    document.getElementById(`ev-${rid}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => setHl(null), 1800);
  };
  const awaiting = d.incident.state === "AWAITING_APPROVAL";

  return (
    <div>
      <IncidentHeader d={d} right={<>
        <Button onClick={() => setWhy(true)}><CircleHelp size={15} /> Why was this flagged?</Button>
        <Link href={`/incidents/${id}/plan`}><Button variant="primary">{awaiting ? "Review proposal" : "Inspection planner"} <ArrowRight size={15} /></Button></Link>
      </>} />

      <Card className="mb-5">
        <CardHeader title="Agent pipeline" subtitle="Five coordinated agents exchanging validated JSON objects. Click a step for its structured output and tool calls." icon={<ListTree size={15} />} />
        <div className="px-5 py-5"><PipelineStepper detail={d} /></div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[1fr_400px]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader title="What changed" subtitle="Computed observations — not conclusions" icon={<Microscope size={15} />} />
            <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
              <Fact k="Sensor · feature" v={<><span className="font-mono">{e.primary_sensor_id}</span> · {FEATURE_LABEL[top.feature]}</>} />
              <Fact k="Observed vs median" v={<span className="num">{fmtNum(top.value, 4)} vs {fmtNum(top.median, 4)} {top.unit}</span>} />
              <Fact k={<Term t="robust z-score">Robust z</Term>} v={<span className="num text-amber">{fmtZ(top.z)}</span>} />
              <Fact k="Since" v={<span className="num">{fmtSim(e.onset_time)}</span>} />
              <Fact k={<Term t="persistence">Persistence</Term>} v={<span className="num">{e.persistence_count} exceeding / rule {e.persistence_required} of {e.persistence_window}</span>} />
              <Fact k={<Term t="data-quality gate">Data quality</Term>} v={e.data_quality.passed ? "Gate passed" : "Gate failed"} />
              <Fact k={<Term t="corroboration">Corroboration</Term>} v={e.corroborating_sensors.length ? e.corroborating_sensors.join(", ") : "None"} />
              <Fact k={<Term t="change-point">Change-point</Term>} v={<span className="num">{fmtSim(e.change_point_time)}</span>} />
            </div>
            {e.data_quality.issues.length > 0 && <p className="border-t border-line-soft px-5 py-2.5 text-xs text-violet">Other data-quality issues in the window: {e.data_quality.issues.join("; ")}</p>}
            {series && <div className="border-t border-line-soft px-3 py-3"><TimeSeriesChart series={series} height={220} compact /></div>}
          </Card>

          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Competing hypotheses</h2>
              <span className="text-xs text-muted">Ranked by documented rule points · {inv?.rules_version}</span>
            </div>
            {inv ? <div className="grid gap-4 lg:grid-cols-3">{inv.hypotheses.map((h) => <HypothesisCard key={h.key} h={h} onCite={onCite} />)}</div> : <Skeleton className="h-60" />}
          </div>

          {inv && (
            <Card>
              <CardHeader title="Investigation summary" subtitle={inv.narrative.source === "llm" ? `Drafted by LLM (${inv.narrative.model}); validated against schema and citations` : "Deterministic fallback narrative (LLM off or failed validation)"}
                icon={<Lightbulb size={15} />} right={<Badge tone={inv.narrative.source === "llm" ? "blue" : "violet"}>{inv.narrative.source === "llm" ? "LLM draft" : "Fallback"}</Badge>} />
              <div className="px-5 py-4 text-sm leading-relaxed text-text">
                <p>{inv.narrative.summary}</p>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted">{inv.narrative.key_points.map((k) => <li key={k}>{k}</li>)}</ul>
                <p className="mt-3 flex flex-wrap items-center gap-1 text-[11px] text-faint">Cites {inv.narrative.citations.map((c) => <Cite key={c} id={c} onClick={onCite} />)}</p>
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-5">
          {inv && (
            <Card className="border-amber/30">
              <CardHeader title="What evidence is missing" subtitle="Uncertainty the inspection should close" icon={<FileQuestion size={15} />} />
              <ul className="space-y-2 px-5 py-4">{inv.missing_evidence.map((m) => (
                <li key={m} className="flex gap-2 text-xs text-text"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber" />{m}</li>
              ))}</ul>
            </Card>
          )}
          {inv && (
            <Card>
              <CardHeader title="Evidence timeline" subtitle={`${inv.evidence_refs.length} references retrieved by the Investigator`} icon={<BookOpenCheck size={15} />} />
              <ol className="max-h-[720px] divide-y divide-line-soft overflow-y-auto">
                {[...inv.evidence_refs].sort((a, b) => (a.timestamp ?? "9").localeCompare(b.timestamp ?? "9")).map((r) => (
                  <li key={r.ref_id} id={`ev-${r.ref_id}`} className={cx("px-5 py-3 transition-colors", hl === r.ref_id && "bg-blue-soft")}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2"><span className="num text-xs font-semibold text-blue">{r.ref_id}</span><Badge tone="neutral">{KIND_LABEL[r.kind] ?? r.kind}</Badge></span>
                      <SimulatedTag />
                    </div>
                    <p className="mt-1 text-xs font-medium text-text">{r.title}</p>
                    <p className="mt-0.5 text-xs text-muted">{r.summary}</p>
                    <p className="num mt-1 text-[10px] text-faint">{r.source_id}{r.timestamp ? ` · ${r.timestamp.slice(0, 16).replace("T", " ")}` : ""}</p>
                  </li>
                ))}
              </ol>
            </Card>
          )}
          {inv && (
            <Card>
              <CardHeader title="Investigator tool calls" subtitle="Real retrieval calls with timings" />
              <ul className="divide-y divide-line-soft">{inv.tool_calls.map((c, i) => (
                <li key={i} className="flex items-center justify-between gap-2 px-5 py-2 text-xs">
                  <span className="font-mono text-blue">{c.name}</span><span className="truncate text-muted">{c.result_summary}</span><span className="num shrink-0 text-faint">{c.duration_ms.toFixed(2)} ms</span>
                </li>
              ))}</ul>
            </Card>
          )}
        </div>
      </div>
      <WhyFlaggedDrawer open={why} onClose={() => setWhy(false)} d={d} />
    </div>
  );
}

function Fact({ k, v }: { k: React.ReactNode; v: React.ReactNode }) {
  return <div className="min-w-0"><p className="text-[11px] text-faint">{k}</p><p className="mt-1 truncate text-sm text-text">{v}</p></div>;
}
