"use client";

import { useMemo } from "react";
import {
  CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis,
} from "recharts";
import { fmtNum, fmtSim, fmtZ } from "@/lib/format";
import type { Series } from "@/lib/types";

interface Row { ts: number; v: number | null; z: number | null; q: string; qd?: string; i: number; x?: boolean; fu?: number | null; kind: "main" | "follow" }

const AXIS = { stroke: "var(--faint)", fontSize: 11, fontFamily: "var(--font-mono)" };

function TooltipBox({ active, payload, unit, label: featureLabel, zThr }: { active?: boolean; payload?: { payload: Row }[]; unit: string; label: string; zThr: number }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  const v = r.kind === "follow" ? r.fu : r.v;
  return (
    <div className="rounded-md border border-line bg-raised px-3 py-2 text-xs shadow-xl">
      <div className="num mb-1 text-faint">{fmtSim(new Date(r.ts).toISOString())} UTC · {r.kind === "follow" ? "follow-up" : `window ${r.i}`}</div>
      <div className="flex justify-between gap-4"><span className="text-muted">{featureLabel}</span><span className="num text-text">{fmtNum(v, 4)} {unit}</span></div>
      <div className="flex justify-between gap-4"><span className="text-muted">robust z</span><span className={"num " + (r.z !== null && Math.abs(r.z) >= zThr ? "text-amber" : "text-text")}>{fmtZ(r.z)}</span></div>
      <div className="flex justify-between gap-4"><span className="text-muted">data quality</span><span className={r.q === "ok" ? "text-text" : "text-violet"}>{r.q}</span></div>
      {r.qd && r.q !== "ok" && <div className="mt-1 max-w-56 text-[11px] text-violet">{r.qd}</div>}
    </div>
  );
}

