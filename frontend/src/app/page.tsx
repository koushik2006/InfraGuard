"use client";

import { MotionConfig } from "framer-motion";
import { ArrowRight, Box } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ActivityFeed } from "@/components/Activity";
import { Sparkline } from "@/components/charts/Sparkline";
import { CountUp, OvCard, Reveal } from "@/components/overview/motion";
import { OverviewJourney } from "@/components/overview/OverviewJourney";
import { SensorHealthRing } from "@/components/overview/SensorHealthRing";
import { TelemetryPanel } from "@/components/overview/TelemetryPanel";
import { RunToEventButton } from "@/components/RunToEvent";
import type { SensorsResp } from "@/components/twin/sensors";
import { Badge, Button, CardHeader, Empty, Skeleton, Stat, StatusChip } from "@/components/ui";
import { useApi } from "@/lib/api";
import { FEATURE_LABEL, fmtSim, fmtZ } from "@/lib/format";
import { useApp } from "@/lib/store";
import { nextAction, STATE_LABEL } from "@/lib/workflow";

interface WorkOrderRow { work_order_id: string; status: string }
const PRE_APPROVAL = ["DETECTED", "INVESTIGATING", "PRIORITISING", "PLANNING", "AWAITING_APPROVAL", "REJECTED"];

/** KPI card: glass surface over the hero image, count-up value, optional sparkline of real recent readings. */
function Kpi({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <OvCard className="p-5 backdrop-blur-sm" style={{ background: "color-mix(in srgb, var(--surface) 72%, transparent)", borderColor: accent ? "color-mix(in srgb, var(--amber) 40%, var(--line))" : undefined }}>
      {children}
    </OvCard>
  );
}

