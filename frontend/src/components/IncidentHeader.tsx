"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Badge, SimulatedTag } from "@/components/ui";
import { cx, fmtSim } from "@/lib/format";
import type { IncidentDetail } from "@/lib/types";

const TABS = [
  { key: "", label: "Investigation" },
  { key: "/plan", label: "Inspection Planner" },
  { key: "/verify", label: "Verification & Audit" },
  { key: "/replay", label: "Decision Replay" },
];

export function IncidentHeader({ d, right }: { d: IncidentDetail; right?: React.ReactNode }) {
  const path = usePathname();
  const base = `/incidents/${d.incident.incident_id}`;
  const status = d.incident.closed ? "Closed by human reviewer" : d.incident.escalation ? "Escalation required" : "Investigate";
  return (
    <div className="mb-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted">
            <Link href={`/assets/${d.asset.asset_id}`} className="hover:text-text">{d.asset.name}</Link>
            <span className="text-faint">/</span>
            <span className="num">{d.event.primary_sensor_id}</span>
            <SimulatedTag />
            {!d.is_current_run && <Badge tone="slate">Earlier run {d.incident.run_id}</Badge>}
          </div>
          <h1 className="flex flex-wrap items-center gap-3 text-xl font-semibold tracking-tight">
            <span className="num">{d.incident.incident_id}</span>
            <Badge tone={d.incident.closed ? "slate" : d.incident.escalation ? "red" : "amber"} className="text-xs">{status}</Badge>
          </h1>
          <p className="mt-1 text-sm text-muted">{d.state_text} · detected <span className="num">{fmtSim(d.event.detected_time)}</span> UTC</p>
        </div>
        {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
      </div>
      <nav className="mt-4 flex gap-1 border-b border-line" aria-label="Incident sections">
        {TABS.map((t) => {
          const href = base + t.key;
          const active = path === href;
          return (
            <Link key={t.key} href={href} aria-current={active ? "page" : undefined}
              className={cx("-mb-px border-b-2 px-3 py-2 text-sm transition-colors", active ? "border-blue font-medium text-text" : "border-transparent text-muted hover:text-text")}>
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
