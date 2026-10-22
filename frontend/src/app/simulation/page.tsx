"use client";

import { Database, FastForward, FileCode2, Pause, Play, RotateCcw, SkipForward, SlidersHorizontal, Unplug } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button, Card, CardHeader, PageHeader, Segmented, SimulatedTag } from "@/components/ui";
import { post, useApi } from "@/lib/api";
import { cx, fmtSim } from "@/lib/format";
import { useApp } from "@/lib/store";

interface Scenario {
  run: { seed: number; variants: Record<string, string>; environment: string; interventions: { type: string; sensor_id: string; from_time: string; label: string }[] };
  run_id: string; variants: Record<string, string[]>; labelled_events: Record<string, Record<string, Record<string, unknown>[]>>;
  data_source: string; environment_presets: Record<string, unknown>; generator: Record<string, string>;
}
interface Rules { detection: Record<string, Record<string, unknown>>; versions: Record<string, string> }

const SENSORS: Record<string, string[]> = { "BRG-017": ["ACC-M1", "ACC-Q1", "ACC-P2", "TMP-B1"], "BLD-204": ["TLT-N1", "TLT-E1", "TMP-A1"], "RW-031": ["IN-01", "IN-02", "CM-01"] };

export default function SimulationPage() {
  const { state, sim, version, user, pushToast, refresh } = useApp();
  const { data: sc, reload } = useApi<Scenario>("/api/scenario", version);
  const { data: rules } = useApi<Rules>("/api/rules");
  const [variants, setVariants] = useState<Record<string, string>>({});
  const [env, setEnv] = useState("nominal");
  const [seed, setSeed] = useState(4242);
  const [fAsset, setFAsset] = useState("RW-031");
  const [fSensor, setFSensor] = useState("IN-02");
  const [fKind, setFKind] = useState<"frozen_sensor" | "stale_sensor">("frozen_sensor");
  useEffect(() => { if (sc) { setVariants(sc.run.variants); setEnv(sc.run.environment); setSeed(sc.run.seed); } }, [sc?.run_id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setFSensor(SENSORS[fAsset][0]), [fAsset]);
  const s = state?.sim;

  const inject = async () => {
    try {
      await post("/api/sim/inject-fault", { sensor_id: fSensor, kind: fKind, actor: user.name, role: user.role });
      pushToast({ tone: "violet", title: `Simulated ${fKind.replace("_", " ")} on ${fSensor}`, body: "Applies to windows from the current replay time onward. Already-ingested history is unchanged." });
    } catch (e) { pushToast({ tone: "red", title: "Injection failed", body: (e as Error).message }); }
    await refresh(); reload();
  };
  const sel = "h-9 rounded-md border border-line bg-raised px-2 text-sm text-text";

  return (
    <div>
      <PageHeader eyebrow={<><SlidersHorizontal size={13} /> Simulation Controls <SimulatedTag /></>} title="Scenario, replay and fault injection"
        subtitle="Everything here drives real application state: the replay ingests windows one by one and the Sentinel processes each. Same seed + configuration + interventions ⇒ same results." />
      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="Replay" subtitle={`Run ${state?.run.run_id ?? "…"} · one tick = one 15-minute window`} />
          <div className="space-y-4 px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" onClick={sim.toggle}>{s?.running ? <><Pause size={15} /> Pause</> : <><Play size={15} /> Start</>}</Button>
              <Button onClick={() => sim.step(1)}><SkipForward size={15} /> Step 1 window</Button>
              <Button onClick={() => sim.step(4)}>+1 hour</Button>
              <Button onClick={sim.toEvent}><FastForward size={15} /> Run to next event</Button>
              <Button variant="ghost" onClick={() => sim.reset()}><RotateCcw size={15} /> Reset</Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-faint">Speed</span>
              <Segmented label="Speed" value={s?.speed ?? 4} onChange={(v) => sim.speed(v)} options={(s?.speeds ?? [1, 2, 4, 8, 16]).map((v) => ({ value: v, label: `${v}×` }))} />
              <span className="text-xs text-muted">{s?.speed ?? 4} windows / second</span>
            </div>
            <div>
              <div className="num flex justify-between text-xs text-muted"><span>{fmtSim(s?.start)}</span><span className="text-text">{fmtSim(s?.cursor)} UTC</span><span>{fmtSim(s?.end)}</span></div>
              <div className="mt-1.5 h-2 overflow-hidden rounded bg-raised"><div className="h-full bg-blue" style={{ width: `${(s?.progress ?? 0) * 100}%` }} /></div>
              <p className="mt-1.5 text-[11px] text-faint">Days 1–3: reference period (baseline). Days 4–6: monitoring replay. {s?.finished ? "Scenario finished — reset to replay again." : ""}</p>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Scenario selection" subtitle="Normal vs anomaly per asset; bounded environment presets only" />
          <div className="space-y-3 px-5 py-4 text-sm">
            {sc && Object.entries(sc.variants).map(([a, vs]) => (
              <div key={a} className="flex items-center justify-between gap-3">
                <span className="font-mono text-xs text-muted">{a}</span>
                <Segmented label={`${a} variant`} value={variants[a] ?? vs[0]} onChange={(v) => setVariants({ ...variants, [a]: v })} options={vs.map((v) => ({ value: v, label: v.replace("_", " ") }))} />
              </div>
            ))}
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-muted">Environment</span>
              <Segmented label="Environment" value={env} onChange={setEnv} options={[{ value: "nominal", label: "nominal" }, { value: "heatwave", label: "heatwave +8 °C" }, { value: "cold_snap", label: "cold snap −8 °C" }]} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-muted">Seed</span>
              <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} className={cx(sel, "num w-32")} aria-label="Seed" />
            </div>
            <Button variant="primary" className="w-full" onClick={() => sim.reset({ seed, variants, environment: env })}>Apply & reset replay</Button>
          </div>
        </Card>

        <Card>
          <CardHeader title="Inject sensor fault (live)" subtitle="Shows that data-quality issues are separated from structural anomalies" icon={<Unplug size={15} />} />
          <div className="space-y-3 px-5 py-4">
            <div className="grid grid-cols-3 gap-2">
              <label className="text-xs text-faint">Asset<select className={cx(sel, "mt-1 w-full")} value={fAsset} onChange={(e) => setFAsset(e.target.value)}>{Object.keys(SENSORS).map((a) => <option key={a}>{a}</option>)}</select></label>
              <label className="text-xs text-faint">Sensor<select className={cx(sel, "mt-1 w-full")} value={fSensor} onChange={(e) => setFSensor(e.target.value)}>{SENSORS[fAsset].map((x) => <option key={x}>{x}</option>)}</select></label>
              <label className="text-xs text-faint">Fault<select className={cx(sel, "mt-1 w-full")} value={fKind} onChange={(e) => setFKind(e.target.value as "frozen_sensor" | "stale_sensor")}><option value="frozen_sensor">Frozen</option><option value="stale_sensor">Stale (stops)</option></select></label>
            </div>
            <Button onClick={inject}><Unplug size={14} /> Inject from current replay time</Button>
            <p className="text-xs text-muted">A frozen logger repeats its last record; the frozen-sensor rule flags it after {String(rules?.detection[fAsset]?.frozen_windows ?? 3)} identical windows. Flagged windows can never trigger an anomaly.</p>
            {sc && sc.run.interventions.length > 0 && (
              <ul className="space-y-1 border-t border-line-soft pt-3 text-xs">{sc.run.interventions.map((iv, i) => <li key={i} className="text-violet">• {iv.label}</li>)}</ul>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Scenario source" subtitle={sc?.data_source} icon={<FileCode2 size={15} />} />
          <div className="space-y-3 px-5 py-4 text-xs">
            {sc && Object.entries(sc.generator).map(([k, v]) => <p key={k}><span className="font-semibold capitalize text-text">{k.replace("_", " ")}:</span> <span className="text-muted">{v}</span></p>)}
            <p className="pt-2 font-semibold text-text">Labelled simulated events (ground truth for metrics only)</p>
            {sc && Object.entries(sc.labelled_events).map(([a, vs]) => (
              <p key={a} className="num text-muted">{a}: {Object.entries(vs).map(([v, evs]) => `${v} → ${evs.length ? evs.map((e) => `${e.kind}@${e.onset_window ?? e.window}`).join(", ") : "none"}`).join(" · ")}</p>
            ))}
          </div>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader title="Per-asset detection configuration" subtitle="No universal threshold — each asset has its own" icon={<Database size={15} />} />
          <div className="overflow-x-auto">
            <table className="num w-full min-w-[720px] text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-faint"><tr className="border-b border-line">
                {["Asset", "Window", "|z| threshold", "Persistence", "Min ref. windows", "Temp. comp.", "Frozen rule", "Stale rule", "Baseline", "Status"].map((h) => <th key={h} className="px-4 py-2 text-left font-medium">{h}</th>)}
              </tr></thead>
              <tbody>
                {rules && state && Object.entries(rules.detection).map(([a, p]) => {
                  const b = state.assets.find((x) => x.asset_id === a)?.baseline;
                  return (
                    <tr key={a} className="border-b border-line-soft">
                      <td className="px-4 py-2 text-text">{a}</td><td className="px-4">{String(p.window_minutes)} min</td><td className="px-4">{String(p.z_threshold)}</td>
                      <td className="px-4">{String(p.min_exceedances)} of {String(p.persistence_windows)}</td><td className="px-4">{String(p.min_reference_windows)}</td>
                      <td className="px-4">{p.temperature_compensation ? `yes (${p.temperature_sensor_id})` : "no"}</td><td className="px-4">≥{String(p.frozen_windows)} identical</td><td className="px-4">≥{String(p.stale_after_windows)} missing</td>
                      <td className="px-4 text-muted">{b?.version}</td><td className="px-4"><Badge tone={b?.status === "validated" ? "blue" : "amber"}>{b?.status}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rules && <p className="num border-t border-line-soft px-5 py-3 text-[11px] text-faint">{Object.entries(rules.versions).map(([k, v]) => `${k}: ${v}`).join(" · ")}</p>}
        </Card>
      </div>
    </div>
  );
}
