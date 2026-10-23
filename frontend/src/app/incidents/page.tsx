"use client";

import { ArrowRight, ScanSearch } from "lucide-react";
import Link from "next/link";
import { Journey } from "@/components/Journey";
import { RunToEventButton } from "@/components/RunToEvent";
import { Badge, Button, Card, Empty, PageHeader } from "@/components/ui";
import { useApi } from "@/lib/api";
import { FEATURE_LABEL, fmtSim, fmtZ } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { IncidentBrief } from "@/lib/types";
import { nextAction, STATE_LABEL } from "@/lib/workflow";

export default function InvestigationsPage() {
  const { version } = useApp();
  const { data } = useApi<IncidentBrief[]>("/api/incidents", version);
  return (
    <div>
      <PageHeader title="Investigations" subtitle="Detected anomalies with evidence, agent findings and inspection priority." />
      <Card>
        {!data?.length ? (
          <Empty icon={<ScanSearch size={22} />} title="No investigations yet" body="An investigation opens when the Sentinel finds a persistent, quality-checked deviation from the bridge's own baseline."
            action={<RunToEventButton size="sm" />} />
        ) : (
          <ul className="divide-y divide-line-soft">
            {data.map((i) => {
              const next = nextAction(i);
              return (
                <li key={i.incident_id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/incidents/${i.incident_id}`} className="num text-sm font-semibold text-blue hover:underline">{i.incident_id}</Link>
                      <Badge tone={i.closed ? "slate" : i.escalation ? "red" : "amber"}>{i.closed ? "Closed" : i.escalation ? "Escalation required" : "Investigate"}</Badge>
                      {i.priority && <Badge tone="neutral">{i.priority} · {i.timeframe}</Badge>}
                    </div>
                    <p className="text-sm text-muted">{i.primary_sensor_id} {FEATURE_LABEL[i.top_feature] ?? i.top_feature} z = {fmtZ(i.top_z)} since {fmtSim(i.onset_time)} · {STATE_LABEL[i.state] ?? i.state}</p>
                    <Journey state={i.state} />
                  </div>
                  <div className="flex gap-2">
                    {next.href === `/incidents/${i.incident_id}`
                      ? <Link href={next.href}><Button size="sm" variant="primary">{next.label} <ArrowRight size={13} /></Button></Link>
                      : <>
                          <Link href={`/incidents/${i.incident_id}`}><Button size="sm">Investigation</Button></Link>
                          {next.href && <Link href={next.href}><Button size="sm" variant="primary">{next.label}</Button></Link>}
                        </>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
