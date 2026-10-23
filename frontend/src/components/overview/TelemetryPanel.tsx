"use client";

import { TimeSeriesChart } from "@/components/charts/TimeSeriesChart";
import { Skeleton, SimulatedTag } from "@/components/ui";
import type { SensorState } from "@/components/twin/sensors";
import { OvCard } from "@/components/overview/motion";
import { useApi } from "@/lib/api";
import { useApp } from "@/lib/store";
import type { Series } from "@/lib/types";

/** Real historical readings of one sensor from /api/assets/BRG-017/series: baseline band, thresholds and the anomalous interval. */
export function TelemetryPanel({ sensors, sensorId, onPick }: { sensors: SensorState[]; sensorId: string | null; onPick: (id: string) => void }) {
  const { version } = useApp();
  const s = sensors.find((x) => x.sensor_id === sensorId);
  const { data: series, error } = useApi<Series>(s ? `/api/assets/BRG-017/series?sensor_id=${s.sensor_id}&feature=${s.feature}&window=200` : null, version);
  return (
    <OvCard>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line-soft px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight text-text">Sensor telemetry</h2>
          <p className="mt-0.5 text-xs text-muted">{s ? <>{s.feature_label} ({s.unit}) · {s.location}</> : "Select a sensor"} — observed readings against the sensor&apos;s own baseline band</p>
        </div>
        <div className="flex items-center gap-2">
          <SimulatedTag />
          <select aria-label="Sensor shown in the telemetry chart" value={sensorId ?? ""} onChange={(e) => onPick(e.target.value)}
            className="h-8 rounded-md border border-line bg-raised px-2 font-mono text-xs text-text">
            {sensors.map((x) => <option key={x.sensor_id} value={x.sensor_id}>{x.sensor_id}{x.finding ? " · finding" : ""}</option>)}
          </select>
        </div>
      </div>
      <div className="px-3 py-3">
        {error ? <p className="px-2 py-8 text-center text-sm text-muted">Readings could not be loaded: {error}</p>
          : !series ? <Skeleton className="h-[240px]" />
          : series.points.length < 2 ? <p className="px-2 py-8 text-center text-sm text-muted">Not enough readings yet — press play in the top bar to replay the scenario.</p>
          : <TimeSeriesChart series={series} height={240} compact />}
      </div>
    </OvCard>
  );
}
