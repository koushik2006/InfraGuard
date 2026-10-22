"use client";

import { motion } from "framer-motion";
import { ArrowRight, Building2, ClipboardCheck, Landmark, Play, Radar, Spline, Unplug, Waves } from "lucide-react";
import Link from "next/link";
import { ActivityFeed } from "@/components/Activity";
import { BridgeSchematic } from "@/components/BridgeSchematic";
import { Sparkline } from "@/components/charts/Sparkline";
import { PipelineStepper } from "@/components/PipelineStepper";
import { latestIncident } from "@/components/shell/nav";
import { Badge, Button, Card, CardHeader, DataQualityChip, Empty, PageHeader, Skeleton, Stat, StatusChip, Term } from "@/components/ui";
import { useApi } from "@/lib/api";
import { ASSET_TYPE_LABEL, cx, FEATURE_LABEL, fmtNum, fmtSim, humanState } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { AssetSummary, IncidentDetail } from "@/lib/types";

const TYPE_ICON: Record<string, React.ElementType> = { bridge: Waves, building: Building2, retaining_wall: Landmark };

function AssetCard({ a }: { a: AssetSummary }) {
  const Icon = TYPE_ICON[a.type];
  const failing = a.sensors.filter((s) => s.health !== "ok");
  return (
    <Link href={`/assets/${a.asset_id}`} className="block focus-visible:outline-none">
      <Card active={a.status !== "No anomaly detected"} className="h-full p-4 transition-colors hover:border-faint">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-raised text-muted"><Icon size={18} aria-hidden /></span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-text">{a.name}</p>
              <p className="num text-[11px] text-faint">{a.asset_id} · {ASSET_TYPE_LABEL[a.type]}</p>
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <StatusChip status={a.status} size="sm" />
          {a.data_quality_issues.length > 0 && <DataQualityChip size="sm" label={`${a.data_quality_issues.length} sensor issue${a.data_quality_issues.length > 1 ? "s" : ""}`} />}
        </div>
        <div className="mt-4 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[11px] text-faint">{FEATURE_LABEL[a.display.feature]} · {a.display.sensor_id}</p>
            <p className="num mt-0.5 text-xl font-semibold leading-none text-text">{fmtNum(a.display.latest, a.display.unit === "Hz" ? 3 : 4)}<span className="ml-1 text-xs font-normal text-muted">{a.display.unit}</span></p>
            <p className="num mt-1 text-[11px] text-faint">median {fmtNum(a.display.median, 4)}</p>
          </div>
          <Sparkline points={a.display.sparkline} median={a.display.median} width={150} height={42} label={`${a.name} recent ${FEATURE_LABEL[a.display.feature]}`} />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line-soft pt-3 text-[11px]">
          <div>
            <p className="text-faint">Sensor health</p>
            <div className="mt-1 flex gap-1" aria-label={`${a.sensors.length - failing.length} of ${a.sensors.length} sensors OK`}>
              {a.sensors.map((s) => (
                <span key={s.sensor_id} title={`${s.sensor_id}: ${s.health} (${s.latest})`}
                  className={cx("h-2 w-4 rounded-sm", s.health === "ok" ? "bg-blue/70" : s.health === "degraded" ? "bg-violet/60" : "bg-violet")} />
              ))}
            </div>
          </div>
          <div>
            <p className="text-faint"><Term t="baseline">Baseline</Term></p>
            <p className="mt-1 capitalize text-text">{a.baseline.status.replace("_", " ")}</p>
          </div>
          <div>
            <p className="text-faint">Open incidents</p>
            <p className={cx("num mt-1", a.open_incidents ? "text-amber" : "text-text")}>{a.open_incidents}</p>
          </div>
        </div>
        <p className="num mt-2 text-[10px] text-faint">Updated {fmtSim(a.last_updated)} UTC · {a.threshold_label ?? a.thresholds.map((t) => t.label).join(", ")}</p>
      </Card>
    </Link>
  );
}