export function TimeSeriesChart({ series, height = 300, compact = false }: { series: Series; height?: number; compact?: boolean }) {
  const wm = series.detection.window_minutes * 60000;
  const data = useMemo<Row[]>(() => {
    const main: Row[] = series.points.map((p) => ({ ts: Date.parse(p.t) + wm / 2, v: p.v, z: p.z, q: p.q, qd: p.qd, i: p.i, x: p.x, kind: "main" }));
    const fu: Row[] = series.follow_up.map((p) => ({ ts: Date.parse(p.t) + wm / 2, v: null, fu: p.v, z: p.z, q: p.q, i: p.i, kind: "follow" }));
    return [...main, ...fu];
  }, [series, wm]);

  const b = series.baseline;
  const vals = data.flatMap((r) => [r.v, r.fu]).filter((v): v is number => v !== null && v !== undefined && Math.abs(v) < 900);
  let lo = Math.min(...vals), hi = Math.max(...vals); // band is clipped to the data range
  for (const t of series.thresholds) { lo = Math.min(lo, t.direction === "abs_above" ? -Infinity : t.limit); hi = Math.max(hi, t.limit); }
  if (!Number.isFinite(lo)) lo = Math.min(...vals);
  const pad = (hi - lo) * 0.08 || 1;
  const domain: [number, number] = [lo - pad, hi + pad];
  const t0 = data[0]?.ts, t1 = data.at(-1)?.ts;
  const refEnd = series.points.find((p) => p.i === series.reference_end_index);
  const exceed = data.filter((r) => r.x).map((r) => ({ ts: r.ts, y: domain[0] + pad * 0.35 }));
  const quality = data.filter((r) => r.kind === "main" && r.q !== "ok").map((r) => ({ ts: r.ts, y: domain[0] + pad * 0.35, q: r.q }));
  const idxToTs = (i: number) => {
    const p = series.points.find((x) => x.i === i);
    return p ? Date.parse(p.t) : undefined;
  };
  const summary = `${series.label} for ${series.sensor_id}: ${series.points.length} windows shown` +
    (b ? `, baseline median ${fmtNum(b.median, 4)} ${series.unit}, detection band ${fmtNum(b.band_lo, 4)} to ${fmtNum(b.band_hi, 4)}` : "") +
    `. ${data.filter((r) => r.x).length} windows exceed |z| ≥ ${series.detection.z_threshold}; ${quality.length} windows with data-quality issues; ` +
    `${series.incidents.length} anomaly interval(s); ${series.transients.length} transient exceedance(s) not alerted.`;

  if (!data.length) return <div className="skeleton" style={{ height }} />;
  return (
    <figure className="m-0" aria-label={summary}>
      <figcaption className="sr-only">{summary}</figcaption>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 14, right: 16, bottom: 4, left: 4 }}>
            <CartesianGrid stroke="var(--line-soft)" vertical={false} />
            <XAxis dataKey="ts" type="number" domain={[t0 ?? 0, t1 ?? 1]} scale="time" tick={AXIS} stroke="var(--line)" tickLine={false}
              tickFormatter={(v) => fmtSim(new Date(v).toISOString(), !compact)} minTickGap={48} />
            <YAxis domain={domain} tick={AXIS} stroke="var(--line)" tickLine={false} width={56}
              tickFormatter={(v) => fmtNum(v, Math.abs(v) < 1 ? 3 : 2)} />
            {refEnd && t0 !== undefined && (
              <ReferenceArea x1={t0} x2={Date.parse(refEnd.t) + wm} fill="var(--slate-soft)" fillOpacity={0.5} ifOverflow="hidden"
                label={compact ? undefined : { value: "Reference period", position: "insideTopLeft", fill: "var(--faint)", fontSize: 10 }} />
            )}
            {b && <ReferenceArea y1={b.band_lo} y2={b.band_hi} fill="var(--blue)" fillOpacity={0.08} ifOverflow="hidden" />}
            {b && <ReferenceLine y={b.median} stroke="var(--blue)" strokeOpacity={0.6} strokeDasharray="4 4"
              label={compact ? undefined : { value: "baseline median", position: "insideBottomRight", fill: "var(--faint)", fontSize: 10 }} />}
            {series.incidents.map((inc) => {
              const x1 = idxToTs(inc.onset_window), x2 = idxToTs(inc.last_window);
              return x1 !== undefined && x2 !== undefined ? (
                <ReferenceArea key={inc.incident_id} x1={x1} x2={x2 + wm} fill="var(--amber)" fillOpacity={0.16} stroke="var(--amber)" strokeOpacity={0.5}
                  label={{ value: `Anomaly interval · ${inc.incident_id}`, position: "insideTopRight", fill: "var(--amber)", fontSize: 10 }} />
              ) : null;
            })}
            {series.transients.map((t) => (
              <ReferenceLine key={`${t.window_index}`} x={Date.parse(t.t_start) + wm / 2} stroke="var(--blue)" strokeDasharray="2 3"
                label={compact ? undefined : { value: "transient · not alerted", position: "insideTop", fill: "var(--blue)", fontSize: 10 }} />
            ))}
            {series.thresholds.map((t) => (
              <ReferenceLine key={t.label + t.limit} y={t.limit} stroke="var(--red)" strokeDasharray="6 4"
                label={{ value: t.label, position: "insideTopLeft", fill: "var(--red)", fontSize: 10 }} />
            ))}
            {series.follow_up.length > 0 && (
              <ReferenceArea x1={Date.parse(series.follow_up[0].t)} x2={Date.parse(series.follow_up.at(-1)!.t) + wm} fill="var(--violet)" fillOpacity={0.06}
                label={{ value: "Follow-up readings (simulated)", position: "insideTopLeft", fill: "var(--violet)", fontSize: 10 }} />
            )}
            <Line type="linear" dataKey="v" stroke="var(--blue)" strokeWidth={1.6} dot={false} isAnimationActive={false} connectNulls={false} name="value" />
            <Line type="linear" dataKey="fu" stroke="var(--violet)" strokeWidth={1.6} dot={{ r: 1.5, fill: "var(--violet)" }} isAnimationActive={false} connectNulls={false} name="follow-up" />
            {exceed.length > 0 && <Scatter data={exceed} dataKey="y" fill="var(--amber)" isAnimationActive={false} shape={(p: { cx?: number; cy?: number }) => <rect x={(p.cx ?? 0) - 1.5} y={(p.cy ?? 0) - 6} width={3} height={8} fill="var(--amber)" rx={1} />} />}
            {quality.length > 0 && <Scatter data={quality} dataKey="y" isAnimationActive={false} shape={(p: { cx?: number; cy?: number }) => <path d={`M${p.cx} ${(p.cy ?? 0) - 6} l4 5 l-4 5 l-4 -5z`} fill="var(--violet)" />} />}
            <Tooltip content={<TooltipBox unit={series.unit} label={series.label} zThr={series.detection.z_threshold} />} cursor={{ stroke: "var(--faint)", strokeDasharray: "3 3" }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {!compact && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
          <Legend swatch={<span className="h-0.5 w-4 bg-blue" />} label="Observed (simulated) readings" />
          <Legend swatch={<span className="h-3 w-4 rounded-sm bg-blue/10 ring-1 ring-blue/20" />} label={`Detection band: median ± ${series.detection.z_threshold} × 1.4826·MAD`} />
          <Legend swatch={<span className="h-3 w-1 rounded-sm bg-amber" />} label={`Window exceeding |z| ≥ ${series.detection.z_threshold} (persistence tick)`} />
          <Legend swatch={<span className="h-3 w-4 rounded-sm bg-amber/20 ring-1 ring-amber/50" />} label="Anomaly interval" />
          <Legend swatch={<span className="h-2.5 w-2.5 rotate-45 bg-violet" />} label="Data-quality issue (excluded)" />
          {series.transients.length > 0 && <Legend swatch={<span className="h-3 w-px border-l border-dashed border-blue" />} label="Transient, not alerted" />}
        </div>
      )}
    </figure>
  );
}

function Legend({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  return <span className="inline-flex items-center gap-1.5">{swatch}{label}</span>;
}
