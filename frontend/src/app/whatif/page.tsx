"use client";

import { ArrowRight, Beaker, CheckCircle2, CircleAlert, FlaskConical, History, Info, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, Button, Card, CardHeader, Empty, PageHeader, Segmented, SimulatedTag } from "@/components/ui";
import { post, useApi } from "@/lib/api";
import { cx, FEATURE_LABEL, fmtNum, fmtSim, fmtWall } from "@/lib/format";
import { useApp } from "@/lib/store";

type IvType = "frozen_sensor" | "stale_sensor" | "variant" | "environment" | "follow_up";
interface Side { horizon_window: number; horizon_time: string; fields: Record<string, unknown>; series: { sensor_id: string; feature: string; points: { i: number; v: number | null; q: string; z: number | null }[] } }
interface WhatIf {
  whatif_id: string; label: string; asset_id: string; interventions: Record<string, unknown>[]; horizon: string; cursor: string; seed: number;
  created_at: string; before: Side; after: Side; diff: { field: string; before: unknown; after: unknown }[]; explanation: string[];
  approval_gate: string; result_digest: string; base_config: { seed: number; variants: Record<string, string>; environment: string };
}
interface WhatIfListItem { whatif_id: string; created_at: string; asset_id: string; interventions: Record<string, unknown>[]; changed_fields: number; seed: number }

const SENSORS: Record<string, string[]> = { "BRG-017": ["ACC-M1", "ACC-Q1", "ACC-P2", "TMP-B1"], "BLD-204": ["TLT-N1", "TLT-E1", "TMP-A1"], "RW-031": ["IN-01", "IN-02", "CM-01"] };
const VARIANTS: Record<string, string[]> = { "BRG-017": ["persistent_deviation", "benign_transient", "normal"], "BLD-204": ["gradual_drift", "normal"], "RW-031": ["normal"] };
const GROUP = (f: string) => f.startsWith("detection") ? "Detection result" : f.startsWith("quality") ? "Data-quality status" : f.startsWith("investigation") ? "Evidence references"
  : f.startsWith("hypothesis") ? "Hypothesis status" : f.startsWith("triage") || f.startsWith("retriage") ? "Triage rationale" : f.startsWith("work_order") ? "Work-order state" : f.startsWith("verification") ? "Verification outcome" : "Other";
const show = (v: unknown) => v === null || v === undefined ? "—" : Array.isArray(v) ? (v.length ? v.join(", ") : "[]") : typeof v === "boolean" ? (v ? "yes" : "no") : String(v);

function describe(iv: Record<string, unknown>): string {
  switch (iv.type) {
    case "frozen_sensor": return `Freeze ${iv.sensor_id} from ${iv.from_time ? fmtSim(String(iv.from_time)) : "the current replay time"}`;
    case "stale_sensor": return `${iv.sensor_id} stops reporting from ${iv.from_time ? fmtSim(String(iv.from_time)) : "the current replay time"}`;
    case "variant": return `Scenario variant → ${String(iv.variant).replace("_", " ")}`;
    case "environment": return `Environment preset → ${iv.preset}`;
    case "follow_up": return `Load follow-up set “${iv.set}”`;
    default: return JSON.stringify(iv);
  }
}

