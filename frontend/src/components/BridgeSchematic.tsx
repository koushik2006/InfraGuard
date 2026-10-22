"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ArrowUpRight, CircleSlash, ScanSearch, Unplug } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useApi } from "@/lib/api";
import { cx, fmtNum, fmtSim, fmtZ } from "@/lib/format";
import { useApp } from "@/lib/store";
import { Sparkline } from "./charts/Sparkline";
import { Badge, SimulatedTag } from "./ui";

export interface SensorState {
  sensor_id: string; kind: string; location: string; schematic: { x: number; y: number; label: string } | null;
  feature: string; feature_label: string; unit: string; latest: number | null; latest_time: string; z: number | null;
  exceeding: boolean; quality: string; quality_detail: string; detection_sensor: boolean; baseline_median: number | null;
  baseline_version: string; baseline_status: string; trend: (number | null)[]; trend_quality: string[];
  incident_role: "primary" | "corroborating" | null; incident_id: string | null;
  anomaly_interval: { onset: string; last: string } | null; evidence: { ref_id: string; title: string; summary: string }[];
}
interface SensorsResp { asset_id: string; cursor: string; sensors: SensorState[]; open_incident: string | null }

type Cat = "anomaly" | "corroborating" | "quality" | "exceeding" | "normal" | "context";
function category(s: SensorState): Cat {
  if (s.quality !== "ok") return "quality";
  if (s.incident_role === "primary") return "anomaly";
  if (s.incident_role === "corroborating") return "corroborating";
  if (!s.detection_sensor) return "context";
  if (s.exceeding) return "exceeding";
  return "normal";
}
const CAT_LABEL: Record<Cat, string> = {
  anomaly: "Statistical anomaly (primary)", corroborating: "Corroborating anomaly", quality: "Sensor / data-quality issue",
  exceeding: "Single-window exceedance", normal: "No anomaly detected", context: "Context sensor (not used for detection)",
};

function Marker({ s, selected, onSelect }: { s: SensorState; selected: boolean; onSelect: () => void }) {
  const reduce = useReducedMotion();
  const p = s.schematic!;
  const cat = category(s);
  const color = cat === "anomaly" || cat === "corroborating" || cat === "exceeding" ? "var(--amber)" : cat === "quality" ? "var(--violet)" : cat === "context" ? "var(--slate)" : "var(--blue)";
  const y = 92;
  return (
    <g role="button" tabIndex={0} aria-pressed={selected} aria-label={`${s.sensor_id}, ${s.location}: ${CAT_LABEL[cat]}`}
      onClick={onSelect} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(); } }}
      className="cursor-pointer outline-none [&:focus-visible>.focus]:opacity-100">
      <line x1={p.x} x2={p.x} y1={y + 14} y2={150} stroke={color} strokeWidth={1.5} strokeDasharray={cat === "context" ? "3 3" : undefined} />
      {cat === "anomaly" && !reduce && (
        <motion.circle cx={p.x} cy={y} r={16} fill="none" stroke={color} strokeWidth={2}
          initial={{ opacity: 0.7, scale: 1 }} animate={{ opacity: 0, scale: 1.9 }} transition={{ duration: 1.6, repeat: Infinity }}
          style={{ transformOrigin: `${p.x}px ${y}px` }} />
      )}
      <circle className="focus opacity-0" cx={p.x} cy={y} r={21} fill="none" stroke="var(--blue)" strokeWidth={2} />
      {selected && <circle cx={p.x} cy={y} r={19} fill="none" stroke="var(--text)" strokeWidth={1.5} strokeDasharray="3 3" />}
      {cat === "quality" ? (
        <rect x={p.x - 11} y={y - 11} width={22} height={22} transform={`rotate(45 ${p.x} ${y})`} fill="var(--violet-soft)" stroke={color} strokeWidth={2} />
      ) : (
        <circle cx={p.x} cy={y} r={13} fill={cat === "normal" || cat === "context" ? "var(--surface)" : "var(--amber-soft)"} stroke={color} strokeWidth={2} />
      )}
      <text x={p.x} y={y + 4} textAnchor="middle" fontSize={12} fontWeight={700} fill={color}>
        {cat === "anomaly" || cat === "corroborating" || cat === "exceeding" ? "!" : cat === "quality" ? "?" : s.kind === "temperature" ? "T" : "•"}
      </text>
      <text x={p.x} y={y - 24} textAnchor="middle" fontSize={11} fontFamily="var(--font-mono)" fill="var(--text)">{s.sensor_id}</text>
    </g>
  );
}

