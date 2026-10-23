"use client";

import { useReducedMotion } from "framer-motion";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { SensorState } from "@/components/twin/sensors";

interface Seg { key: string; label: string; color: string; ids: string[] }

/** Segments are the backend-computed sensor states, counted from /api/assets/BRG-017/sensors. */
function segments(sensors: SensorState[]): Seg[] {
  const by = (f: (s: SensorState) => boolean) => sensors.filter(f).map((s) => s.sensor_id);
  return [
    { key: "normal", label: "Normal", color: "var(--blue)", ids: by((s) => s.state === "normal") },
    { key: "observation", label: "Under observation", color: "color-mix(in srgb, var(--amber) 45%, var(--surface))", ids: by((s) => s.state === "observation") },
    { key: "alerting", label: "Alerting", color: "var(--amber)", ids: by((s) => s.state === "investigate") },
    { key: "escalation", label: "Escalation required", color: "var(--red)", ids: by((s) => s.state === "escalation") },
    { key: "dq", label: "Data-quality issue", color: "var(--violet)", ids: by((s) => s.state === "data_quality") },
  ].filter((s) => s.ids.length > 0 || s.key === "normal" || s.key === "alerting");
}

function Tip({ active, payload }: { active?: boolean; payload?: { payload: Seg }[] }) {
  if (!active || !payload?.length) return null;
  const s = payload[0].payload;
  return (
    <div className="rounded-md border border-line bg-raised px-3 py-2 text-xs shadow-xl">
      <p className="font-semibold text-text">{s.label}: <span className="num">{s.ids.length}</span> sensor{s.ids.length === 1 ? "" : "s"}</p>
      {s.ids.length > 0 && <p className="mt-0.5 font-mono text-[11px] text-muted">{s.ids.join(", ")}</p>}
    </div>
  );
}

export function SensorHealthRing({ sensors }: { sensors: SensorState[] }) {
  const reduce = useReducedMotion();
  const segs = segments(sensors);
  const total = sensors.length;
  const summary = `Sensor health: ${segs.map((s) => `${s.ids.length} ${s.label.toLowerCase()}`).join(", ")} of ${total} sensors.`;
  return (
    <div className="flex items-center gap-5 px-5 py-4" role="group" aria-label={summary}>
      <div className="relative h-[132px] w-[132px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={segs.filter((s) => s.ids.length > 0)} dataKey={(s: Seg) => s.ids.length} nameKey="label" innerRadius={46} outerRadius={62} paddingAngle={2} startAngle={90} endAngle={-270}
              stroke="none" isAnimationActive={!reduce} animationDuration={700}>
              {segs.filter((s) => s.ids.length > 0).map((s) => <Cell key={s.key} fill={s.color} />)}
            </Pie>
            <Tooltip content={<Tip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div><p className="num text-2xl font-semibold leading-none text-text">{total}</p><p className="mt-1 text-[10px] uppercase tracking-wider text-faint">sensors</p></div>
        </div>
      </div>
      <ul className="min-w-0 flex-1 space-y-1.5 text-xs">
        {segs.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} aria-hidden />
            <span className="text-muted">{s.label}</span>
            <span className="num ml-auto font-semibold text-text">{s.ids.length}</span>
          </li>
        ))}
        <li className="pt-1 text-[10px] leading-snug text-faint">State is computed by the backend from each sensor&apos;s own baseline. Simulated data.</li>
      </ul>
    </div>
  );
}
