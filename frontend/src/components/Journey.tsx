import { Check } from "lucide-react";
import { cx } from "@/lib/format";
import { JOURNEY, journeyStep } from "@/lib/workflow";

/** Compact tracker for the single workflow: Detected → Evidence → Priority → Approval → Verification. */
export function Journey({ state, className }: { state: string; className?: string }) {
  const cur = journeyStep(state);
  return (
    <ol className={cx("flex items-center gap-1 text-[11px]", className)} aria-label={`Workflow progress: step ${Math.min(cur + 1, JOURNEY.length)} of ${JOURNEY.length}`}>
      {JOURNEY.map((label, i) => {
        const done = i < cur;
        const active = i === cur;
        return (
          <li key={label} className="flex items-center gap-1" aria-current={active ? "step" : undefined}>
            {i > 0 && <span className={cx("h-px w-3", done || active ? "bg-blue" : "bg-line")} aria-hidden />}
            <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium",
              done ? "text-blue" : active ? "bg-amber-soft text-amber ring-1 ring-amber/40" : "text-faint")}>
              {done && <Check size={10} aria-hidden />}{label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