export function BridgeSchematic({ compact = false }: { compact?: boolean }) {
  const { version } = useApp();
  const { data } = useApi<SensorsResp>("/api/assets/BRG-017/sensors", version);
  const [sel, setSel] = useState<string | null>(null);
  const sensors = data?.sensors ?? [];
  const selected = sensors.find((s) => s.sensor_id === sel) ?? (compact ? undefined : sensors.find((s) => s.incident_role === "primary") ?? sensors[0]);

  return (
    <div className={cx("grid gap-4", !compact && "xl:grid-cols-[1fr_340px]")}>
      <div>
        <svg viewBox="0 0 1000 330" className="w-full" role="group" aria-label="Simulated explanatory schematic of the Riverside Road Bridge with sensor markers. Not an engineering drawing.">
          <defs>
            <pattern id="water" width="24" height="8" patternUnits="userSpaceOnUse"><path d="M0 4 q6 -4 12 0 t12 0" fill="none" stroke="var(--blue)" strokeOpacity={0.18} /></pattern>
          </defs>
          <rect x={0} y={262} width={1000} height={68} fill="url(#water)" />
          <path d="M0 262 L60 210 L60 262 Z" fill="var(--raised)" stroke="var(--line)" />
          <path d="M1000 262 L940 210 L940 262 Z" fill="var(--raised)" stroke="var(--line)" />
          {[340, 660].map((x, k) => (
            <g key={x}>
              <rect x={x - 12} y={170} width={24} height={110} rx={2} fill="var(--raised)" stroke="var(--line)" />
              <rect x={x - 22} y={276} width={44} height={10} rx={2} fill="var(--raised)" stroke="var(--line)" />
              <text x={x} y={306} textAnchor="middle" fontSize={11} fill="var(--faint)">Pier {k + 1}</text>
            </g>
          ))}
          <rect x={52} y={150} width={896} height={20} rx={3} fill="var(--raised)" stroke="var(--muted)" strokeOpacity={0.6} />
          <line x1={52} x2={948} y1={160} y2={160} stroke="var(--line)" />
          {[{ x: 196, t: "Span 1" }, { x: 500, t: "Main span" }, { x: 804, t: "Span 3" }].map((s) => (
            <text key={s.t} x={s.x} y={196} textAnchor="middle" fontSize={11} fill="var(--faint)">{s.t}</text>
          ))}
          <text x={660} y={140} textAnchor="middle" fontSize={10} fill="var(--faint)">EJ-2</text>
          {sensors.filter((s) => s.schematic).map((s) => (
            <Marker key={s.sensor_id} s={s} selected={selected?.sensor_id === s.sensor_id && !compact} onSelect={() => setSel(s.sensor_id)} />
          ))}
          <text x={8} y={20} fontSize={10} fill="var(--violet)" fontWeight={700} letterSpacing="0.08em">SIMULATED · EXPLANATORY SCHEMATIC · NOT AN ENGINEERING DRAWING</text>
        </svg>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-full border-2 border-blue" /> No anomaly detected</span>
          <span className="inline-flex items-center gap-1.5"><span className="grid h-3.5 w-3.5 place-items-center rounded-full border-2 border-amber text-[9px] font-bold text-amber">!</span> Statistical anomaly</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rotate-45 border-2 border-violet" /> Sensor / data-quality issue</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-full border-2 border-dashed border-slate" /> Context sensor</span>
        </div>
        {/* Text alternative */}
        <table className="sr-only">
          <caption>Bridge sensors and their current status</caption>
          <thead><tr><th>Sensor</th><th>Location</th><th>Status</th><th>Latest</th></tr></thead>
          <tbody>{sensors.map((s) => <tr key={s.sensor_id}><td>{s.sensor_id}</td><td>{s.location}</td><td>{CAT_LABEL[category(s)]}</td><td>{fmtNum(s.latest)} {s.unit}</td></tr>)}</tbody>
        </table>
      </div>
      {!compact && selected && <SensorPanel s={selected} />}
    </div>
  );
}

