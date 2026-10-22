"use client";

import { ArrowUpRight, BookOpen, Database, Gauge, Ruler, ScanSearch, Unplug } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { TimeSeriesChart } from "@/components/charts/TimeSeriesChart";
import { Badge, Button, Card, CardHeader, DataQualityChip, PageHeader, Segmented, SimulatedTag, Skeleton, StatusChip, Term } from "@/components/ui";
import { useApi } from "@/lib/api";
import { ASSET_TYPE_LABEL, cx, FEATURE_LABEL, fmtNum, fmtSim, fmtZ } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { AssetDetail, Series } from "@/lib/types";

export default function AssetPage() {
  const { id } = useParams<{ id: string }>();
  const { version, state } = useApp();
  const { data } = useApi<AssetDetail>(`/api/assets/${id}`, version);
  const [sensor, setSensor] = useState<string | null>(null);
  const [feature, setFeature] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("sensor")) setSensor(q.get("sensor"));
    if (q.get("feature")) setFeature(q.get("feature"));
  }, [id]);

  const cfg = data?.config;
  const sensorCfg = cfg?.sensors.find((s) => s.sensor_id === sensor) ?? cfg?.sensors.find((s) => s.primary);
  const features = useMemo(() => sensorCfg ? Array.from(new Set([...sensorCfg.detection_features, ...sensorCfg.features])) : [], [sensorCfg]);
  const feat = feature && features.includes(feature) ? feature : features[0];
  const { data: series } = useApi<Series>(sensorCfg && feat ? `/api/assets/${id}/series?sensor_id=${sensorCfg.sensor_id}&feature=${feat}` : null, version);

  if (!data || !cfg) return <div className="space-y-4"><Skeleton className="h-10 w-96" /><Skeleton className="h-96" /></div>;
  const s = data.summary;
  const b = data.baseline;
  const inc = state?.incidents.find((i) => i.asset_id === id && !i.closed);
  const fb = series?.baseline;
  const latest = series?.points.at(-1);
  const qCounts = (series?.points ?? []).filter((p) => p.phase !== "reference" && p.q !== "ok").reduce<Record<string, number>>((m, p) => ({ ...m, [p.q]: (m[p.q] ?? 0) + 1 }), {});
  const exceedN = (series?.points ?? []).filter((p) => p.x).length;

  return (
    <div>
      <PageHeader
        eyebrow={<><span className="num">{cfg.asset_id}</span> · {ASSET_TYPE_LABEL[cfg.type]} · {cfg.location_text} <SimulatedTag /></>}
        title={cfg.name}
        subtitle={cfg.description}
        right={<>
          <StatusChip status={s.status} />
          {s.data_quality_issues.length > 0 && <DataQualityChip label={s.data_quality_issues.join(" · ")} />}
          {inc && <Link href={`/incidents/${inc.incident_id}`}><Button variant="primary"><ScanSearch size={15} /> Open investigation {inc.incident_id}</Button></Link>}
        </>}
      />

      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader
              title={<>{FEATURE_LABEL[feat ?? ""] ?? feat} · <span className="font-mono">{sensorCfg?.sensor_id}</span></>}
              subtitle={`${sensorCfg?.location} · ${cfg.detection.window_minutes}-min windows · historical reference + live replay`}
              right={series && !series.is_detection_feature ? <Badge tone="slate">Context feature — not used for detection</Badge> : undefined}
            />
            <div className="flex flex-wrap items-center gap-3 border-b border-line-soft px-5 py-3">
              <Segmented label="Sensor" value={sensorCfg?.sensor_id ?? ""} onChange={(v) => { setSensor(v); setFeature(null); }}
                options={cfg.sensors.map((x) => ({ value: x.sensor_id, label: <span className="font-mono">{x.sensor_id}</span> }))} />
              {features.length > 1 && (
                <Segmented label="Feature" value={feat} onChange={(v) => setFeature(v)}
                  options={features.map((f) => ({ value: f, label: FEATURE_LABEL[f] ?? f }))} />
              )}
            </div>
            <div className="px-3 pb-4 pt-3" data-coach="chart">
              {series ? <TimeSeriesChart series={series} height={340} /> : <Skeleton className="h-[340px]" />}
            </div>
            {series && (
              <div className="grid grid-cols-2 gap-4 border-t border-line-soft px-5 py-4 text-xs md:grid-cols-4">
                <div><p className="text-faint">Latest value</p><p className="num mt-1 text-base font-semibold">{fmtNum(latest?.v, 4)} <span className="text-xs text-muted">{series.unit}</span></p></div>
                <div><p className="text-faint"><Term t="robust z-score">Latest robust z</Term></p><p className={cx("num mt-1 text-base font-semibold", latest?.x ? "text-amber" : "")}>{fmtZ(latest?.z)}</p></div>
                <div><p className="text-faint"><Term t="persistence">Exceeding windows</Term></p><p className="num mt-1 text-base font-semibold">{exceedN}</p></div>
                <div><p className="text-faint"><Term t="data-quality gate">Quality-flagged windows</Term></p><p className={cx("num mt-1 text-base font-semibold", Object.keys(qCounts).length ? "text-violet" : "")}>
                  {Object.keys(qCounts).length ? Object.entries(qCounts).map(([k, v]) => `${v} ${k}`).join(", ") : "0"}</p></div>
              </div>
            )}
          </Card>

          {series && series.transients.length > 0 && (
            <Card>
              <CardHeader title="Transient exceedances — not alerted" subtitle="Single windows beyond the threshold that did not meet the persistence rule" icon={<Gauge size={15} />} />
              <ul className="divide-y divide-line-soft">
                {series.transients.map((t) => (
                  <li key={t.window_index} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-xs">
                    <span className="num text-text">{fmtSim(t.t_start)} · {FEATURE_LABEL[t.feature]} z = {fmtZ(t.z)}</span>
                    <span className="text-muted">{t.reason}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <CardHeader title="Statistical anomaly vs. validated engineering limit" subtitle="These are different things and are never mixed" icon={<Ruler size={15} />} />
            <div className="grid gap-4 p-5 md:grid-cols-2">
              <div className="rounded-lg border border-amber/30 bg-amber-soft/40 p-4">
                <p className="text-xs font-semibold text-amber">Statistical anomaly indicator</p>
                <p className="mt-1 text-xs text-muted">Deviation from this asset&apos;s own learned baseline. Says “this changed”, not “this is unsafe”.</p>
                <ul className="num mt-3 space-y-1 text-xs text-text">
                  <li>Method: robust z = (x − median) / (1.4826 · MAD)</li>
                  <li>Threshold: |z| ≥ {cfg.detection.z_threshold}</li>
                  <li>Persistence: ≥ {cfg.detection.min_exceedances} of {cfg.detection.persistence_windows} windows</li>
                  <li>Window: {cfg.detection.window_minutes} min · gate: missing / stale / frozen / implausible</li>
                  {Boolean(cfg.detection.temperature_compensation) && <li>Temperature compensation via {String(cfg.detection.temperature_sensor_id)}</li>}
                </ul>
              </div>
              <div className="rounded-lg border border-line bg-raised p-4">
                <p className="text-xs font-semibold text-text">Engineering limit (owner-supplied)</p>
                {cfg.thresholds.length === 0 ? (
                  <p className="mt-2 text-sm font-semibold text-muted">No engineering safety threshold configured</p>
                ) : cfg.thresholds.map((t) => (
                  <div key={t.label} className="mt-2 text-xs">
                    <Badge tone="red">{t.label}</Badge>
                    <p className="num mt-2 text-text">{t.sensor_id}.{t.feature} · |value| &gt; {t.limit}</p>
                    <p className="mt-1 text-muted">Source: {t.source}</p>
                  </div>
                ))}
                <p className="mt-3 text-[11px] text-faint">“Escalation required” appears only when an owner-supplied criterion is exceeded.</p>
              </div>
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Baseline provenance" subtitle="Simulated reference period" icon={<Database size={15} />} />
            <dl className="space-y-2.5 px-5 py-4 text-xs">
              <Row k="Version" v={<span className="num">{b.version}</span>} />
              <Row k={<Term t="provisional">Status</Term>} v={<Badge tone={b.status === "validated" ? "blue" : b.status === "provisional" ? "amber" : "slate"}>{b.status.replace("_", " ")}</Badge>} />
              <Row k="Reference reviewed" v={b.reference_reviewed ? "Yes (simulated record)" : "No"} />
              <Row k="Reference period" v={<span className="num">{fmtSim(b.reference_period.start)} → {fmtSim(b.reference_period.end)}</span>} />
              <Row k="Reference windows" v={<span className="num">{b.computed_from_windows}</span>} />
              {fb && <Row k={`${FEATURE_LABEL[fb.feature] ?? fb.feature} median`} v={<span className="num">{fmtNum(fb.median, 4)} {fb.unit}</span>} />}
              {fb && <Row k={<Term t="MAD">MAD → scale</Term>} v={<span className="num">{fmtNum(fb.mad, 4)} → {fmtNum(fb.scale, 4)}</span>} />}
              {fb?.zero_mad_fallback && <Row k="Zero-MAD fallback" v={<span className="text-violet">{fb.fallback_detail}</span>} />}
            </dl>
            <p className="border-t border-line-soft px-5 py-3 text-[11px] leading-relaxed text-muted">{b.reference_period.note}</p>
            {b.notes.length > 0 && <ul className="space-y-1 border-t border-line-soft px-5 py-3 text-[11px] text-muted">{b.notes.map((n) => <li key={n} className="num">{n}</li>)}</ul>}
          </Card>
          <Card>
            <CardHeader title="Sensors" subtitle="Data-quality status on the latest window" icon={<Unplug size={15} />} />
            <ul className="divide-y divide-line-soft">
              {s.sensors.map((x) => (
                <li key={x.sensor_id}>
                  <button onClick={() => { setSensor(x.sensor_id); setFeature(null); }} className={cx("flex w-full items-center justify-between gap-2 px-5 py-2.5 text-left text-xs hover:bg-raised", sensorCfg?.sensor_id === x.sensor_id && "bg-raised")}>
                    <span className="min-w-0"><span className="font-mono text-text">{x.sensor_id}</span><span className="block truncate text-muted">{x.location}</span></span>
                    {x.health === "ok" ? <Badge tone="blue">OK</Badge> : <Badge tone="violet" icon={<Unplug size={10} />}>{x.latest}</Badge>}
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Records" subtitle="Simulated maintenance & inspection fixtures" icon={<BookOpen size={15} />} />
            <ul className="divide-y divide-line-soft">
              {[...(data.records.maintenance ?? []), ...(data.records.inspections ?? []), ...(data.records.logs ?? [])].map((r) => (
                <li key={r.id} className="px-5 py-2.5 text-xs">
                  <div className="flex items-center justify-between gap-2"><span className="font-medium text-text">{r.title}</span><SimulatedTag /></div>
                  <p className="num mt-0.5 text-faint">{r.id} · {r.date.slice(0, 10)}</p>
                  <p className="mt-1 text-muted">{r.text}</p>
                </li>
              ))}
            </ul>
          </Card>
          {inc && (
            <Link href={`/incidents/${inc.incident_id}`} className="flex items-center justify-between rounded-lg border border-amber/40 bg-amber-soft p-4 text-xs text-amber hover:brightness-110">
              <span><span className="font-semibold">{inc.incident_id}</span> · {inc.status_text}</span><ArrowUpRight size={14} />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: React.ReactNode; v: React.ReactNode }) {
  return <div className="flex items-start justify-between gap-3"><dt className="text-faint">{k}</dt><dd className="text-right text-text">{v}</dd></div>;
}
