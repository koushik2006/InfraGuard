"use client";

import type { SparkPoint } from "@/lib/types";

/** Tiny SVG sparkline: blue line, amber dots for exceeding windows, violet ticks for quality issues. */
export function Sparkline({ points, median, width = 220, height = 44, label }: { points: SparkPoint[]; median?: number | null; width?: number; height?: number; label: string }) {
  const vals = points.map((p) => p.v).filter((v): v is number => v !== null);
  if (vals.length < 2) return <div style={{ width, height }} className="skeleton" aria-label="No data yet" />;
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (median !== null && median !== undefined) { lo = Math.min(lo, median); hi = Math.max(hi, median); }
  const pad = (hi - lo) * 0.12 || 1e-6;
  lo -= pad; hi += pad;
  const x = (i: number) => (i / (points.length - 1)) * width;
  const y = (v: number) => height - ((v - lo) / (hi - lo)) * height;
  let d = "";
  points.forEach((p, i) => {
    if (p.v === null) return;
    const prev = points[i - 1];
    d += `${!prev || prev.v === null ? "M" : "L"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`;
  });
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="overflow-visible">
      {median !== null && median !== undefined && <line x1={0} x2={width} y1={y(median)} y2={y(median)} stroke="var(--faint)" strokeDasharray="3 3" strokeWidth={1} />}
      <path d={d} fill="none" stroke="var(--blue)" strokeWidth={1.5} strokeLinejoin="round" />
      {points.map((p, i) => p.x && p.v !== null ? <circle key={i} cx={x(i)} cy={y(p.v)} r={2} fill="var(--amber)" /> : null)}
      {points.map((p, i) => p.q !== "ok" ? <rect key={"q" + i} x={x(i) - 1} y={height - 4} width={2} height={4} fill="var(--violet)" /> : null)}
    </svg>
  );
}
