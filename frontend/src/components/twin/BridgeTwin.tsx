"use client";

import {
  ArrowUpRight, ChevronsRight, FlaskConical, Hand, Minus, MousePointer2, Pause, Play, Plus, RotateCcw, ScanSearch, SkipForward,
  Snowflake, Thermometer, Unplug, Wind,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Component, useEffect, useMemo, useRef, useState } from "react";
import { BridgeSchematic } from "@/components/BridgeSchematic";
import { Breadcrumbs, TabLink } from "@/components/Breadcrumbs";
import { TimeSeriesChart } from "@/components/charts/TimeSeriesChart";
import { Button, Skeleton, StatusChip, Term } from "@/components/ui";
import { Panel } from "@/components/workspace/Panel";
import { post, useApi } from "@/lib/api";
import { cx, fmtNum, fmtSim, fmtZ } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { Series } from "@/lib/types";
import type { ViewApi } from "./BridgeScene";
import { RunToEventButton } from "@/components/RunToEvent";
import { SensorMarker } from "./SensorMarker";
import { FINDING_KIND_LABEL, KIND_ICON, KIND_LABEL, REPORTING_COLOR, ROLE_LABEL, SCENE_COMPONENTS, STATE_META, type SensorsResp, type SensorState, type TwinState } from "./sensors";

