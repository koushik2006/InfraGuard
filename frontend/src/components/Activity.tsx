"use client";

import { Bot, Cog, User } from "lucide-react";
import Link from "next/link";
import { cx, fmtSim, fmtWall } from "@/lib/format";
import type { AuditRow } from "@/lib/types";

const ACTION_TONE: Record<string, string> = {
  anomaly_event_created: "text-amber",
  escalation_required: "text-red",
  data_quality_issue: "text-violet",
  fault_injected: "text-violet",
  transient_exceedance_not_alerted: "text-blue",
};

export function ActorIcon({ type }: { type: string }) {
  const I = type === "agent" ? Bot : type === "human" ? User : Cog;
  return <I size={13} aria-label={type} className={type === "human" ? "text-amber" : type === "agent" ? "text-blue" : "text-faint"} />;
}

export function ActivityFeed({ rows, limit = 12, dense = false }: { rows: AuditRow[]; limit?: number; dense?: boolean }) {
  if (!rows.length) return <p className="px-5 py-6 text-xs text-muted">No activity yet. Press play to start the replay.</p>;
  return (
    <ol className="divide-y divide-line-soft">
      {rows.slice(0, limit).map((r) => (
        <li key={r.id} className={cx("flex gap-3 px-5", dense ? "py-2" : "py-2.5")}>
          <span className="mt-0.5"><ActorIcon type={r.actor_type} /></span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-xs font-medium text-text">{r.actor}</span>
              <span className="num shrink-0 text-[10px] text-faint">{fmtSim(r.sim_time, false)}</span>
            </div>
            <p className={cx("line-clamp-2 text-xs", ACTION_TONE[r.action] ?? "text-muted")}>
              {r.incident_id ? <Link href={`/incidents/${r.incident_id}`} className="hover:underline">{r.summary}</Link> : r.summary}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function AuditTable({ rows }: { rows: AuditRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-xs">
        <thead className="sticky top-0 bg-surface text-[10px] uppercase tracking-wider text-faint">
          <tr className="border-b border-line">
            <th className="px-4 py-2 font-medium">#</th><th className="px-2 py-2 font-medium">Recorded (wall clock)</th><th className="px-2 py-2 font-medium">Sim time (UTC)</th>
            <th className="px-2 py-2 font-medium">Actor</th><th className="px-2 py-2 font-medium">Action</th><th className="px-2 py-2 font-medium">Transition</th><th className="px-2 py-2 font-medium">Summary</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-line-soft align-top hover:bg-raised/60">
              <td className="num px-4 py-2 text-faint">{r.id}</td>
              <td className="num px-2 py-2 text-muted">{fmtWall(r.ts)}</td>
              <td className="num px-2 py-2 text-muted">{fmtSim(r.sim_time)}</td>
              <td className="px-2 py-2"><span className="inline-flex items-center gap-1.5 whitespace-nowrap text-text"><ActorIcon type={r.actor_type} />{r.actor}</span></td>
              <td className={cx("px-2 py-2 font-mono text-[11px]", ACTION_TONE[r.action] ?? "text-muted")}>{r.action}</td>
              <td className="num px-2 py-2 text-[11px] text-muted">{r.from_state ? `${r.from_state} → ${r.to_state}` : ""}</td>
              <td className="px-2 py-2 text-muted">{r.summary}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
