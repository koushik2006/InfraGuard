"use client";

import { MotionConfig } from "framer-motion";
import { ArrowDown, Clock, Info } from "lucide-react";
import { useState } from "react";
import { HoursChart, TotalBar, YearChart } from "@/components/impact/ImpactCharts";
import { OvCard, Reveal } from "@/components/overview/motion";
import { Badge, CardHeader, PageHeader, Segmented } from "@/components/ui";
import { ASSUMPTIONS as A, inr, lakh, perIncident, perYear } from "@/lib/impact";
import { useApp } from "@/lib/store";

type View = "incident" | "year";

function Tile({ label, value, sub, tone, delta }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "amber" | "blue"; delta?: string }) {
  return (
    <OvCard className="p-5" style={tone === "amber" ? { borderColor: "color-mix(in srgb, var(--amber) 45%, var(--line))" } : undefined}>
      <p className="text-[11px] font-medium uppercase tracking-wider text-faint">{label}</p>
      <p className={`mt-1 whitespace-nowrap text-2xl font-semibold tabular-nums ${tone === "amber" ? "text-amber" : tone === "blue" ? "text-blue" : "text-text"}`}>{value}</p>
      <div className="mt-1 flex items-center gap-2 text-xs text-muted">{delta && <span className="inline-flex items-center gap-0.5 rounded bg-amber-soft px-1.5 py-0.5 font-semibold text-amber"><ArrowDown size={11} />{delta}</span>}{sub}</div>
    </OvCard>
  );
}

function Compare({ rows, head }: { rows: [string, React.ReactNode, React.ReactNode][]; head: [string, string, string] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-[11px] uppercase tracking-wider text-faint">
          <tr><th className="px-5 py-2.5 text-left font-medium">{head[0]}</th><th className="px-3 py-2.5 text-left font-medium">{head[1]}</th><th className="px-5 py-2.5 text-left font-medium text-blue">{head[2]}</th></tr>
        </thead>
        <tbody>{rows.map(([a, b, c]) => (
          <tr key={a} className="border-t border-line-soft align-top transition-colors hover:bg-raised/50">
            <td className="px-5 py-2.5 font-medium text-text">{a}</td><td className="px-3 py-2.5 text-muted">{b}</td><td className="px-5 py-2.5 text-text">{c}</td>
          </tr>))}</tbody>
      </table>
    </div>
  );
}