const BridgeScene = dynamic(() => import("./BridgeScene"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-xs text-[#8b97a8]">Loading 3D model…</div>,
});

class SceneBoundary extends Component<{ fallback: React.ReactNode; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch { return false; }
}

function StateBadge({ state }: { state: TwinState }) {
  const m = STATE_META[state];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold"
      style={{ color: m.color, borderColor: `${m.color}66`, background: `${m.color}1f` }} title={m.hint}>
      <span aria-hidden className="font-bold">{m.glyph || "•"}</span>{m.label}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
/** Overlay card for the selected sensor: everything comes from the backend sensor endpoint and series API. */
function SensorCard({ s, version, onClose }: { s: SensorState; version: unknown; onClose: () => void }) {
  const Icon = KIND_ICON[s.kind] ?? KIND_ICON.temperature;
  const { data: series } = useApi<Series>(`/api/assets/BRG-017/series?sensor_id=${s.sensor_id}&feature=${s.feature}&window=120`, version);
  const m = STATE_META[s.state];
  const incident = s.incident_id ?? null;
  const f = s.finding;
  const { state: app } = useApp();
  const woId = incident ? app?.incidents.find((i) => i.incident_id === incident)?.work_order_id : null;
  const mapped = s.component.mapped && !!s.component.id && SCENE_COMPONENTS.has(s.component.id);
  return (
    <aside className="force-dark pointer-events-auto flex max-h-full w-[340px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-white/10 bg-[rgba(9,14,21,0.92)] text-text shadow-2xl backdrop-blur"
      aria-label="Selected sensor details" data-coach="sensor-panel" aria-live="polite" data-sensor={s.sensor_id}>
      <div className="flex items-start gap-3 border-b border-white/10 p-3.5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border" style={{ color: m.color, borderColor: `${m.color}66`, background: `${m.color}18` }}><Icon size={18} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug" data-testid="component-name">{mapped ? s.component.name : "Component mapping unavailable"}</p>
          <p className="mt-0.5 text-xs text-muted"><span className="font-mono">{s.sensor_id}</span> · {KIND_LABEL[s.kind] ?? s.kind}</p>
        </div>
        <button onClick={onClose} aria-label="Collapse sensor panel" className="rounded p-1 text-faint hover:bg-white/10 hover:text-text"><ChevronsRight size={15} /></button>
      </div>
      <div className="space-y-3 overflow-y-auto p-3.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <StateBadge state={s.state} />
          {s.incident_role && <span className="rounded-full border border-white/15 px-2 py-0.5 text-[11px] text-[#c9d3e0]">{ROLE_LABEL[s.incident_role]}</span>}
        </div>
        {mapped
          ? <p className="text-[11px] text-faint">{s.finding ? <><span style={{ color: "#ff6b5e" }}>■</span> The red part of the model is this sensor&apos;s mapped component.</> : <><span style={{ color: "#38bdf8" }}>■</span> The blue part of the model is where this sensor is mounted.</>} Highlight shows location only — it is not proof of damage.</p>
          : <p className="rounded-md border border-violet/30 bg-violet-soft p-2 text-xs text-violet">Component mapping unavailable — no part of the model is highlighted for this sensor.</p>}
        <div className="grid grid-cols-3 gap-2 rounded-lg bg-white/5 p-2.5 text-xs">
          <div className="min-w-0"><p className="truncate text-faint">Observed · {s.feature_label}</p><p className="num mt-0.5 text-base font-semibold">{fmtNum(s.latest, 3)}<span className="ml-1 text-[10px] font-normal text-muted">{s.unit}</span></p></div>
          <div><p className="text-faint">Baseline</p><p className="num mt-0.5 text-base font-semibold">{fmtNum(s.baseline_median, 3)}</p></div>
          <div><p className="text-faint"><Term t="robust z-score">z</Term> · calc.</p><p className={cx("num mt-0.5 text-base font-semibold", s.state === "normal" ? "" : "text-amber")}>{fmtZ(s.z)}</p></div>
        </div>
        {(s.state !== "normal" || s.post_completion) && (
          <div className="rounded-lg border p-2.5 text-xs leading-relaxed" style={{ borderColor: `${m.color}40`, background: `${m.color}10` }}>
            <p className="mb-0.5 font-semibold" style={{ color: m.color }}>{s.finding_kind ? FINDING_KIND_LABEL[s.finding_kind] : s.post_completion ? "Post-completion (simulated)" : m.label}</p>
            <p>{s.state_reason}</p>
            {f && <p className="num mt-1 text-[11px] text-[#c9d3e0]">Since {fmtSim(f.onset_time)} UTC · {f.persistence_count} of {f.persistence_window} windows</p>}
          </div>
        )}
        <div className="flex flex-col gap-2">
          {incident && <Link href={`/incidents/${incident}?finding=${s.sensor_id}`} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-blue px-3 text-sm font-semibold text-white hover:brightness-110">
            <ScanSearch size={14} /> Open this finding <span className="num text-xs opacity-80">· {incident}</span></Link>}
          {incident && woId && <Link href={`/work-orders/${woId}`} className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-amber/50 bg-amber-soft px-3 text-xs font-semibold text-amber hover:brightness-110">Work order <span className="num opacity-80">· {woId}</span></Link>}
          {s.state === "data_quality" && <p className="rounded-md border border-violet/30 bg-violet-soft p-2 text-xs text-violet">Sensor issue — check the sensor before drawing structural conclusions. It cannot create an anomaly event.</p>}
        </div>
        <div className="-mx-1">{series ? <TimeSeriesChart series={series} height={120} compact /> : <Skeleton className="h-[120px]" />}</div>
        <Link href={`/assets/BRG-017/telemetry?sensor=${s.sensor_id}&feature=${s.feature}`} className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-white/15 bg-white/5 px-3 text-xs hover:bg-white/10">
          Full time-series &amp; baseline <ArrowUpRight size={12} />
        </Link>
      </div>
    </aside>
  );
}

function Hero({ data, selected, onSelect, onDeselect }: { data: SensorsResp | undefined; selected: SensorState | undefined; onSelect: (id: string) => void; onDeselect: () => void }) {
  const { state, version } = useApp();
  const api = useRef<ViewApi | null>(null);
  const markerEls = useRef<Map<string, HTMLElement>>(new Map());
  const register = (id: string, el: HTMLElement | null) => { if (el) markerEls.current.set(id, el); else markerEls.current.delete(id); };
  const [gl, setGl] = useState<boolean | null>(null);
  const [panMode, setPanMode] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  useEffect(() => setGl(webglAvailable()), []);
  const sensors = useMemo(() => data?.sensors ?? [], [data]);
  const a = state?.assets.find((x) => x.asset_id === "BRG-017");
  const inc = state?.incidents.filter((i) => i.asset_id === "BRG-017" && !i.closed).at(-1);
  const flagged = sensors.filter((s) => s.state !== "normal").length;
  const brief = data?.incident ?? null;
  const hlId = selected && selected.component.mapped && selected.component.id && SCENE_COMPONENTS.has(selected.component.id) ? selected.component.id : null;
  const highlight = { id: hlId, kind: (selected?.finding ? "finding" : "neutral") as "finding" | "neutral" };
  useEffect(() => { if (selected) setPanelOpen(true); }, [selected?.sensor_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const fallback = (
    <div className="h-full overflow-auto p-6">
      <p className="mb-3 text-xs text-amber">3D view unavailable on this device (WebGL not supported). Showing the 2D schematic fallback — same live sensor state.</p>
      <BridgeSchematic />
    </div>
  );
  const btn = "grid h-8 w-8 place-items-center rounded text-[#c9d3e0] hover:bg-white/10";
  return (
    <div className="relative h-[min(80vh,800px)] min-h-[560px] w-full overflow-hidden rounded-2xl border border-[#1c2a3d] bg-[#060a10] text-[#e8edf4] shadow-[var(--shadow)]" data-coach="twin">
      {gl === false ? fallback : gl === null || !data ? <Skeleton className="h-full w-full" /> : (
        <SceneBoundary fallback={fallback}><BridgeScene sensors={sensors} selected={selected?.sensor_id ?? null} highlight={highlight} markerEls={markerEls} api={api} panMode={panMode} /></SceneBoundary>
      )}
      {gl && data && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {sensors.map((s) => <SensorMarker key={s.sensor_id} s={s} selected={selected?.sensor_id === s.sensor_id} onSelect={onSelect} register={register} />)}
        </div>
      )}

      {/* top-left: identity, key metrics, alert */}
      <div className="pointer-events-none absolute left-4 top-4 flex max-w-[460px] flex-col gap-2.5">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-md border border-[#a78bfa66] bg-[#a78bfa22] px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-[#c4b5fd]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#a78bfa]" aria-hidden /> Simulated data — Hackathon demo
        </span>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{a?.name ?? "Bridge Alpha"}</h1>
          <p className="font-mono text-[11px] text-[#8b97a8]">BRG-017 · cable-stayed bridge · {data ? `replay ${fmtSim(data.cursor)} UTC` : "…"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2" data-coach="overview">
          {a && <span className="pointer-events-auto"><StatusChip status={a.status} size="sm" /></span>}
          <Metric label="sensors reporting" value={data ? `${data.reporting}/${data.total}` : "…"} dot />
          <Metric label="findings" value={String(brief?.findings_count ?? 0)} tone={brief ? "amber" : undefined} />
          <Metric label="flagged" value={String(flagged)} tone={flagged ? "amber" : undefined} />
        </div>
        {data?.post_completion && (
          <div data-testid="post-completion-banner" className="pointer-events-auto rounded-xl border border-blue/40 bg-[rgba(8,22,44,0.85)] p-3 backdrop-blur" role="status">
            <p className="text-xs font-semibold text-blue">Post-completion — simulated state</p>
            <p className="mt-1 text-xs text-[#d5dbe6]">Incident {data.post_completion.incident_id} was completed after the engineer approved the evidence for {data.post_completion.work_order_id}. The readings shown come from the designated post-completion scenario, not from physical sensors, and do not by themselves establish that the structure is safe. The original incident stays in the investigation and audit records.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Link href={`/work-orders/${data.post_completion.work_order_id}`} className="inline-flex h-7 items-center rounded-md border border-blue/50 px-2.5 text-xs font-semibold text-blue">Work order</Link>
              <Link href={`/incidents/${data.post_completion.incident_id}`} className="inline-flex h-7 items-center rounded-md border border-white/20 px-2.5 text-xs text-[#c9d3e0]">Original investigation</Link>
              <Link href={`/audit?work_order=${data.post_completion.work_order_id}`} className="inline-flex h-7 items-center rounded-md border border-white/20 px-2.5 text-xs text-[#c9d3e0]">Audit trail</Link>
            </div>
          </div>
        )}
        {inc && (
          <div data-testid="incident-banner" className="pointer-events-auto rounded-xl border border-amber/40 bg-[rgba(40,28,6,0.82)] p-3 backdrop-blur" role="status">
            <p className="flex flex-wrap items-center gap-2 text-xs font-semibold text-amber">
              <span className="relative flex h-2 w-2"><span className="twin-ping absolute inline-flex h-full w-full rounded-full bg-amber" /><span className="relative h-2 w-2 rounded-full bg-amber" /></span>
              {inc.escalation ? "Escalation required" : "Investigate"} · {inc.incident_id}{inc.priority ? ` · ${inc.priority}` : ""}{inc.timeframe ? ` · ${inc.timeframe}` : ""}
            </p>
            <p className="mt-1 text-xs text-[#d5dbe6]">One incident with <b>{brief?.findings_count ?? 1} finding{(brief?.findings_count ?? 1) === 1 ? "" : "s"}</b> from related sensors, first flagged {fmtSim(inc.onset_time)} UTC. Select one to inspect it.</p>
            <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Findings in this incident">
              {(brief?.finding_sensors ?? [inc.primary_sensor_id]).map((sid) => (
                <button key={sid} onClick={() => onSelect(sid)} aria-pressed={selected?.sensor_id === sid} data-finding-chip={sid}
                  className={cx("rounded-md border px-2 py-0.5 font-mono text-[11px]", selected?.sensor_id === sid ? "border-white bg-white/15 text-white" : "border-amber/40 text-amber hover:bg-amber/10")}>{sid}</button>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Link href={`/incidents/${inc.incident_id}`} className="inline-flex h-7 items-center gap-1 rounded-md bg-blue px-2.5 text-xs font-semibold text-white"><ScanSearch size={12} /> Investigation</Link>
              {inc.work_order_id && <Link href={`/work-orders/${inc.work_order_id}`} className="inline-flex h-7 items-center rounded-md border border-amber/50 px-2.5 text-xs font-semibold text-amber">Review work order</Link>}
            </div>
          </div>
        )}
      </div>

      {/* top-right: camera controls + sensor panel */}
      <div className="pointer-events-none absolute bottom-4 right-4 top-4 flex flex-col items-end gap-2.5">
        <div className="pointer-events-auto flex items-center gap-1 rounded-lg border border-white/10 bg-black/60 p-1 backdrop-blur" role="group" aria-label="3D view controls">
          <button onClick={() => setPanMode(false)} aria-pressed={!panMode} aria-label="Rotate mode: left-drag orbits" title="Rotate (left-drag orbits, right-drag pans)" className={cx(btn, !panMode && "bg-white/15")}><MousePointer2 size={14} /></button>
          <button onClick={() => setPanMode(true)} aria-pressed={panMode} aria-label="Pan mode: left-drag pans" title="Pan (left-drag pans, right-drag orbits)" className={cx(btn, panMode && "bg-white/15")}><Hand size={14} /></button>
          <span className="mx-0.5 h-5 w-px bg-white/10" aria-hidden />
          <button onClick={() => api.current?.zoom(0.8)} aria-label="Zoom in" className={btn}><Plus size={15} /></button>
          <button onClick={() => api.current?.zoom(1.25)} aria-label="Zoom out" className={btn}><Minus size={15} /></button>
          <button onClick={() => api.current?.reset()} aria-label="Reset view" className="flex h-8 items-center gap-1 rounded px-2 text-xs text-[#c9d3e0] hover:bg-white/10"><RotateCcw size={13} /> Reset view</button>
        </div>
        {selected && data && panelOpen && <SensorCard s={selected} version={version} onClose={() => setPanelOpen(false)} />}
        {selected && !panelOpen && <button onClick={() => setPanelOpen(true)} className="pointer-events-auto rounded-lg border border-white/10 bg-black/60 px-3 py-1.5 text-xs text-[#c9d3e0] hover:bg-white/10">Show {selected.sensor_id} details</button>}
        {selected && <button onClick={onDeselect} className="pointer-events-auto rounded-lg border border-white/10 bg-black/60 px-3 py-1.5 text-xs text-[#c9d3e0] hover:bg-white/10" aria-label="Clear selection and highlight">Clear selection</button>}
      </div>

      {/* bottom-left: legend */}
      <div className="absolute bottom-4 left-4 rounded-lg border border-white/10 bg-black/65 p-2.5 text-[11px] backdrop-blur" aria-label="Sensor state legend">
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#8b97a8]">Sensor state</p>
        <ul className="space-y-1">
          {(Object.keys(STATE_META) as TwinState[]).filter((k) => k !== "escalation" || sensors.some((s) => s.state === "escalation")).map((k) => (
            <li key={k} className="flex items-center gap-2 text-[#c9d3e0]">
              <span className={cx("grid h-4 w-4 place-items-center border-2 text-[9px] font-bold", k === "data_quality" ? "rotate-45 rounded-[3px]" : "rounded-full")}
                style={{ borderColor: STATE_META[k].color, color: STATE_META[k].color, background: k === "investigate" || k === "escalation" ? `${STATE_META[k].color}33` : "transparent" }}>
                <span className={k === "data_quality" ? "-rotate-45" : ""}>{STATE_META[k].glyph}</span>
              </span>
              {STATE_META[k].label}
            </li>
          ))}
        </ul>
        <p className="mt-2 flex items-center gap-1.5 text-[10px] text-[#c9d3e0]"><span className="h-2 w-2 rounded-sm" style={{ background: "#ff3b30" }} aria-hidden /> mapped component of a selected finding</p>
        <p className="mt-1 flex items-center gap-1.5 text-[10px] text-[#c9d3e0]"><span className="h-2 w-2 rounded-sm" style={{ background: "#38bdf8" }} aria-hidden /> mounting location of a selected normal sensor</p>
        <p className="mt-1 flex items-center gap-1.5 text-[10px] text-[#8b97a8]"><span className="h-1.5 w-1.5 rounded-full" style={{ background: REPORTING_COLOR }} aria-hidden /> green dot = data link reporting (not a safety indicator)</p>
      </div>
      <p className="pointer-events-none absolute bottom-4 left-1/2 hidden -translate-x-1/2 rounded bg-black/50 px-2 py-1 text-[10px] text-[#8b97a8] lg:block">
        {panMode ? "Drag to pan · right-drag to rotate" : "Drag to rotate · right-drag to pan"} · scroll to zoom · click a sensor · explanatory model, not an engineering drawing
      </p>

      <p className="sr-only" role="status" data-highlight={highlight.id ?? ""} data-highlight-kind={highlight.id ? highlight.kind : ""}>
        {highlight.id ? `Highlighted on the model: ${selected?.component.name} (${highlight.kind === "finding" ? "component of the selected finding" : "mounting location of the selected sensor"})` : "No component highlighted"}
      </p>
      <table className="sr-only">
        <caption>Bridge sensors and their current backend-computed state</caption>
        <thead><tr><th>Sensor</th><th>Type</th><th>Location</th><th>State</th><th>Latest</th></tr></thead>
        <tbody>{sensors.map((s) => <tr key={s.sensor_id}><td>{s.sensor_id}</td><td>{KIND_LABEL[s.kind]}</td><td>{s.location}</td><td>{STATE_META[s.state].label}</td><td>{fmtNum(s.latest, 4)} {s.unit}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function Metric({ label, value, tone, dot }: { label: string; value: string; tone?: "amber"; dot?: boolean }) {
  return (
    <span className="pointer-events-none inline-flex items-baseline gap-1.5 rounded-lg border border-white/10 bg-black/55 px-2.5 py-1 backdrop-blur">
      {dot && <span className="h-1.5 w-1.5 self-center rounded-full" style={{ background: REPORTING_COLOR }} aria-hidden />}
      <span className={cx("num text-sm font-semibold", tone === "amber" ? "text-amber" : "text-[#e8edf4]")}>{value}</span>
      <span className="text-[10px] text-[#8b97a8]">{label}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
interface WhatIfResult { whatif_id: string; diff: { field: string; before: unknown; after: unknown }[]; explanation: string[] }
const show = (v: unknown) => (v === null || v === undefined ? "—" : Array.isArray(v) ? (v.length ? v.join(", ") : "[]") : String(v));

/** Replay controls, simulated-fault injection and the live environment readings, in one slim strip. */
function SimulationBar({ sel, env, onSelect }: { sel: SensorState | undefined; env: SensorsResp["environment"]; onSelect: (id: string) => void }) {
  const { state, sim, user, pushToast, refresh } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [wi, setWi] = useState<WhatIfResult | null>(null);
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } catch (e) { pushToast({ tone: "red", title: "Action failed", body: (e as Error).message }); }
    setBusy(null); await refresh();
  };
  const inject = () => sel && run("inject", async () => {
    await post("/api/sim/inject-fault", { sensor_id: sel.sensor_id, kind: "frozen_sensor", actor: user.name, role: user.role });
    await post("/api/sim/step", { ticks: 4 });
    pushToast({ tone: "violet", title: `Simulated frozen-sensor fault on ${sel.sensor_id}`, body: "Replay advanced one hour; the Sentinel re-checked data quality." });
  });
  const preview = () => sel && run("whatif", async () => {
    setWi(await post<WhatIfResult>("/api/whatif", { asset_id: "BRG-017", interventions: [{ type: "frozen_sensor", sensor_id: sel.sensor_id }], horizon: "end", actor: user.name }));
  });
  const running = state?.sim.running;
  return (
    <Panel title="Simulation" data-coach="scenario-panel" right={<span className="text-[10px] text-faint">simulated data · drives the real backend</span>}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Replay controls">
          <Button size="sm" variant="primary" onClick={sim.toggle}>{running ? <><Pause size={13} /> Pause</> : <><Play size={13} /> Play</>}</Button>
          <Button size="sm" onClick={() => sim.step(4)}><SkipForward size={13} /> +1 h</Button>
          <RunToEventButton size="sm" variant="secondary" label="Next event" />
          <Button size="sm" variant="ghost" onClick={() => sim.reset()}><RotateCcw size={13} /> Replay scenario</Button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-violet/30 bg-violet-soft px-2.5 py-1.5" role="group" aria-label="Fault injection">
          <span className="text-xs text-text">Freeze <span className="font-mono">{sel?.sensor_id ?? "(select a sensor)"}</span> (simulated fault)</span>
          <Button size="sm" disabled={!sel || busy !== null} onClick={inject}><Unplug size={13} /> {busy === "inject" ? "Injecting…" : "Inject & advance 1 h"}</Button>
          <Button size="sm" variant="secondary" disabled={!sel || busy !== null} onClick={preview}><FlaskConical size={13} /> {busy === "whatif" ? "Running…" : "Preview impact"}</Button>
        </div>
        <div className="ml-auto flex items-center gap-4 text-xs" data-coach="env">
          <button onClick={() => onSelect("TMP-B1")} className="flex items-center gap-1.5 text-muted hover:text-text" title="Select temperature sensor TMP-B1"><Thermometer size={14} /> <span className="num text-sm font-semibold text-text">{env.temperature_c === null ? "—" : `${env.temperature_c.toFixed(1)} °C`}</span></button>
          <button onClick={() => onSelect("WND-1")} className="flex items-center gap-1.5 text-muted hover:text-text" title="Select wind sensor WND-1"><Wind size={14} /> <span className="num text-sm font-semibold text-text">{env.wind_ms === null ? "—" : `${env.wind_ms.toFixed(1)} m/s`}</span></button>
        </div>
      </div>
      {wi && (
        <div className="border-t border-line-soft px-4 py-3 text-xs" aria-live="polite">
          <p className="mb-1 font-semibold text-text"><Snowflake size={12} className="mr-1 inline text-violet" />Sandbox preview {wi.whatif_id}: {wi.diff.length} field(s) would change <span className="font-normal text-faint">— the live workflow is untouched</span></p>
          <table className="w-full"><tbody>{wi.diff.slice(0, 5).map((d) => (
            <tr key={d.field} className="border-t border-line-soft align-top"><td className="py-1 pr-2 font-mono text-[10px] text-faint">{d.field}</td>
              <td className="py-1 pr-2 text-muted"><span className="line-clamp-2">{show(d.before)}</span></td><td className="py-1 text-amber"><span className="line-clamp-2">{show(d.after)}</span></td></tr>
          ))}</tbody></table>
          <p className="mt-1 text-[11px] text-muted">{wi.explanation.at(-1)}</p>
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------
export function BridgeTwin() {
  const { version } = useApp();
  const { data } = useApi<SensorsResp>("/api/assets/BRG-017/sensors", version);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("sensor");
    if (q) setSelected(q);
  }, []);
  const sensors = useMemo(() => data?.sensors ?? [], [data]);
  const sel = sensors.find((s) => s.sensor_id === selected);
  return (
    <div className="space-y-4">
      <Breadcrumbs items={[{ label: "Infrastructure", href: "/assets" }, { label: "Bridge Alpha" }]}
        right={<TabLink href="/assets/BRG-017/telemetry">Telemetry &amp; baselines</TabLink>} />
      <Hero data={data} selected={sel} onSelect={(id) => setSelected((cur) => (cur === id ? null : id))} onDeselect={() => setSelected(null)} />
      {data ? <SimulationBar sel={sel} env={data.environment} onSelect={setSelected} /> : <Skeleton className="h-24" />}
    </div>
  );
}
