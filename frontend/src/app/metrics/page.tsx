"use client";

import { Gauge, TriangleAlert } from "lucide-react";
import { Card, CardHeader, PageHeader, SimulatedTag, Skeleton } from "@/components/ui";
import { useApi } from "@/lib/api";
import { cx } from "@/lib/format";

interface Summary { cases: number; labelled_anomalies: number; detected: number; missed: number; false_alerts: number; benign_transient_alerts: number; delay_windows_median: number | null; delay_windows_max: number | null; delay_minutes_median: number | null; within_3_windows: number; window_minutes: number }
interface Metrics { summary: Record<string, Summary>; cases: { seed: number; asset_id: string; variant: string; environment: string; detected: number; missed: number; false_alerts: number; delays_windows: number[]; benign_transient_alerted: boolean }[]; seeds: number[]; caveat: string; targets: Record<string, unknown> }

export default function MetricsPage() {
  const { data } = useApi<Metrics>("/api/metrics");
  return (
    <div>
      <PageHeader eyebrow={<><Gauge size={13} /> Detection metrics <SimulatedTag /></>} title="False alerts, missed events and detection delay"
        subtitle="Computed live by running the detector over every labelled simulated scenario variant for several seeds (plus a heatwave preset)." />
      <div className="mb-5 flex gap-2 rounded-lg border border-amber/40 bg-amber-soft p-4 text-sm text-amber"><TriangleAlert size={18} className="shrink-0" />{data?.caveat ?? "Measured on labelled SIMULATED scenarios only."}</div>
      {!data ? <Skeleton className="h-80" /> : (
        <>
          <div className="mb-5 grid gap-4 md:grid-cols-3">
            {Object.entries(data.summary).map(([a, s]) => (
              <Card key={a} className="p-5">
                <p className="num text-sm font-semibold">{a}</p>
                <p className="text-xs text-muted">{s.cases} runs · {s.window_minutes}-min windows</p>
                <dl className="num mt-4 grid grid-cols-2 gap-3 text-xs">
                  <div><dt className="text-faint">False alerts</dt><dd className={cx("text-lg font-semibold", s.false_alerts ? "text-red" : "text-blue")}>{s.false_alerts}</dd></div>
                  <div><dt className="text-faint">Benign-spike alerts</dt><dd className={cx("text-lg font-semibold", s.benign_transient_alerts ? "text-red" : "text-blue")}>{s.benign_transient_alerts}</dd></div>
                  <div><dt className="text-faint">Detected / labelled</dt><dd className="text-lg font-semibold">{s.detected} / {s.labelled_anomalies}</dd></div>
                  <div><dt className="text-faint">Missed</dt><dd className={cx("text-lg font-semibold", s.missed ? "text-red" : "")}>{s.missed}</dd></div>
                  <div><dt className="text-faint">Median delay</dt><dd className="text-lg font-semibold">{s.delay_windows_median ?? "—"}{s.delay_windows_median !== null && <span className="text-xs text-muted"> win ({s.delay_minutes_median} min)</span>}</dd></div>
                  <div><dt className="text-faint">Within 3 windows</dt><dd className={cx("text-lg font-semibold", s.labelled_anomalies && s.within_3_windows < s.detected ? "text-amber" : "")}>{s.labelled_anomalies ? `${s.within_3_windows} / ${s.detected}` : "n/a"}</dd></div>
                </dl>
              </Card>
            ))}
          </div>
          <Card className="mb-5 p-5 text-sm text-muted">
            <p className="font-semibold text-text">Targets (not results)</p>
            <p className="mt-1">0 false alerts on the normal replay · 100% of work orders with evidence and approval (enforced by the workflow) · detection within 3 windows. The building&apos;s gradual drift is detected later than 3 windows because the drift must first accumulate above noise and then persist for 4 windows — reported as measured, not tuned away.</p>
          </Card>
          <Card>
            <CardHeader title="All evaluated cases" subtitle={`Seeds ${data.seeds.join(", ")}`} />
            <div className="max-h-[480px] overflow-y-auto">
              <table className="num w-full text-xs">
                <thead className="sticky top-0 bg-surface text-[10px] uppercase tracking-wider text-faint"><tr className="border-b border-line">{["Seed", "Asset", "Variant", "Env", "Detected", "Missed", "False alerts", "Delay (win)", "Benign spike alerted"].map((h) => <th key={h} className="px-4 py-2 text-left font-medium">{h}</th>)}</tr></thead>
                <tbody>{data.cases.map((c, i) => (
                  <tr key={i} className="border-b border-line-soft"><td className="px-4 py-1.5">{c.seed}</td><td className="px-4">{c.asset_id}</td><td className="px-4">{c.variant}</td><td className="px-4">{c.environment}</td>
                    <td className="px-4">{c.detected}</td><td className="px-4">{c.missed}</td><td className={cx("px-4", c.false_alerts > 0 && "text-red")}>{c.false_alerts}</td><td className="px-4">{c.delays_windows.join(", ") || "—"}</td><td className="px-4">{c.benign_transient_alerted ? "yes" : "no"}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
