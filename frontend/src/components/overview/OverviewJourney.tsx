"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Check } from "lucide-react";
import { cx } from "@/lib/format";
import { JOURNEY, journeyStep } from "@/lib/workflow";

/** Investigation timeline for the Overview. It animates only when the incident's real workflow state changes
 *  (connector fill and step colour); on first render it appears in its current state without any motion. */
export function OverviewJourney({ state }: { state: string }) {
  const cur = journeyStep(state);
  const reduce = useReducedMotion();
  return (
    <ol className="flex items-center gap-1 text-[11px]" aria-label={`Workflow progress: step ${Math.min(cur + 1, JOURNEY.length)} of ${JOURNEY.length}`}>
      {JOURNEY.map((label, i) => {
        const done = i < cur, active = i === cur;
        return (
          <li key={label} className="flex items-center gap-1" aria-current={active ? "step" : undefined}>
            {i > 0 && (
              <span className="relative h-px w-4 overflow-hidden bg-line" aria-hidden>
                <motion.span className="absolute inset-y-0 left-0 bg-blue" initial={false} animate={{ width: done || active ? "100%" : "0%" }} transition={{ duration: reduce ? 0 : 0.5, ease: "easeOut" }} />
              </span>
            )}
            <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium transition-colors duration-500",
              done ? "text-blue" : active ? "bg-amber-soft text-amber ring-1 ring-amber/40" : "text-faint")}>
              {done && <Check size={10} aria-hidden />}{label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
