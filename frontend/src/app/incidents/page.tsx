"use client";

import { ScanSearch } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge, Button, Card, Empty, PageHeader, Segmented } from "@/components/ui";
import { useApi } from "@/lib/api";
import { FEATURE_LABEL, fmtSim, fmtZ, humanState } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { IncidentBrief } from "@/lib/types";

export default function IncidentsPage() {
  const { version, sim } = useApp();
  const [scope, setScope] = useState<"run" | "all">("run");
  const { data } = useApi<IncidentBrief[]>(`/api/incidents${scope === "all" ? "?all_runs=true" : ""}`, version);
  return (
    <div>
      <PageHeader eyebrow={<><ScanSearch size={13} /> Investigation Centre</>} title="Incidents"
        right={<Segmented label="Scope" value={scope} onChange={setScope} options={[{ value: "run", label: "Current run" }, { value: "all", label: "All runs" }]} />} />
      <Card>
        {!data?.length ? (
          <Empty icon={<ScanSearch size={22} />} title="No incidents yet" body="Incidents open only when the Sentinel finds a persistent, quality-checked deviation from an asset's own baseline."
            action={<Button size="sm" onClick={sim.toEvent}>Run to next event</Button>} />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-faint"><tr className="border-b border-line">{["Incident", "Asset", "Signal", "Since", "Priority", "State", "Work order"].map((h) => <th key={h} className="px-5 py-2 text-left font-medium">{h}</th>)}</tr></thead>
            <tbody>{data.map((i) => (
              <tr key={i.incident_id} className="border-b border-line-soft hover:bg-raised/60">
                <td className="px-5 py-3"><Link href={`/incidents/${i.incident_id}`} className="num font-semibold text-blue hover:underline">{i.incident_id}</Link></td>
                <td className="num px-5 text-muted">{i.asset_id}</td>
                <td className="px-5 text-xs text-text">{i.primary_sensor_id} · {FEATURE_LABEL[i.top_feature]} <span className="num text-amber">z {fmtZ(i.top_z)}</span></td>
                <td className="num px-5 text-xs text-muted">{fmtSim(i.onset_time)}</td>
                <td className="px-5">{i.priority && <Badge tone={i.escalation ? "red" : "amber"}>{i.priority}</Badge>}</td>
                <td className="px-5 text-xs text-muted">{humanState(i.state)}</td>
                <td className="num px-5 text-xs text-muted">{i.work_order_id} · {i.work_order_status}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