export default function Overview() {
  const { state, version } = useApp();
  const { data: wos } = useApi<WorkOrderRow[]>("/api/work-orders", version);
  const { data: twin } = useApi<SensorsResp>("/api/assets/BRG-017/sensors", version);
  const [pick, setPick] = useState<string | null>(null);
  const sensors = useMemo(() => twin?.sensors ?? [], [twin]);
  // default chart sensor: the open incident's primary finding, otherwise the main-span accelerometer
  const sensorId = pick ?? sensors.find((s) => s.incident_role === "primary")?.sensor_id ?? sensors.find((s) => s.sensor_id === "ACC-M1")?.sensor_id ?? sensors[0]?.sensor_id ?? null;
  const spark = sensors.find((s) => s.incident_role === "primary");

  if (!state) return <div className="space-y-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-28" /><Skeleton className="h-64" /></div>;

  const open = state.incidents.filter((i) => !i.closed);
  const investigating = open.filter((i) => PRE_APPROVAL.includes(i.state));
  const pending = (wos ?? []).filter((w) => ["proposed", "approved", "assigned", "in_progress"].includes(w.status));
  const awaiting = (wos ?? []).filter((w) => w.status === "proposed").length;
  const bridge = state.assets[0];

  return (
    <MotionConfig reducedMotion="user">
      <div className="space-y-5">
        {/* header region: twilight bridge illustration (public/overview-twilight.svg) under dark gradients for contrast */}
        <section className="relative isolate overflow-hidden rounded-2xl border border-line" aria-label="Overview summary">
          <div aria-hidden className="absolute inset-0 -z-10" style={{
            backgroundImage: "linear-gradient(90deg, var(--bg) 0%, color-mix(in srgb, var(--bg) 90%, transparent) 40%, color-mix(in srgb, var(--bg) 22%, transparent) 72%, transparent 100%), linear-gradient(180deg, transparent 60%, color-mix(in srgb, var(--bg) 70%, transparent) 100%), url(/overview-twilight.svg)",
            backgroundSize: "cover", backgroundPosition: "right bottom",
          }} />
          <div className="px-6 pb-6 pt-7 lg:pt-9">
            <Reveal>
              <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                <div className="min-w-0">
                  <h1 className="text-2xl font-semibold tracking-tight text-text">Overview</h1>
                  <p className="mt-1 max-w-3xl text-sm text-muted">Simulated monitoring of Bridge Alpha. Decision support only — not a safety certification.</p>
                </div>
                {open.length === 0 && <div className="flex flex-wrap items-center gap-2"><RunToEventButton /></div>}
              </div>
            </Reveal>
            <div className="grid gap-4 sm:grid-cols-3">
              <Reveal delay={0.05}>
                <Kpi accent={open.length > 0}>
                  <div className="flex items-start justify-between gap-3"><Stat label="Active alerts" value={<span className="text-3xl"><CountUp value={open.length} /></span>} tone={open.length ? "amber" : undefined} sub={open.length ? "Persistent deviation detected" : "No anomaly detected"} />
                  {spark && spark.trend.filter((v) => v !== null).length > 2 && (
                    <div className="pt-1 text-right">
                      <Sparkline width={130} height={34} median={spark.baseline_median} label={`${spark.sensor_id} ${spark.feature_label}, last ${spark.trend.length} windows`}
                        points={spark.trend.map((v, i) => ({ i, v, q: spark.trend_quality[i] ?? "ok", x: !!spark.finding && i >= spark.trend.length - spark.finding.persistence_count }))} />
                      <p className="mt-1 text-[10px] text-faint">{spark.sensor_id} · last {spark.trend.length} windows · dashed = baseline</p>
                    </div>
                  )}</div>
                </Kpi>
              </Reveal>
              <Reveal delay={0.1}>
                <Kpi accent={investigating.length > 0}><Stat label="Open investigations" value={<span className="text-3xl"><CountUp value={investigating.length} /></span>} tone={investigating.length ? "amber" : undefined} sub="Awaiting a human decision" /></Kpi>
              </Reveal>
              <Reveal delay={0.15}>
                <Kpi accent={awaiting > 0}><Stat label="Pending work orders" value={<span className="text-3xl"><CountUp value={pending.length} /></span>} tone={awaiting ? "amber" : undefined} sub={awaiting ? `${awaiting} awaiting approval` : "None awaiting approval"} /></Kpi>
              </Reveal>
            </div>
          </div>
        </section>

        <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
          <div className="min-w-0 space-y-5">
            <Reveal delay={0.1}>
              <OvCard data-coach="attention">
                <CardHeader title="Needs attention" subtitle="Each alert with its current step and next action" />
                {open.length === 0 ? (
                  <Empty title="No active alerts" body="Short spikes, such as a heavy vehicle, are logged as transients and do not alert. Press play in the top bar, or run to the next event."
                    action={<RunToEventButton size="sm" />} />
                ) : (
                  <ul className="divide-y divide-line-soft">
                    {open.map((i) => {
                      const next = nextAction(i);
                      return (
                        <li key={i.incident_id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 transition-colors duration-200 hover:bg-raised/50">
                          <div className="min-w-0 space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <Link href={`/incidents/${i.incident_id}`} className="num text-sm font-semibold text-text hover:underline">{i.incident_id}</Link>
                              <Badge tone={i.escalation ? "red" : "amber"}>{i.escalation ? "Escalation required" : "Investigate"}</Badge>
                              {i.priority && <Badge tone="neutral">{i.priority} · {i.timeframe}</Badge>}
                            </div>
                            <p className="text-sm text-muted">{i.primary_sensor_id} {FEATURE_LABEL[i.top_feature] ?? i.top_feature} z = {fmtZ(i.top_z)} since {fmtSim(i.onset_time)} · {STATE_LABEL[i.state] ?? i.state}</p>
                            <OverviewJourney state={i.state} />
                          </div>
                          {next.href && <Link href={next.href}><Button variant={next.tone === "amber" ? "primary" : "secondary"}>{next.label} <ArrowRight size={14} /></Button></Link>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </OvCard>
            </Reveal>
            <Reveal delay={0.15}>
              {sensors.length > 0 ? <TelemetryPanel sensors={sensors} sensorId={sensorId} onPick={setPick} /> : <Skeleton className="h-[330px]" />}
            </Reveal>
          </div>

          <div className="space-y-5">
            {bridge && (
              <Reveal delay={0.15}>
                <Link href="/assets/BRG-017" className="block">
                  <OvCard active={bridge.status !== "No anomaly detected"} className="p-5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-lg bg-raised text-muted"><Box size={18} /></span>
                        <div><p className="text-sm font-semibold">{bridge.name}</p><p className="num text-[11px] text-faint">{bridge.asset_id} · Bridge</p></div></div>
                      <StatusChip status={bridge.status} size="sm" />
                    </div>
                    <p className="mt-3 text-xs text-muted">{bridge.sensors.filter((s) => s.health === "ok").length}/{bridge.sensors.length} sensors reporting · updated {fmtSim(bridge.last_updated)} UTC</p>
                    <p className="mt-3 flex items-center justify-between text-xs font-medium text-blue">Open 3D workspace <ArrowRight size={13} /></p>
                  </OvCard>
                </Link>
              </Reveal>
            )}
            <Reveal delay={0.2}>
              <OvCard>
                <CardHeader title="Sensor health" subtitle="Current state of every Bridge Alpha sensor" />
                {sensors.length > 0 ? <SensorHealthRing sensors={sensors} /> : <Skeleton className="m-5 h-[132px]" />}
              </OvCard>
            </Reveal>
            <Reveal delay={0.25}>
              <OvCard>
                <CardHeader title="Recent activity" right={<Link href="/work-orders" className="text-xs font-medium text-blue hover:underline">Work orders</Link>} />
                <ActivityFeed rows={state.activity} limit={5} dense />
              </OvCard>
            </Reveal>
          </div>
        </div>
      </div>
    </MotionConfig>
  );
}
