"use client";

import { ArrowRight, Box } from "lucide-react";
import Link from "next/link";
import { Badge, Card, DataQualityChip, PageHeader, Skeleton, StatusChip } from "@/components/ui";
import { ASSET_TYPE_LABEL, cx, fmtSim } from "@/lib/format";
import { useApp } from "@/lib/store";

/** Monitored assets, driven by the backend's active-asset list (currently one bridge). */
export default function InfrastructurePage() {
  const { state } = useApp();
  if (!state) return <Skeleton className="h-48" />;
  return (
    <div>
      <PageHeader title="Infrastructure" subtitle="Monitored assets. Open an asset for its interactive 3D workspace." />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {state.assets.map((a) => (
          <Link key={a.asset_id} href={`/assets/${a.asset_id}`} className="block">
            <Card active={a.status !== "No anomaly detected"} className="p-5 transition-colors hover:border-faint">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-lg bg-raised text-muted"><Box size={19} /></span>
                  <div><p className="text-base font-semibold">{a.name}</p><p className="num text-[11px] text-faint">{a.asset_id} · {ASSET_TYPE_LABEL[a.type]}</p></div>
                </div>
                <StatusChip status={a.status} size="sm" />
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-3 text-xs">
                <div><dt className="text-faint">Sensors reporting</dt><dd className="num mt-1 text-sm font-semibold">{a.sensors.filter((s) => s.health === "ok").length}/{a.sensors.length}</dd></div>
                <div><dt className="text-faint">Open alerts</dt><dd className={cx("num mt-1 text-sm font-semibold", a.open_incidents ? "text-amber" : "")}>{a.open_incidents}</dd></div>
                <div><dt className="text-faint">Baseline</dt><dd className="mt-1 text-sm font-semibold capitalize">{a.baseline.status.replace("_", " ")}</dd></div>
              </dl>
              {a.data_quality_issues.length > 0 && <div className="mt-3"><DataQualityChip size="sm" label={`${a.data_quality_issues.length} sensor issue(s)`} /></div>}
              <div className="mt-4 flex items-center justify-between border-t border-line-soft pt-3 text-xs">
                <span className="text-faint">Updated {fmtSim(a.last_updated)} UTC <Badge tone="violet" className="ml-1">Simulated</Badge></span>
                <span className="flex items-center gap-1 font-medium text-blue">Open workspace <ArrowRight size={13} /></span>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
