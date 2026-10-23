"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Badge, Button, SimulatedTag } from "@/components/ui";
import { fmtSim } from "@/lib/format";
import type { IncidentDetail } from "@/lib/types";
import { nextAction, STATE_LABEL } from "@/lib/workflow";

/** Page header for one investigation: breadcrumb, status, journey and the single next action. */
export function IncidentHeader({ d, right, trail }: { d: IncidentDetail; right?: React.ReactNode; trail?: string }) {
  const id = d.incident.incident_id;
  const wo = d.work_orders.at(-1);
  const next = nextAction({ state: d.incident.state, incident_id: id, work_order_id: wo?.work_order_id ?? null, work_order_status: wo?.status ?? null });
  const here = `/incidents/${id}`;
  const status = d.incident.closed ? "Closed by human reviewer" : d.incident.escalation ? "Escalation required" : "Investigate";
  return (
    <div className="mb-5">
      <Breadcrumbs items={[{ label: "Investigations", href: "/incidents" }, trail ? { label: <span className="num">{id}</span>, href: here } : { label: <span className="num">{id}</span> }, ...(trail ? [{ label: trail }] : [])]} />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <h1 className="flex flex-wrap items-center gap-3 text-xl font-semibold tracking-tight">
            <span className="num">{id}</span>
            <Badge tone={d.incident.closed ? "slate" : d.incident.escalation ? "red" : "amber"} className="text-xs">{status}</Badge>
            <SimulatedTag />
            {!d.is_current_run && <Badge tone="slate">Earlier run {d.incident.run_id}</Badge>}
          </h1>
          <p className="text-sm text-muted">{d.asset.name} · {d.event.primary_sensor_id} · detected <span className="num">{fmtSim(d.event.detected_time)}</span> UTC · {STATE_LABEL[d.incident.state]}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {right}
          {next.href && next.href !== here && <Link href={next.href}><Button variant="primary">{next.label} <ArrowRight size={15} /></Button></Link>}
        </div>
      </div>
    </div>
  );
}
