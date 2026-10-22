"use client";

import { Check, CircleHelp, X } from "lucide-react";
import { Drawer } from "@/components/ui";
import { cx, FEATURE_LABEL, fmtNum, fmtSim, fmtZ } from "@/lib/format";
import type { IncidentDetail } from "@/lib/types";

export function WhyFlaggedDrawer({ open, onClose, d }: { open: boolean; onClose: () => void; d: IncidentDetail }) {
  const e = d.event;
  const top = e.deviations[0];
  const dir = top.z < 0 ? "lower" : "higher";
  const p = e.detection_params as Record<string, unknown>;
  const checks = [
    { ok: e.data_quality.passed, title: "Data-quality gate passed",
      body: `All ${e.data_quality.checked_windows} windows used were checked for missing, stale, frozen and implausible readings. Flagged windows can never count toward an alert.` },
    { ok: Math.abs(top.z) >= e.z_threshold, title: `Deviation beyond |z| ≥ ${e.z_threshold}`,
      body: `${FEATURE_LABEL[top.feature] ?? top.feature} was ${fmtNum(top.value, 4)} ${top.unit} against a typical ${fmtNum(top.median, 4)} ${top.unit}. ` +
        `That is ${Math.abs(top.z).toFixed(1)} robust spread units ${dir} than this asset's own reference behaviour.` },
    { ok: e.persistence_count >= e.persistence_required, title: `Persistent: ${e.persistence_count} of ${e.persistence_window} windows`,
      body: `The rule needs at least ${e.persistence_required} exceeding windows out of the last ${e.persistence_window} (${e.window_minutes}-minute windows), so a single spike — like a heavy vehicle — does not alert.` },
    { ok: e.corroborating_sensors.length > 0, title: e.corroborating_sensors.length ? `Corroborated by ${e.corroborating_sensors.join(", ")}` : "Not corroborated",
      body: e.corroborating_sensors.length ? "Independent sensors on the same asset met the same persistence rule over the same windows." : "No other sensor shows the same deviation; a sensor fault remains plausible." },
  ];
  return (
    <Drawer open={open} onClose={onClose} title="Why was this flagged?" width={560}>
      <p className="text-sm leading-relaxed text-text">
        Starting <span className="num">{fmtSim(e.onset_time)}</span>, sensor <span className="font-mono">{e.primary_sensor_id}</span> on {d.asset.name} reported a{" "}
        {FEATURE_LABEL[top.feature]?.toLowerCase() ?? top.feature} that stayed clearly {dir} than its usual range. InfraGuard compares every reading only
        with this asset&apos;s own learned behaviour — there is no universal threshold.
      </p>
      <ol className="mt-5 space-y-3">
        {checks.map((c) => (
          <li key={c.title} className="flex gap-3 rounded-lg border border-line bg-raised p-3">
            <span className={cx("mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full", c.ok ? "bg-blue text-white" : "bg-slate-soft text-muted")}>
              {c.ok ? <Check size={12} /> : <X size={12} />}
            </span>
            <div><p className="text-sm font-semibold text-text">{c.title}</p><p className="mt-0.5 text-xs leading-relaxed text-muted">{c.body}</p></div>
          </li>
        ))}
      </ol>
      <h3 className="mt-6 text-xs font-semibold uppercase tracking-wider text-faint">Method, threshold and window</h3>
      <table className="num mt-2 w-full text-xs">
        <tbody className="divide-y divide-line-soft">
          {[
            ["Method", e.method],
            ["Score", "z = (x − median) / (1.4826 × MAD)"],
            ["Threshold", `|z| ≥ ${e.z_threshold}`],
            ["Persistence", `≥ ${e.persistence_required} of ${e.persistence_window} windows`],
            ["Window length", `${e.window_minutes} min`],
            ["Frozen-sensor rule", `≥ ${String(p.frozen_windows)} identical consecutive windows`],
            ["Baseline", e.baseline_version],
            ["Change-point estimate", e.change_point_time ? `${fmtSim(e.change_point_time)} (window ${e.change_point_window})` : "—"],
            ["Scenario seed", String(e.scenario_seed)],
            ["Input hash", e.input_hash],
          ].map(([k, v]) => <tr key={k}><td className="py-1.5 pr-3 text-faint">{k}</td><td className="py-1.5 text-text">{v}</td></tr>)}
        </tbody>
      </table>
      <h3 className="mt-6 text-xs font-semibold uppercase tracking-wider text-faint">All deviating features at detection</h3>
      <table className="num mt-2 w-full text-xs">
        <thead className="text-faint"><tr><th className="py-1 text-left font-normal">Feature</th><th className="text-right font-normal">Value</th><th className="text-right font-normal">Median</th><th className="text-right font-normal">z</th></tr></thead>
        <tbody>{e.deviations.map((x) => (
          <tr key={x.feature} className="border-t border-line-soft"><td className="py-1.5">{FEATURE_LABEL[x.feature] ?? x.feature}</td><td className="text-right">{fmtNum(x.value, 4)} {x.unit}</td>
            <td className="text-right">{fmtNum(x.median, 4)}</td><td className={cx("text-right", Math.abs(x.z) >= e.z_threshold ? "text-amber" : "")}>{fmtZ(x.z)}</td></tr>
        ))}</tbody>
      </table>
      <div className="mt-6 flex gap-2 rounded-lg border border-line bg-raised p-3 text-xs text-muted">
        <CircleHelp size={15} className="shrink-0 text-faint" />
        <p>The z-score is an anomaly indicator, not a probability of failure. This flag means “a qualified engineer should look”; it is not a safety assessment, and the system never orders closures or evacuations.</p>
      </div>
    </Drawer>
  );
}
