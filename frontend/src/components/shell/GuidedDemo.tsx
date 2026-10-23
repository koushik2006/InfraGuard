"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Sparkles, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { cx } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { AppState } from "@/lib/types";
import { latestIncident, latestWorkOrder } from "./nav";

interface Step {
  title: string;
  body: string;
  route: (s: AppState | null) => string;
  highlight?: string;
  action?: { label: string; run: (ctx: ReturnType<typeof useApp>) => Promise<void> | void };
}

/** One walk through the single workflow: Detect → Evidence → Assessment → Preventive action, then tracked and verified in Work Orders. */
export const DEMO_STEPS: Step[] = [
  { title: "Bridge Alpha, simulated",
    body: "One monitored bridge with its own learned baseline. All data is simulated; InfraGuard supports decisions and never certifies safety.",
    route: () => "/", highlight: "attention",
    action: { label: "Reset replay to the start", run: (c) => c.sim.reset() } },
  { title: "1 · Detect",
    body: "At 08:15 a heavy truck spikes peak acceleration for one window — logged as a transient, no alert. From 16:00 the frequency drops and stays down: a persistent anomaly. Run to it and click a marker.",
    route: () => "/assets/BRG-017", highlight: "twin",
    action: { label: "Run to the next anomaly event", run: async (c) => { await c.sim.pause(); await c.sim.toEvent(); } } },
  { title: "2 · Step through the investigation",
    body: "Four stages, one at a time: Detection, Evidence, Assessment, Preventive action. Click “Next Step”: the Investigator gathers records and weighs cited hypotheses for each finding.",
    route: (s) => { const i = latestIncident(s); return i ? `/incidents/${i}` : "/incidents"; }, highlight: "continue" },
  { title: "3 · Understand priority",
    body: "Next Step again: the Risk Prioritiser applies documented rules to every finding to give a priority, time-frame, contributing factors and uncertainty.",
    route: (s) => { const i = latestIncident(s); return i ? `/incidents/${i}` : "/incidents"; }, highlight: "pipeline" },
  { title: "4 · Approve or reject",
    body: "Next Step once more: the Response Planner proposes a preventive action. It only proposes — approve or reject it yourself; nothing becomes a live work order without a human decision.",
    route: (s) => { const i = latestIncident(s); return i ? `/incidents/${i}` : "/incidents"; }, highlight: "approve" },
  { title: "5 · Assign accountability",
    body: "In Work Orders, assign a maintenance team, a responsible person and a due date. Then switch the demo user (top bar) to that person to record progress and submit completion evidence.",
    route: (s) => { const w = latestWorkOrder(s); return w ? `/work-orders/${w}` : "/work-orders"; }, highlight: "assign" },
  { title: "6 · Verify completion",
    body: "Completion evidence moves the work order to Awaiting Verification — never straight to Verified. A reviewer verifies it or requests further work; every step is in View Activity History.",
    route: (s) => { const w = latestWorkOrder(s); return w ? `/work-orders/${w}` : "/work-orders"; }, highlight: "verify" },
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
          role="dialog" aria-label="Guided demo" className="fixed bottom-4 right-4 z-50 w-[360px] rounded-xl border border-amber/40 bg-surface p-4 shadow-2xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber"><Sparkles size={12} /> Guided demo · {demo.step + 1}/{DEMO_STEPS.length}</span>
            <button onClick={demo.stop} aria-label="Exit guided demo" className="text-faint hover:text-text"><X size={15} /></button>
          </div>
          <h3 className="text-sm font-semibold text-text">{step.title}</h3>
          <p className="mt-1.5 text-xs leading-relaxed text-muted">{step.body}</p>
          {step.action && <button onClick={() => step.action!.run(app)} className="mt-3 h-8 w-full rounded-md border border-amber/40 bg-amber-soft text-xs font-semibold text-amber hover:bg-amber/20">{step.action.label}</button>}
          <div className="mt-3 flex items-center justify-between">
            <div className="flex gap-1" aria-hidden>{DEMO_STEPS.map((_, i) => <span key={i} className={cx("h-1.5 w-4 rounded-full", i === demo.step ? "bg-amber" : i < demo.step ? "bg-amber/40" : "bg-line")} />)}</div>
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
