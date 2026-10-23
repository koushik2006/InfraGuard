"use client";

import { animate, motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef } from "react";
import { cx } from "@/lib/format";

/** Section entrance: a short fade and rise. Disabled when the user prefers reduced motion. */
export function Reveal({ children, delay = 0, className }: { children: React.ReactNode; delay?: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div className={className} initial={reduce ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: reduce ? 0 : delay, ease: [0.22, 1, 0.36, 1] }}>
      {children}
    </motion.div>
  );
}

/** Card with a gentle lift on hover (border and shadow ease via CSS). */
export function OvCard({ children, className, active, ...rest }: React.ComponentProps<typeof motion.div> & { active?: boolean }) {
  const reduce = useReducedMotion();
  return (
    <motion.div {...rest} whileHover={reduce ? undefined : { y: -2 }} transition={{ duration: 0.18 }}
      className={cx("card transition-[border-color,box-shadow] duration-200 hover:border-faint", active && "card-active", className)}>
      {children}
    </motion.div>
  );
}

/** Counts an integer up to its value on first show and between changes; renders the final value instantly under reduced motion. */
export function CountUp({ value, duration = 0.9 }: { value: number; duration?: number }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduce) { el.textContent = String(value); shown.current = value; return; }
    const c = animate(shown.current, value, { duration, ease: "easeOut", onUpdate: (v) => { shown.current = v; el.textContent = String(Math.round(v)); } });
    return () => c.stop();
  }, [value, reduce, duration]);
  return <span ref={ref}>{value}</span>;
}