function SensorPanel({ s }: { s: SensorState }) {
  const cat = category(s);
  return (
    <aside className="rounded-lg border border-line bg-raised p-4" aria-live="polite">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-mono text-sm font-semibold text-text">{s.sensor_id}</p>
          <p className="text-xs text-muted">{s.location}</p>
        </div>
        <SimulatedTag />
      </div>
      <div className="mt-3">
        {cat === "quality" ? <Badge tone="violet" icon={<Unplug size={11} />}>{CAT_LABEL[cat]}</Badge>
          : cat === "anomaly" || cat === "corroborating" || cat === "exceeding" ? <Badge tone="amber" icon={<ScanSearch size={11} />}>{CAT_LABEL[cat]}</Badge>
          : cat === "context" ? <Badge tone="slate" icon={<CircleSlash size={11} />}>{CAT_LABEL[cat]}</Badge>
          : <Badge tone="blue">{CAT_LABEL[cat]}</Badge>}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <div><dt className="text-faint">{s.feature_label}</dt><dd className="num mt-0.5 text-base font-semibold text-text">{fmtNum(s.latest, 4)} <span className="text-xs text-muted">{s.unit}</span></dd></div>
        <div><dt className="text-faint">Robust z</dt><dd className={cx("num mt-0.5 text-base font-semibold", s.exceeding ? "text-amber" : "text-text")}>{fmtZ(s.z)}</dd></div>
        <div><dt className="text-faint">Baseline median</dt><dd className="num mt-0.5 text-text">{fmtNum(s.baseline_median, 4)} {s.unit}</dd></div>
        <div><dt className="text-faint">Data quality</dt><dd className={cx("mt-0.5", s.quality === "ok" ? "text-text" : "text-violet")}>{s.quality}</dd></div>
        <div className="col-span-2"><dt className="text-faint">Baseline</dt><dd className="num mt-0.5 text-text">{s.baseline_version} · {s.baseline_status}</dd></div>
        <div className="col-span-2"><dt className="text-faint">Latest window</dt><dd className="num mt-0.5 text-text">{fmtSim(s.latest_time)} UTC</dd></div>
      </dl>
      {s.quality !== "ok" && <p className="mt-2 text-xs text-violet">{s.quality_detail}</p>}
      <div className="mt-4">
        <p className="mb-1 text-[11px] text-faint">Recent trend (last 48 windows)</p>
        <Sparkline width={300} height={48} median={s.baseline_median} label={`${s.sensor_id} recent trend`}
          points={s.trend.map((v, i) => ({ i, v, q: s.trend_quality[i], x: false }))} />
      </div>
      {s.anomaly_interval && (
        <p className="mt-3 text-xs text-amber">Anomaly interval {fmtSim(s.anomaly_interval.onset)} → {fmtSim(s.anomaly_interval.last)}</p>
      )}
      {s.evidence.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-[11px] text-faint">Evidence references</p>
          <ul className="space-y-1">{s.evidence.map((e) => <li key={e.ref_id} className="text-xs text-muted"><span className="num mr-1 text-blue">{e.ref_id}</span>{e.title}</li>)}</ul>
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href={`/assets/BRG-017?sensor=${s.sensor_id}&feature=${s.feature}`} className="inline-flex h-8 items-center gap-1 rounded-md border border-line bg-surface px-3 text-xs text-text hover:border-faint">
          Time-series chart <ArrowUpRight size={12} />
        </Link>
        {s.incident_id && (
          <Link href={`/incidents/${s.incident_id}`} className="inline-flex h-8 items-center gap-1 rounded-md bg-blue px-3 text-xs font-semibold text-white">
            Investigation <ArrowUpRight size={12} />
          </Link>
        )}
      </div>
    </aside>
  );
}
