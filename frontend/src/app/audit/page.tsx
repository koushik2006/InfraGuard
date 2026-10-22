"use client";

import { ScrollText } from "lucide-react";
import { useState } from "react";
import { AuditTable } from "@/components/Activity";
import { Card, PageHeader, Segmented, Skeleton } from "@/components/ui";
import { useApi } from "@/lib/api";
import { useApp } from "@/lib/store";
import type { AuditRow } from "@/lib/types";

export default function AuditPage() {
  const { version } = useApp();
  const [scope, setScope] = useState<"run" | "all">("run");
  const [actor, setActor] = useState<"all" | "agent" | "human" | "system">("all");
  const { data } = useApi<AuditRow[]>(`/api/audit?limit=500${scope === "all" ? "&all_runs=true" : ""}`, version);
  const rows = (data ?? []).filter((r) => actor === "all" || r.actor_type === actor);
  return (
    <div>
      <PageHeader eyebrow={<><ScrollText size={13} /> Audit log</>} title="Every transition, timestamped"
        subtitle="Append-only (SQLite triggers reject updates and deletes). Wall-clock time records when it happened; sim time places it in the simulated scenario."
        right={<>
          <Segmented label="Scope" value={scope} onChange={setScope} options={[{ value: "run", label: "Current run" }, { value: "all", label: "All runs" }]} />
          <Segmented label="Actor" value={actor} onChange={setActor} options={[{ value: "all", label: "All" }, { value: "agent", label: "Agents" }, { value: "human", label: "Humans" }, { value: "system", label: "System" }]} />
        </>} />
      <Card>{data ? <AuditTable rows={rows} /> : <Skeleton className="h-96" />}</Card>
    </div>
  );
}