export default function WhatIfLab() {
  const { state, version, user, pushToast } = useApp();
  const [asset, setAsset] = useState("BRG-017");
  const [type, setType] = useState<IvType>("frozen_sensor");
  const [sensor, setSensor] = useState("ACC-M1");
  const [from, setFrom] = useState("2026-03-05T12:00:00Z");
  const [variant, setVariant] = useState("benign_transient");
  const [preset, setPreset] = useState("heatwave");
  const [fset, setFset] = useState("improves");
  const [horizon, setHorizon] = useState<"cursor" | "end">("end");
  const [res, setRes] = useState<WhatIf | null>(null);
  const [busy, setBusy] = useState(false);
  const [repro, setRepro] = useState<{ reproducible: boolean; recorded_digest: string; replayed_digest: string } | null>(null);
  const [showSame, setShowSame] = useState(false);
  const { data: list, reload } = useApi<WhatIfListItem[]>("/api/whatif", version);

  useEffect(() => { setSensor(SENSORS[asset][0]); setVariant(VARIANTS[asset].at(-1)!); }, [asset]);
  useEffect(() => {
    if (state && state.sim.cursor > "2026-03-05T17:00:00Z") setHorizon("cursor");
  }, [state?.sim.cursor]); // eslint-disable-line react-hooks/exhaustive-deps

  const intervention = (): Record<string, unknown> => {
    if (type === "frozen_sensor" || type === "stale_sensor") return { type, sensor_id: sensor, ...(from ? { from_time: from } : {}) };
    if (type === "variant") return { type, variant };
    if (type === "environment") return { type, preset };
    return { type, set: fset };
  };
  const run = async () => {
    setBusy(true); setRepro(null);
    try {
      const r = await post<WhatIf>("/api/whatif", { asset_id: asset, interventions: [intervention()], horizon, actor: user.name, role: user.role });
      setRes(r); reload();
    } catch (e) { pushToast({ tone: "red", title: "What-if failed", body: (e as Error).message }); }
    setBusy(false);
  };
  const replay = async () => {
    if (!res) return;
    const r = await post<{ reproducible: boolean; recorded_digest: string; replayed_digest: string }>(`/api/whatif/${res.whatif_id}/replay`);
    setRepro(r);
  };
  const open = async (wid: string) => { setRes(await (await fetch(`/api/whatif/${wid}`)).json()); setRepro(null); };

  const chart = useMemo(() => {
    if (!res) return [];
    const m = new Map<number, { i: number; before?: number | null; after?: number | null; qa?: string }>();
    res.before.series.points.forEach((p) => m.set(p.i, { i: p.i, before: p.v }));
    res.after.series.points.forEach((p) => m.set(p.i, { ...(m.get(p.i) ?? { i: p.i }), after: p.v, qa: p.q }));
    return [...m.values()].sort((a, b) => a.i - b.i);
  }, [res]);
  const groups = useMemo(() => {
    const g: Record<string, WhatIf["diff"]> = {};
    res?.diff.forEach((d) => { (g[GROUP(d.field)] ??= []).push(d); });
    return g;
  }, [res]);
  const unchanged = res ? Object.keys(res.after.fields).filter((k) => !res.diff.some((d) => d.field === k)) : [];

  const sel = "h-9 rounded-md border border-line bg-raised px-2 text-sm text-text";
  return (
    <div>
      <PageHeader eyebrow={<><FlaskConical size={13} /> What-If Investigation Lab <SimulatedTag /></>} title="Change the scenario, re-run the real pipeline"
        subtitle="Each intervention changes the actual scenario inputs and re-runs detection, quality checks, investigation, triage, planning and (for follow-ups) verification in a sandbox run. Sandbox proposals can never be approved and trigger no real-world action." />
      <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Intervention" subtitle="Hypothetical change — clearly separated from observed simulated readings" icon={<Beaker size={15} />} />
            <div className="space-y-4 px-5 py-4 text-sm">
              <label className="block text-xs text-faint">Asset
                <select className={cx(sel, "mt-1 w-full")} value={asset} onChange={(e) => setAsset(e.target.value)}>
                  <option value="BRG-017">BRG-017 · Riverside Road Bridge</option><option value="BLD-204">BLD-204 · Civic Annex Building</option><option value="RW-031">RW-031 · Hillside Retaining Wall</option>
                </select>
              </label>
              <fieldset>
                <legend className="text-xs text-faint">Type</legend>
                <div className="mt-1 grid grid-cols-2 gap-1.5">
                  {([["frozen_sensor", "Frozen sensor"], ["stale_sensor", "Stale sensor"], ["variant", "Scenario variant"], ["environment", "Environment preset"], ["follow_up", "Follow-up readings"]] as [IvType, string][]).map(([v, l]) => (
                    <button key={v} onClick={() => setType(v)} aria-pressed={type === v} className={cx("h-8 rounded-md border px-2 text-xs", type === v ? "border-blue bg-blue-soft text-text" : "border-line bg-raised text-muted hover:text-text")}>{l}</button>
                  ))}
                </div>
              </fieldset>
              {(type === "frozen_sensor" || type === "stale_sensor") && (
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs text-faint">Sensor<select className={cx(sel, "mt-1 w-full")} value={sensor} onChange={(e) => setSensor(e.target.value)}>{SENSORS[asset].map((s) => <option key={s}>{s}</option>)}</select></label>
                  <label className="text-xs text-faint">Fault starts<select className={cx(sel, "mt-1 w-full")} value={from} onChange={(e) => setFrom(e.target.value)}>
                    <option value="2026-03-05T00:00:00Z">05 Mar 00:00 (monitoring start)</option>
                    <option value="2026-03-05T12:00:00Z">05 Mar 12:00</option>
                    <option value="2026-03-06T00:00:00Z">06 Mar 00:00</option>
                    <option value="">Current replay time</option>
                  </select></label>
                </div>
              )}
              {type === "variant" && <label className="block text-xs text-faint">Variant<select className={cx(sel, "mt-1 w-full")} value={variant} onChange={(e) => setVariant(e.target.value)}>{VARIANTS[asset].map((v) => <option key={v} value={v}>{v.replace("_", " ")}</option>)}</select></label>}
              {type === "environment" && <label className="block text-xs text-faint">Preset (bounded)<select className={cx(sel, "mt-1 w-full")} value={preset} onChange={(e) => setPreset(e.target.value)}>
                <option value="nominal">Nominal</option><option value="heatwave">Heatwave (+8 °C on monitoring days)</option><option value="cold_snap">Cold snap (−8 °C on monitoring days)</option></select></label>}
              {type === "follow_up" && <label className="block text-xs text-faint">Predefined follow-up set<select className={cx(sel, "mt-1 w-full")} value={fset} onChange={(e) => setFset(e.target.value)}>
                <option value="persists">Deviation persists</option><option value="improves">Returns toward baseline</option><option value="insufficient">Logger outage (insufficient)</option></select></label>}
              <div>
                <p className="mb-1 text-xs text-faint">Evaluate up to</p>
                <Segmented label="Horizon" value={horizon} onChange={setHorizon} options={[{ value: "cursor", label: `Replay time (${state ? fmtSim(state.sim.cursor) : "…"})` }, { value: "end", label: "End of scenario" }]} />
              </div>
              <div className="rounded-md border border-line bg-raised p-3 text-xs text-muted">
                <p><b className="text-text">Base (observed, simulated):</b> run {state?.run.run_id} · seed <span className="num">{state?.run.config.seed}</span> · {state?.run.config.environment}</p>
                <p className="mt-1"><b className="text-amber">Hypothetical:</b> {describe(intervention())}</p>
              </div>
              <Button variant="primary" className="w-full" onClick={run} disabled={busy} data-coach="whatif-run"><FlaskConical size={15} /> {busy ? "Re-running pipeline…" : "Run what-if"}</Button>
            </div>
          </Card>
          <Card>
            <CardHeader title="Recorded what-if runs" subtitle="Each is stored as a new, labelled sandbox run" icon={<History size={15} />} />
            <ul className="max-h-72 divide-y divide-line-soft overflow-y-auto">
              {(list ?? []).length === 0 && <li className="px-5 py-3 text-xs text-muted">None yet.</li>}
              {(list ?? []).map((w) => (
                <li key={w.whatif_id}><button onClick={() => open(w.whatif_id)} className={cx("w-full px-5 py-2.5 text-left text-xs hover:bg-raised", res?.whatif_id === w.whatif_id && "bg-raised")}>
                  <span className="flex justify-between"><span className="num font-semibold text-text">{w.whatif_id}</span><span className="num text-faint">{fmtWall(w.created_at)}</span></span>
                  <span className="block text-muted">{w.asset_id} · {w.interventions.map(describe).join("; ")} · {w.changed_fields} changed</span>
                </button></li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="min-w-0 space-y-5">
          {!res ? (
            <Card><Empty icon={<FlaskConical size={22} />} title="Run an intervention to compare" body="Try freezing ACC-M1 from 05 Mar 12:00: the frozen-sensor rule flags it, it can no longer trigger, and another sensor that meets the rule takes over. Or freeze ACC-P2 at the current time and see why nothing changes yet." /></Card>
          ) : (
            <>
              <Card active>
                <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2"><span className="num text-sm font-semibold">{res.whatif_id}</span><Badge tone="amber">What-if simulation run (sandbox)</Badge><SimulatedTag /></div>
                    <p className="mt-1 text-sm text-text">{res.interventions.map(describe).join("; ")}</p>
                    <p className="num mt-1 text-xs text-muted">{res.asset_id} · seed {res.seed} · horizon {res.horizon === "end" ? "end of scenario" : fmtSim(res.cursor)} (window {res.after.horizon_window}) · created {fmtWall(res.created_at)}</p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <Button size="sm" onClick={replay}><RotateCcw size={13} /> Replay (reproducibility check)</Button>
                    {repro && (repro.reproducible
                      ? <Badge tone="blue" icon={<CheckCircle2 size={11} />}>Reproducible · digest {repro.replayed_digest}</Badge>
                      : <Badge tone="red" icon={<CircleAlert size={11} />}>Discrepancy: {repro.recorded_digest} ≠ {repro.replayed_digest}</Badge>)}
                  </div>
                </div>
                <p className="border-t border-line-soft px-5 py-2.5 text-xs text-muted">{res.approval_gate}</p>
              </Card>

              <Card>
                <CardHeader title="Why the result is what it is" subtitle="Explained from the actual detection rules and inputs" icon={<Info size={15} />} />
                <ul className="space-y-1.5 px-5 py-4 text-sm">{res.explanation.map((l) => <li key={l} className="flex gap-2 text-text"><ArrowRight size={14} className="mt-0.5 shrink-0 text-faint" />{l}</li>)}</ul>
              </Card>

              <Card>
                <CardHeader title={`Before / after · ${res.diff.length} field(s) changed`} subtitle="Only fields affected by the change are listed" />
                {res.diff.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No decision field changed.</p> : Object.entries(groups).map(([g, rows]) => (
                  <div key={g} className="border-t border-line-soft first:border-t-0">
                    <p className="px-5 pt-3 text-[11px] font-semibold uppercase tracking-wider text-faint">{g}</p>
                    <table className="w-full text-xs"><thead className="sr-only"><tr><th>Field</th><th>Before</th><th>After</th></tr></thead><tbody>
                      {rows.map((d) => (
                        <tr key={d.field} className="align-top">
                          <td className="w-[28%] px-5 py-1.5 font-mono text-[11px] text-muted">{d.field.split(".").slice(1).join(".") || d.field}</td>
                          <td className="w-[36%] py-1.5 pr-3 text-text"><span className="line-clamp-3">{show(d.before)}</span></td>
                          <td className="w-[36%] py-1.5 pr-5 text-amber"><span className="line-clamp-3">{show(d.after)}</span></td>
                        </tr>
                      ))}
                    </tbody></table>
                  </div>
                ))}
                <div className="border-t border-line-soft px-5 py-2.5 text-xs">
                  <button className="text-blue hover:underline" onClick={() => setShowSame((s) => !s)}>{showSame ? "Hide" : "Show"} {unchanged.length} unchanged field(s)</button>
                  {showSame && <ul className="num mt-2 columns-2 text-[11px] text-faint">{unchanged.map((k) => <li key={k}>{k}: {show(res.after.fields[k]).slice(0, 40)}</li>)}</ul>}
                </div>
              </Card>

              <Card>
                <CardHeader title={`${res.after.series.sensor_id} · ${FEATURE_LABEL[res.after.series.feature] ?? res.after.series.feature}`} subtitle="Blue: base scenario (observed simulated readings) · Amber dashed: hypothetical after the intervention" />
                <div className="h-[260px] px-3 py-3">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chart} margin={{ top: 8, right: 16, left: 4, bottom: 0 }}>
                      <CartesianGrid stroke="var(--line-soft)" vertical={false} />
                      <XAxis dataKey="i" tick={{ fill: "var(--faint)", fontSize: 11, fontFamily: "var(--font-mono)" }} stroke="var(--line)" tickLine={false} label={{ value: "window", position: "insideBottomRight", fill: "var(--faint)", fontSize: 10 }} />
                      <YAxis tick={{ fill: "var(--faint)", fontSize: 11, fontFamily: "var(--font-mono)" }} stroke="var(--line)" tickLine={false} width={56} domain={["auto", "auto"]} tickFormatter={(v) => fmtNum(v, 3)} />
                      <Tooltip contentStyle={{ background: "var(--raised)", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12 }} labelFormatter={(l) => `window ${l}`} formatter={(v) => fmtNum(Number(v), 4)} />
                      <Line dataKey="before" stroke="var(--blue)" dot={false} strokeWidth={1.5} isAnimationActive={false} name="base (observed)" />
                      <Line dataKey="after" stroke="var(--amber)" dot={false} strokeWidth={1.5} strokeDasharray="5 4" isAnimationActive={false} name="hypothetical" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <p className="px-5 pb-3 text-[11px] text-faint">Windows flagged by data-quality checks in the hypothetical run: {res.after.series.points.filter((p) => p.q !== "ok").length}. Flagged windows are excluded from detection.</p>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
