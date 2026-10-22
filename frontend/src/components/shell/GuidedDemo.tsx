"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Sparkles, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { cx } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { AppState } from "@/lib/types";
import { latestIncident } from "./nav";

interface Step {
  act: string;
  title: string;
  body: string;
  route: (s: AppState | null) => string;
  highlight?: string;
  action?: { label: string; run: (ctx: ReturnType<typeof useApp>) => Promise<void> | void };
}

const inc = (s: AppState | null) => latestIncident(s);

export const DEMO_STEPS: Step[] = [
  { act: "Opening", title: "Three assets, three different baselines",
    body: "A bridge, a building and a retaining wall — each judged only against its OWN learned baseline, with its own window, threshold and persistence rule. All data is simulated.",
    route: () => "/", highlight: "assets",
    action: { label: "Reset replay to the scenario start", run: (c) => c.sim.reset() } },
  { act: "Act 1", title: "Normal replay — a heavy truck does not alert",
    body: "Play the replay. At 08:15 a heavy vehicle makes peak acceleration jump (z ≈ +7) for ONE window. The persistence rule needs 3 of 3 windows, so the Sentinel logs it as a transient and raises no alert.",
    route: () => "/assets/BRG-017", highlight: "chart",
    action: { label: "Play replay", run: (c) => c.sim.play() } },
  { act: "Act 2", title: "Sustained deviation detected",
    body: "From 16:00 the dominant frequency drops ~6 % and stays down. After 3 exceeding windows that pass the data-quality gate, the Sentinel emits an anomaly event. The amber band marks the anomaly interval.",
    route: () => "/assets/BRG-017", highlight: "chart",
    action: { label: "Run to the next anomaly event", run: async (c) => { await c.sim.pause(); await c.sim.toEvent(); } } },
  { act: "Act 3", title: "Investigator weighs competing hypotheses",
    body: "The agent pipeline ran: the Investigator retrieved maintenance, inspection and environmental records, ranked three hypotheses (each labelled as a hypothesis with cited evidence) and listed what evidence is missing. Open “Why was this flagged?”.",
    route: (s) => (inc(s) ? `/incidents/${inc(s)}` : "/incidents"), highlight: "pipeline" },
  { act: "Act 4", title: "Priority rationale and human approval",
    body: "The Prioritiser's documented rules produce a demonstration triage score and a recommended inspection time-frame. The Planner only PROPOSES a work order — approve it yourself.",
    route: (s) => (inc(s) ? `/incidents/${inc(s)}/plan` : "/incidents"), highlight: "approve" },
  { act: "Act 5", title: "No data, no conclusion",
    body: "Load the ‘insufficient’ follow-up set (a logger outage). The Verifier reports “Cannot assess” and keeps the incident open — it never concludes the structure is fine.",
    route: (s) => (inc(s) ? `/incidents/${inc(s)}/verify` : "/incidents"), highlight: "follow-up" },
  { act: "What-if", title: "Inject a frozen sensor and compare",
    body: "Freeze the midspan accelerometer from noon. The real pipeline re-runs in a sandbox: ACC-M1 fails the quality gate, ACC-Q1 triggers instead, corroboration drops. Before/after shows only what actually changed.",
    route: () => "/whatif", highlight: "whatif-run" },
  { act: "Replay", title: "Read-only decision replay",
    body: "Replay the incident from its recorded seed, inputs, baseline version and rules. The diff should be empty and the status REPRODUCED — with no new approvals, work orders or audit events.",
    route: (s) => (inc(s) ? `/incidents/${inc(s)}/replay` : "/incidents"), highlight: "replay-run" },
  { act: "Closing", title: "Follow-up, verifier outcome, audit trail",
    body: "Load the ‘persists’ follow-up set: the Verifier compares post readings with the baseline and pre-intervention windows. Every transition — agent or human — is in the timestamped audit trail.",
    route: (s) => (inc(s) ? `/incidents/${inc(s)}/verify` : "/incidents"), highlight: "audit" },
];

export function GuidedDemo() {
  const app = useApp();
  const { demo, state } = app;
  const router = useRouter();
  const path = usePathname();
  const step = DEMO_STEPS[demo.step];

  useEffect(() => {
    if (!demo.active || !step) return;
    const target = step.route(state);
    if (target !== path) router.push(target);
    // only navigate when the step changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo.active, demo.step]);

  useEffect(() => {
    if (!demo.active || !step?.highlight) return;
    let el: Element | null = null;
    const apply = () => {
      el?.classList.remove("coach-highlight");
      el = document.querySelector(`[data-coach="${step.highlight}"]`);
      el?.classList.add("coach-highlight");
    };
    const t = setInterval(apply, 400);
    apply();
    return () => { clearInterval(t); el?.classList.remove("coach-highlight"); };
  }, [demo.active, demo.step, step, path]);

  return (
    <AnimatePresence>
      {demo.active && step && (
        <motion.aside initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }} transition={{ duration: 0.2 }}
          role="dialog" aria-label="Guided demo coach" className="fixed bottom-4 right-4 z-50 w-[380px] rounded-xl border border-amber/40 bg-surface p-4 shadow-2xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber"><Sparkles size={12} /> Guided demo · {step.act}</span>
            <button onClick={demo.stop} aria-label="Exit guided demo" className="text-faint hover:text-text"><X size={15} /></button>
          </div>
          <h3 className="text-sm font-semibold text-text">{step.title}</h3>
          <p className="mt-1.5 text-xs leading-relaxed text-muted">{step.body}</p>
          {step.action && (
            <button onClick={() => step.action!.run(app)} className="mt-3 h-8 w-full rounded-md border border-amber/40 bg-amber-soft text-xs font-semibold text-amber hover:bg-amber/20">
              {step.action.label}
            </button>
          )}
          <div className="mt-3 flex items-center justify-between">
            <div className="flex gap-1" aria-hidden>
              {DEMO_STEPS.map((_, i) => <span key={i} className={cx("h-1.5 w-4 rounded-full", i === demo.step ? "bg-amber" : i < demo.step ? "bg-amber/40" : "bg-line")} />)}
            </div>
            <div className="flex gap-1.5">
              <button disabled={demo.step === 0} onClick={() => demo.go(demo.step - 1)} className="flex h-7 items-center gap-1 rounded-md border border-line px-2 text-xs text-muted hover:text-text disabled:opacity-40"><ArrowLeft size={12} /> Back</button>
              {demo.step < DEMO_STEPS.length - 1
                ? <button onClick={() => demo.go(demo.step + 1)} className="flex h-7 items-center gap-1 rounded-md bg-blue px-2.5 text-xs font-semibold text-white">Next <ArrowRight size={12} /></button>
                : <button onClick={demo.stop} className="h-7 rounded-md bg-blue px-2.5 text-xs font-semibold text-white">Finish</button>}
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
