"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Activity, CircleSlash, Info, Search, Siren, Unplug, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { cx } from "@/lib/format";
import type { AssetStatus } from "@/lib/types";

// ------------------------------------------------------------------ Button
type Variant = "primary" | "secondary" | "ghost" | "danger";
export function Button({ variant = "secondary", size = "md", className, children, ...p }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  return (
    <button
      {...p}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45",
        size === "sm" ? "h-8 px-3 text-xs" : "h-9 px-4 text-sm",
        variant === "primary" && "bg-blue text-white hover:brightness-110 shadow-[0_1px_0_rgba(255,255,255,0.15)_inset]",
        variant === "secondary" && "border border-line bg-raised text-text hover:border-faint",
        variant === "ghost" && "text-muted hover:bg-raised hover:text-text",
        variant === "danger" && "border border-red/50 bg-red-soft text-red hover:bg-red/20",
        className,
      )}
    >
      {children}
    </button>
  );
}

// ------------------------------------------------------------------ Card
export function Card({ className, children, active, ...p }: React.HTMLAttributes<HTMLDivElement> & { active?: boolean }) {
  return <div {...p} className={cx("card", active && "card-active", className)}>{children}</div>;
}

export function CardHeader({ title, subtitle, right, icon }: { title: React.ReactNode; subtitle?: React.ReactNode; right?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line-soft px-5 py-3.5">
      <div className="flex min-w-0 items-start gap-2.5">
        {icon && <span className="mt-0.5 text-muted">{icon}</span>}
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight text-text">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
        </div>
      </div>
      {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ Badges
type Tone = "blue" | "amber" | "red" | "violet" | "slate" | "neutral";
const toneCls: Record<Tone, string> = {
  blue: "bg-blue-soft text-blue border-blue/30",
  amber: "bg-amber-soft text-amber border-amber/35",
  red: "bg-red-soft text-red border-red/40",
  violet: "bg-violet-soft text-violet border-violet/35",
  slate: "bg-slate-soft text-muted border-slate/40",
  neutral: "bg-raised text-muted border-line",
};
export function Badge({ tone = "neutral", children, className, icon }: { tone?: Tone; children: React.ReactNode; className?: string; icon?: React.ReactNode }) {
  return (
    <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4", toneCls[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

export const STATUS_META: Record<AssetStatus, { tone: Tone; icon: React.ElementType; hint: string }> = {
  "No anomaly detected": { tone: "blue", icon: Activity, hint: "No persistent deviation from this asset's own baseline. This is not a statement that the structure is sound." },
  Investigate: { tone: "amber", icon: Search, hint: "A persistent deviation passed the data-quality gate. A qualified engineer should look at the evidence." },
  "Escalation required": { tone: "red", icon: Siren, hint: "An owner-supplied criterion was exceeded. Human escalation is required." },
  "Data unavailable": { tone: "slate", icon: CircleSlash, hint: "Detection is not possible: data missing, failed quality checks, or insufficient baseline." },
};

export function StatusChip({ status, size = "md" }: { status: AssetStatus; size?: "sm" | "md" }) {
  const m = STATUS_META[status];
  const Icon = m.icon;
  const reduce = useReducedMotion();
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        key={status}
        initial={reduce ? false : { opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.92 }}
        transition={{ duration: 0.2 }}
        title={m.hint}
        className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border font-semibold", toneCls[m.tone],
          size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs")}
      >
        <Icon size={size === "sm" ? 12 : 14} aria-hidden />
        {status}
      </motion.span>
    </AnimatePresence>
  );
}

export function DataQualityChip({ label, size = "md" }: { label: string; size?: "sm" | "md" }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border font-semibold", toneCls.violet,
      size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs")} title="Sensor / data-quality issue — kept separate from structural anomalies">
      <Unplug size={size === "sm" ? 12 : 14} aria-hidden />
      {label}
    </span>
  );
}

export function SimulatedTag({ className }: { className?: string }) {
  return <span className={cx("rounded border border-violet/35 px-1 text-[10px] font-semibold uppercase tracking-wider text-violet", className)}>Simulated</span>;
}

// ------------------------------------------------------------------ Term tooltip
export const GLOSSARY: Record<string, string> = {
  "robust z-score": "How far a reading is from this asset's own median, in units of 1.4826 × MAD. An anomaly indicator — not a probability of failure.",
  MAD: "Median absolute deviation: a spread measure that ignores outliers better than standard deviation.",
  baseline: "Typical behaviour learned from this asset's own reference period. A learned baseline is not a safe-state baseline.",
  persistence: "An event needs the threshold to be exceeded in k of the last N windows, so single spikes do not alert.",
  "data-quality gate": "Windows that are missing, stale, frozen or implausible cannot count toward detection.",
  corroboration: "Other sensors on the same asset showing the same persistent deviation.",
  "dominant frequency": "Strongest vibration frequency in the first-mode band (1.5–5 Hz). Shifts can relate to stiffness or boundary conditions.",
  RMS: "Root-mean-square acceleration over the window: overall vibration level.",
  "temperature compensation": "Tilt is corrected with a temperature model fitted on the reference period, so daily thermal movement does not alert.",
  "change-point": "Estimated window where the mean of the signal shifted (single mean-shift estimate).",
  "triage score": "Demonstration triage score: a transparent sum of documented rule points. Not a risk or failure probability.",
  provisional: "Baseline learned automatically; the reference period has not been reviewed by an engineer.",
  window: "Readings are summarised per fixed window (15 min for the bridge, 60 min for the others).",
};

export function Term({ t, children }: { t: keyof typeof GLOSSARY | string; children?: React.ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const text = GLOSSARY[t] ?? t;
  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        className="inline-flex items-center gap-0.5 border-b border-dotted border-faint text-inherit"
      >
        {children ?? t}
        <Info size={11} className="text-faint" aria-hidden />
      </button>
      {open && (
        <span id={id} role="tooltip" className="absolute left-0 top-full z-50 mt-1.5 w-64 rounded-md border border-line bg-raised p-2.5 text-xs font-normal leading-relaxed text-text shadow-xl">
          {text}
        </span>
      )}
    </span>
  );
}

// ------------------------------------------------------------------ misc
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton", className)} aria-hidden />;
}

export function Empty({ icon, title, body, action }: { icon?: React.ReactNode; title: string; body?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {icon && <div className="mb-1 text-faint">{icon}</div>}
      <p className="text-sm font-medium text-text">{title}</p>
      {body && <p className="max-w-md text-xs leading-relaxed text-muted">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-line bg-raised px-1.5 py-px font-mono text-[10px] text-muted">{children}</kbd>;
}

export function Stat({ label, value, sub, tone }: { label: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode; tone?: Tone }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium uppercase tracking-wider text-faint">{label}</div>
      <div className={cx("num mt-1 truncate text-lg font-semibold", tone === "amber" ? "text-amber" : tone === "red" ? "text-red" : tone === "violet" ? "text-violet" : tone === "blue" ? "text-blue" : "text-text")}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Segmented<T extends string | number>({ options, value, onChange, label }: { options: { value: T; label: React.ReactNode }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-line bg-raised p-0.5">
      {options.map((o) => (
        <button key={String(o.value)} role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)}
          className={cx("rounded px-2.5 py-1 text-xs font-medium transition-colors", o.value === value ? "bg-surface text-text shadow-sm" : "text-muted hover:text-text")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Drawer({ open, onClose, title, children, width = 520 }: { open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="fixed inset-0 z-40 bg-black/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} onClick={onClose} />
          <motion.aside
            ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : "Details"}
            className="fixed right-0 top-0 z-50 flex h-full max-w-full flex-col border-l border-line bg-surface shadow-2xl outline-none"
            style={{ width }}
            initial={reduce ? { opacity: 0 } : { x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={reduce ? { opacity: 0 } : { x: 40, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
          >
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <h2 className="text-base font-semibold">{title}</h2>
              <button onClick={onClose} aria-label="Close" className="rounded p-1 text-muted hover:bg-raised hover:text-text"><X size={16} /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

export function PageHeader({ eyebrow, title, subtitle, right }: { eyebrow?: React.ReactNode; title: React.ReactNode; subtitle?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 flex items-center gap-2 text-xs font-medium text-muted">{eyebrow}</div>}
        <h1 className="text-xl font-semibold tracking-tight text-text">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-muted">{subtitle}</p>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}
