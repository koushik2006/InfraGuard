"use client";

import { Box, CircleHelp, FileQuestion } from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { IncidentHeader } from "@/components/IncidentHeader";
import { InvestigationStages } from "@/components/InvestigationStages";
import { Button, Empty, Skeleton } from "@/components/ui";
import { WhyFlaggedDrawer } from "@/components/WhyFlagged";
import { useApi } from "@/lib/api";
import { useApp } from "@/lib/store";
import type { IncidentDetail } from "@/lib/types";

function Page() {
  const { id } = useParams<{ id: string }>();
  const finding = useSearchParams().get("finding");
  const { version, refresh } = useApp();
  const { data: d, error, reload } = useApi<IncidentDetail>(`/api/incidents/${id}`, version);
  const [why, setWhy] = useState(false);

  if (error) return <Empty icon={<FileQuestion size={22} />} title="Investigation not found" body={error} />;
  if (!d) return <div className="space-y-4"><Skeleton className="h-16 w-96" /><Skeleton className="h-40" /><Skeleton className="h-80" /></div>;
  return (
    <div>
      <IncidentHeader d={d} right={<>
        <Button onClick={() => setWhy(true)}><CircleHelp size={15} /> Why was this flagged?</Button>
        <Link href={`/assets/${d.asset.asset_id}?sensor=${finding ?? d.event.primary_sensor_id}`}><Button><Box size={15} /> 3D view</Button></Link>
      </>} />
      <InvestigationStages key={d.incident.incident_id} d={d} selectedFinding={finding} onChange={async () => { await reload(); await refresh(); }} />
      <WhyFlaggedDrawer open={why} onClose={() => setWhy(false)} d={d} />
    </div>
  );
}

export default function InvestigationPage() {
  return <Suspense fallback={<Skeleton className="h-80" />}><Page /></Suspense>;
}
