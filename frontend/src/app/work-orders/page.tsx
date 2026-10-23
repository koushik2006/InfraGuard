"use client";

import { ArrowRight, ClipboardCheck } from "lucide-react";
import Link from "next/link";
import { attention, WorkOrderCard } from "@/components/WorkOrderCard";
import { Button, Card, Empty, PageHeader } from "@/components/ui";
import { useApi } from "@/lib/api";
import { useApp } from "@/lib/store";
import type { WorkOrderRow } from "@/lib/types";

export default function WorkOrdersPage() {
  const { version } = useApp();
  const { data } = useApi<WorkOrderRow[]>("/api/work-orders", version);
  const need = (data ?? []).filter(attention);
  const rest = (data ?? []).filter((w) => !attention(w));
  return (
    <div>
      <PageHeader title="Work Orders" subtitle="Proposed preventive actions and who is accountable for them. Nothing is live until a qualified human approves it, and nothing is verified until a reviewer says so." />
      {!data?.length ? (
        <Card><Empty icon={<ClipboardCheck size={22} />} title="No work orders yet" body="The Response Planner drafts a proposal at the end of each investigation. It appears here for human review."
          action={<Link href="/incidents"><Button size="sm">Go to investigations <ArrowRight size={13} /></Button></Link>} /></Card>
      ) : (
        <div className="space-y-5">
          {need.length > 0 && (
            <Card className="border-amber/40">
              <div className="border-b border-line-soft px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-amber">Needs attention · {need.length}</div>
              <ul className="divide-y divide-line-soft">{need.map((w) => <WorkOrderCard key={w.work_order_id} w={w} />)}</ul>
            </Card>
          )}
          {rest.length > 0 && (
            <Card>
              {need.length > 0 && <div className="border-b border-line-soft px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-faint">Other work orders · {rest.length}</div>}
              <ul className="divide-y divide-line-soft">{rest.map((w) => <WorkOrderCard key={w.work_order_id} w={w} />)}</ul>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