export default function ImpactPage() {
  const { state } = useApp();
  const [view, setView] = useState<View>("incident");
  const inc = perIncident();
  const yr = perYear();
  const live = state?.incidents.at(-1);
  const liveMin = live ? Math.round((Date.parse(live.detected_time) - Date.parse(live.onset_time)) / 60000) : null;
  const h = (v: number) => `${Number.isInteger(v) ? v : v.toFixed(1)} h`;

  return (
    <MotionConfig reducedMotion="user">
      <div className="space-y-5">
        <Reveal>
          <PageHeader title="Business Impact" subtitle="What InfraGuard changes compared with the usual inspection process, in engineer time and in money."
            right={<Segmented<View> label="Impact view" value={view} onChange={setView} options={[{ value: "incident", label: "Per incident" }, { value: "year", label: `Per year · ${A.structures} structures` }]} />} />
          <div className="flex items-start gap-2 rounded-lg border border-violet/30 bg-violet-soft px-4 py-2.5 text-xs text-text" role="note">
            <Info size={14} className="mt-0.5 shrink-0 text-violet" aria-hidden />
            <p><b className="text-violet">Illustrative model.</b> Usual-process figures are assumptions to confirm with an operator, and a pilot would replace them with real data. Only the detection time is measured in this prototype (simulated clock).</p>
          </div>
        </Reveal>

        {view === "incident" ? (
          <>
            <Reveal delay={0.05}>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="kpis-incident">
                <Tile label="Engineer effort" value={<>{h(inc.usualHours)} <span className="text-faint">→</span> <span className="text-blue">{h(inc.withHours)}</span></>} delta={`${inc.hoursCutPct}%`} sub="per real incident" />
                <Tile label="Cost per real incident" value={<>{inr(inc.usualCost)} <span className="text-faint">→</span> <span className="text-blue">{inr(inc.withCost)}</span></>} sub="engineer time only" />
                <Tile tone="amber" label="Saved per incident" value={`≈ ${inr(inc.savedCost)}`} sub={`${h(inc.savedHours)} of engineer time`} />
                <Tile tone="blue" label="Time to flag (measured)" value={liveMin !== null ? `${liveMin} min` : "30–45 min"} sub={liveMin !== null ? `this run, ${live!.incident_id}` : "prototype metric (simulated clock)"} />
              </div>
            </Reveal>
            <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
              <Reveal delay={0.1}>
                <OvCard>
                  <CardHeader title="Engineer effort per real incident" subtitle="Hours, usual process vs InfraGuard" right={<Badge tone="violet">assumption-based</Badge>} />
                  <div className="px-4 py-4"><HoursChart inc={inc} /></div>
                </OvCard>
              </Reveal>
              <Reveal delay={0.15}>
                <OvCard>
                  <CardHeader title="A false alarm" subtitle="Where the saving is largest" />
                  <div className="space-y-4 p-5">
                    <div className="flex items-end justify-between gap-3">
                      <div><p className="text-[11px] uppercase tracking-wider text-faint">Usual process</p><p className="num text-2xl font-semibold text-text">≈ {inr(inc.falseAlarmUsual)}</p>
                        <p className="text-xs text-muted">{A.triageHours} h of triage plus a {inr(A.calloutCost)} callout</p></div>
                    </div>
                    <div className="rounded-lg border border-blue/30 bg-blue-soft p-3 text-sm text-text">
                      <p className="font-semibold text-blue">With InfraGuard</p>
                      <p className="mt-0.5 text-muted">A heavy-vehicle spike or a sensor fault is filtered by the persistence rule and the data-quality gate; about half never reach a callout.</p>
                    </div>
                    <p className="flex items-center gap-2 text-xs text-muted"><Clock size={13} className="text-blue" aria-hidden /> The same filtering runs in this demo: the truck spike at 08:15 is logged, not alerted.</p>
                  </div>
                </OvCard>
              </Reveal>
            </div>
            <Reveal delay={0.2}>
              <OvCard>
                <CardHeader title="Usual process vs InfraGuard, one incident" />
                <Compare head={["Step", "Usual (manual)", "With InfraGuard"]} rows={[
                  ["How an issue is noticed", "Next scheduled inspection, or a manual alert", "Flagged after 2–3 persisting analysis windows, about 30–45 minutes in the simulation (measured in the prototype)"],
                  ["Triage and investigation", `About ${A.triageHours} hours of engineer time per alert`, `About ${inc.withTriage.toFixed(1)} hours of review (${Math.round(A.triageAutomated * 100)}% automated)`],
                  ["Work-order report", `About ${A.reportHours} hours to draft`, `About ${inc.withReport.toFixed(1)} hours to review and edit (${Math.round(A.reportAutomated * 100)}% automated)`],
                  ["Engineer effort per real incident", `About ${inc.usualHours} hours, ≈ ${inr(inc.usualCost)}`, `About ${inc.withHours.toFixed(0)} hours, ≈ ${inr(inc.withCost)}`],
                  ["A false alarm", `${A.triageHours} hours plus a ${inr(A.calloutCost)} callout, ≈ ${inr(inc.falseAlarmUsual)}`, "Spike or sensor fault filtered; about half never reach a callout"],
                  ["Audit trail", "Rebuilt from emails and spreadsheets", "Generated as the work happens"],
                ]} />
              </OvCard>
            </Reveal>
          </>
        ) : (
          <>
            <Reveal delay={0.05}>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="kpis-year">
                <Tile label="Usual process, per year" value={lakh(yr.usual, 0)} sub="across the cost lines below" />
                <Tile tone="blue" label="With InfraGuard, per year" value={lakh(yr.with, 0)} delta={`${yr.savedPct}%`} sub="lower" />
                <Tile tone="amber" label="Saved per year" value={`≈ ${lakh(yr.saved, 0)}`} sub={`${yr.savedPct}% lower`} />
                <Tile label="Net after the platform cost" value={`≈ ${lakh(yr.net, 0)}`} sub={`${lakh(yr.platform, 0)} a year assumed`} />
              </div>
            </Reveal>
            <Reveal delay={0.1}>
              <OvCard>
                <CardHeader title="Total annual cost" subtitle={`${A.structures}-structure network, ₹ lakh`} right={<Badge tone="violet">assumption-based</Badge>} />
                <div className="px-4 py-3"><TotalBar year={yr} /></div>
              </OvCard>
            </Reveal>
            <div className="grid gap-5 xl:grid-cols-[1.3fr_1fr]">
              <Reveal delay={0.15}>
                <OvCard>
                  <CardHeader title="Where the saving comes from" subtitle="Annual cost by line, ₹ lakh" />
                  <div className="px-4 py-4"><YearChart year={yr} /></div>
                </OvCard>
              </Reveal>
              <Reveal delay={0.2}>
                <OvCard>
                  <CardHeader title="Cost lines" />
                  <table className="w-full text-sm">
                    <thead className="text-[11px] uppercase tracking-wider text-faint"><tr><th className="px-5 py-2 text-left font-medium">Line</th><th className="px-2 py-2 text-right font-medium">Usual</th><th className="px-2 py-2 text-right font-medium text-blue">With</th><th className="px-5 py-2 text-right font-medium text-amber">Saved</th></tr></thead>
                    <tbody>
                      {yr.lines.map((l) => (
                        <tr key={l.key} className="border-t border-line-soft"><td className="px-5 py-2 text-text">{l.label}</td><td className="num px-2 py-2 text-right text-muted">{l.usual.toFixed(1)}</td>
                          <td className="num px-2 py-2 text-right text-text">{l.with.toFixed(1)}</td><td className="num px-5 py-2 text-right text-amber">{(l.usual - l.with).toFixed(1)}</td></tr>
                      ))}
                      <tr className="border-t border-line font-semibold"><td className="px-5 py-2.5 text-text">Total (₹ L)</td><td className="num px-2 py-2.5 text-right text-text">{yr.usual.toFixed(0)}</td><td className="num px-2 py-2.5 text-right text-blue">{yr.with.toFixed(0)}</td><td className="num px-5 py-2.5 text-right text-amber">{yr.saved.toFixed(0)}</td></tr>
                    </tbody>
                  </table>
                </OvCard>
              </Reveal>
            </div>
          </>
        )}

        <Reveal delay={0.25}>
          <OvCard>
            <details>
              <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3.5 text-sm font-semibold">Assumptions behind these figures <span className="text-xs font-normal text-blue">show / hide</span></summary>
              <ul className="grid gap-x-8 gap-y-1.5 border-t border-line-soft px-5 py-4 text-xs text-muted sm:grid-cols-2">
                <li>{A.alertsPerMonth} alerts a month across the network, {A.triageHours} h manual triage each, {Math.round(A.triageAutomated * 100)}% automated</li>
                <li>Engineer cost {inr(A.engineerRate)} per hour</li>
                <li>{A.reportsPerMonth} work-order reports a month, {A.reportHours} h each, {Math.round(A.reportAutomated * 100)}% automated</li>
                <li>{A.needlessCalloutsPerMonth} needless callouts a month at {inr(A.calloutCost)}; {Math.round(A.calloutsAvoided * 100)}% avoided</li>
                <li>{A.inspectionsPerYear} calendar inspections a year at {inr(A.inspectionCost)}; {Math.round(A.inspectionsSaved * 100)}% saved</li>
                <li>{A.closuresPerYear} unplanned closures a year of {A.closureHours} h at {inr(A.closureCostPerHour)} per hour; {Math.round(A.closuresAvoided * 100)}% avoided</li>
                <li>Audit preparation {A.auditHours} h a year; {Math.round(A.auditSaved * 100)}% saved</li>
                <li>Platform cost {lakh(A.platformPerYearLakh, 0)} a year</li>
              </ul>
            </details>
          </OvCard>
        </Reveal>
      </div>
    </MotionConfig>
  );
}