function ActiveIncident({ id }: { id: string }) {
  const { version } = useApp();
  const { data } = useApi<IncidentDetail>(`/api/incidents/${id}`, version);
  if (!data) return <Skeleton className="h-40" />;
  const tri = data.triage.at(-1);
  const awaiting = data.incident.state === "AWAITING_APPROVAL";
  return (
    <div className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="num text-sm font-semibold text-text">{id}</span>
            <Badge tone={data.incident.escalation ? "red" : "amber"}>{data.incident.escalation ? "Escalation required" : "Investigate"}</Badge>
            {tri && <Badge tone="neutral">{tri.priority} · {tri.timeframe}</Badge>}
          </div>
          <p className="mt-1 text-xs text-muted">
            {data.asset.name} · {data.event.primary_sensor_id} {FEATURE_LABEL[data.event.deviations[0]?.feature]} · since {fmtSim(data.event.onset_time)} · {humanState(data.incident.state)}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/incidents/${id}`}><Button size="sm">Investigation</Button></Link>
          <Link href={`/incidents/${id}/plan`}><Button size="sm" variant={awaiting ? "primary" : "secondary"}><ClipboardCheck size={13} /> {awaiting ? "Review proposal" : "Work order"}</Button></Link>
        </div>
      </div>
      <div className="mt-5"><PipelineStepper detail={data} compact /></div>
    </div>
  );
}

export default function CommandCentre() {
  const { state, sim } = useApp();
  if (!state) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-80" />
        <div className="grid gap-4 md:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-60" />)}</div>
      </div>
    );
  }
  const open = state.incidents.filter((i) => !i.closed);
  const awaiting = open.filter((i) => i.state === "AWAITING_APPROVAL");
  const dq = state.assets.flatMap((a) => a.data_quality_issues.map((d) => ({ asset: a.asset_id, d })));
  const escal = open.filter((i) => i.escalation);
  const primary = latestIncident(state);
  const atStart = state.sim.cursor === state.sim.monitor_start;
  return (
    <div>
      <PageHeader
        eyebrow={<><Radar size={13} /> Command Centre · run <span className="num">{state.run.run_id}</span></>}
        title="Monitored assets"
        subtitle={<>Each asset is compared only with its own <Term t="baseline">baseline</Term>. Status shows whether a persistent, quality-checked deviation exists — never whether a structure is sound.</>}
        right={awaiting.length > 0 ? (
          <Link href={`/incidents/${awaiting[0].incident_id}/plan`}><Button variant="primary"><ClipboardCheck size={15} /> Review proposal ({awaiting[0].incident_id})</Button></Link>
        ) : (
          <Button variant="primary" onClick={sim.toggle}><Play size={15} /> {state.sim.running ? "Pause replay" : atStart ? "Start live replay" : "Resume replay"}</Button>
        )}
      />
      <Card className="mb-5 grid grid-cols-2 gap-4 p-4 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Monitored assets" value={state.assets.length} sub="3 distinct baselines" />
        <Stat label="Active anomalies" value={open.length} tone={open.length ? "amber" : undefined} sub={open.length ? "Investigate" : "No anomaly detected"} />
        <Stat label="Awaiting human review" value={awaiting.length} tone={awaiting.length ? "amber" : undefined} sub="Proposals only" />
        <Stat label="Escalations" value={escal.length} tone={escal.length ? "red" : undefined} sub="Owner criterion exceeded" />
        <Stat label="Data-quality warnings" value={dq.length} tone={dq.length ? "violet" : undefined} sub="Kept separate from anomalies" />
      </Card>

      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-5">
          <div className="grid gap-4 md:grid-cols-3" data-coach="assets">
            {state.assets.map((a, k) => (
              <motion.div key={a.asset_id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: k * 0.04, duration: 0.2 }}>
                <AssetCard a={a} />
              </motion.div>
            ))}
          </div>
          <Card>
            <CardHeader title="Assets needing investigation" subtitle="Open anomaly incidents in this run, with the agent pipeline state"
              icon={<ClipboardCheck size={15} />} right={<span className="num text-xs text-faint">{open.length} open</span>} />
            {primary && open.length ? (
              <div className="divide-y divide-line-soft">
                {open.map((i) => <ActiveIncident key={i.incident_id} id={i.incident_id} />)}
              </div>
            ) : (
              <Empty icon={<Radar size={22} />} title="No anomaly detected in this run so far"
                body="The Sentinel checks every new window. Single spikes (for example a heavy vehicle) are logged as transients but do not alert. Press play, or run to the next event."
                action={<Button size="sm" onClick={sim.toEvent}>Run to next event <ArrowRight size={13} /></Button>} />
            )}
          </Card>
          <Card>
            <CardHeader title="Bridge sensor schematic" subtitle="Simulated explanatory overview — click through for sensor details" icon={<Spline size={15} />}
              right={<Link href="/schematic" className="text-xs font-medium text-blue hover:underline">Open schematic</Link>} />
            <div className="px-5 py-3"><BridgeSchematic compact /></div>
          </Card>
        </div>
        <div className="space-y-5">
          <Card>
            <CardHeader title="Data-quality warnings" subtitle="Sensor issues are not structural anomalies" icon={<Unplug size={15} />} />
            {dq.length ? (
              <ul className="divide-y divide-line-soft">{dq.map((x) => (
                <li key={x.d} className="flex items-center justify-between gap-2 px-5 py-2.5 text-xs">
                  <span className="text-violet">{x.d}</span><Link href={`/assets/${x.asset}`} className="num text-faint hover:text-text">{x.asset}</Link>
                </li>))}</ul>
            ) : <p className="px-5 py-4 text-xs text-muted">All sensors passed missing / stale / frozen / plausibility checks on the latest window.</p>}
          </Card>
          <Card>
            <CardHeader title="Recent agent activity" subtitle="From the persisted audit trail" right={<Link href="/audit" className="text-xs font-medium text-blue hover:underline">Audit log</Link>} />
            <ActivityFeed rows={state.activity} limit={14} dense />
          </Card>
          <Card className="p-4 text-xs text-muted">
            <p className="font-semibold text-text">Agent text drafting</p>
            <p className="mt-1">{state.llm.enabled ? `LLM drafting enabled (${state.llm.model}); validated against strict schemas with deterministic fallback.` : "LLM off (offline mode). Narratives use the deterministic fallback; detection, triage and workflow are always deterministic code."}</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
