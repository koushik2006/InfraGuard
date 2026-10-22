"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronRight, FastForward, Moon, Pause, Play, RotateCcw, ShieldAlert, SkipForward, Sparkles, Sun, X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { cx, fmtSim } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { Role } from "@/lib/types";
import { CommandPalette } from "./CommandPalette";
import { GuidedDemo } from "./GuidedDemo";
import { navItems } from "./nav";

const VARIANT_LABEL: Record<string, string> = {
  persistent_deviation: "Persistent deviation",
  benign_transient: "Benign transient only",
  normal: "Normal",
  gradual_drift: "Gradual drift",
};

function Rail() {
  const { state } = useApp();
  const path = usePathname();
  const items = navItems(state);
  return (
    <nav aria-label="Primary" className="fixed inset-y-0 left-0 z-30 flex w-[60px] flex-col items-center border-r border-line bg-surface py-3">
      <Link href="/" aria-label="InfraGuard home" className="mb-4 grid h-9 w-9 place-items-center rounded-lg bg-blue-soft text-blue">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden><path d="M3 17h18M5 17V9l7-4 7 4v8M9 17v-5h6v5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
      </Link>
      <ul className="flex flex-1 flex-col items-center gap-1">
        {items.map((it) => {
          const active = it.match(path);
          const Icon = it.icon;
          return (
            <li key={it.key} className="group relative">
              <Link
                href={it.href}
                aria-label={it.label}
                aria-current={active ? "page" : undefined}
                className={cx("grid h-10 w-10 place-items-center rounded-lg transition-colors",
                  active ? "bg-blue-soft text-blue" : "text-muted hover:bg-raised hover:text-text")}
              >
                <Icon size={18} aria-hidden />
              </Link>
              {active && <span className="absolute -left-[10px] top-2 h-6 w-[3px] rounded-r bg-blue" aria-hidden />}
              <span className="pointer-events-none absolute left-12 top-1/2 z-50 -translate-y-1/2 whitespace-nowrap rounded-md border border-line bg-raised px-2 py-1 text-xs text-text opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                {it.label}{it.shortcut && <span className="ml-2 font-mono text-faint">{it.shortcut}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function ScenarioMenu() {
  const { state, sim } = useApp();
  const [open, setOpen] = useState(false);
  const cfg = state?.run.config;
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [seed, setSeed] = useState(4242);
  const [env, setEnv] = useState("nominal");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open && cfg) { setDraft(cfg.variants); setSeed(cfg.seed); setEnv(cfg.environment); }
  }, [open, cfg]);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const options: Record<string, string[]> = {
    "BRG-017": ["persistent_deviation", "benign_transient", "normal"], "BLD-204": ["gradual_drift", "normal"], "RW-031": ["normal"],
  };
  return (
    <div className="relative" ref={ref} data-coach="scenario">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog"
        className="flex h-8 items-center gap-2 whitespace-nowrap rounded-md border border-line bg-raised px-2.5 text-xs hover:border-faint" title={`Bridge: ${VARIANT_LABEL[cfg?.variants["BRG-017"] ?? ""] ?? ""} · Building: ${VARIANT_LABEL[cfg?.variants["BLD-204"] ?? ""] ?? ""} · Environment: ${cfg?.environment ?? ""}`}>
        <span className="text-faint">Scenario</span>
        <span className="font-medium text-text">{cfg?.scenario_id ?? "…"}</span>
        <span className="num text-muted">seed {cfg?.seed ?? "…"}</span>
        <span className="hidden text-muted min-[1700px]:inline">· Bridge: {VARIANT_LABEL[cfg?.variants["BRG-017"] ?? ""] ?? "…"}</span>
        <ChevronRight size={12} className={cx("text-faint transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <div role="dialog" aria-label="Scenario selector" className="absolute left-0 top-10 z-50 w-80 rounded-lg border border-line bg-surface p-4 shadow-2xl">
          <p className="mb-3 text-xs text-muted">Choose the SIMULATED scenario for each asset. Applying starts a new run (history is kept).</p>
          {Object.entries(options).map(([a, vs]) => (
            <label key={a} className="mb-2 flex items-center justify-between gap-2 text-xs">
              <span className="font-mono text-muted">{a}</span>
              <select value={draft[a] ?? vs[0]} onChange={(e) => setDraft({ ...draft, [a]: e.target.value })}
                className="h-8 w-44 rounded-md border border-line bg-raised px-2 text-xs text-text">
                {vs.map((v) => <option key={v} value={v}>{VARIANT_LABEL[v]}</option>)}
              </select>
            </label>
          ))}
          <label className="mb-2 flex items-center justify-between gap-2 text-xs">
            <span className="text-muted">Environment</span>
            <select value={env} onChange={(e) => setEnv(e.target.value)} className="h-8 w-44 rounded-md border border-line bg-raised px-2 text-xs text-text">
              <option value="nominal">Nominal</option><option value="heatwave">Heatwave (+8 °C)</option><option value="cold_snap">Cold snap (−8 °C)</option>
            </select>
          </label>
          <label className="mb-3 flex items-center justify-between gap-2 text-xs">
            <span className="text-muted">Seed</span>
            <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} className="num h-8 w-44 rounded-md border border-line bg-raised px-2 text-xs text-text" />
          </label>
          <button onClick={() => { sim.reset({ seed, variants: draft, environment: env }); setOpen(false); }}
            className="h-8 w-full rounded-md bg-blue text-xs font-semibold text-white hover:brightness-110">Apply & reset replay</button>
        </div>
      )}
    </div>
  );
}

function TopBar() {
  const { state, sim, theme, toggleTheme, user, setUser, setPaletteOpen, demo } = useApp();
  const s = state?.sim;
  const roles: { role: Role; name: string }[] = [
    { role: "engineer", name: "A. Rao (simulated engineer)" },
    { role: "asset_owner", name: "K. Iyer (simulated asset owner)" },
    { role: "viewer", name: "Guest viewer" },
  ];
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-bg/90 px-4 backdrop-blur">
      <div className="mr-1 hidden min-w-0 flex-col leading-tight lg:flex">
        <span className="text-sm font-semibold tracking-tight">InfraGuard</span>
        <span className="text-[10px] text-faint">AKinators · AgentOps</span>
      </div>
      <ScenarioMenu />
      <div className="flex items-center gap-1" data-coach="replay-controls" role="group" aria-label="Replay controls">
        <button onClick={() => sim.reset()} title="Reset to scenario (R)" aria-label="Reset replay" className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-raised hover:text-text"><RotateCcw size={15} /></button>
        <button onClick={sim.toggle} title="Play / pause (Space)" aria-label={s?.running ? "Pause replay" : "Play replay"}
          className={cx("grid h-8 w-8 place-items-center rounded-md", s?.running ? "bg-blue text-white" : "bg-raised text-text hover:bg-line")}>
          {s?.running ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <button onClick={() => sim.step(1)} title="Step one window (15 min)" aria-label="Step forward" className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-raised hover:text-text"><SkipForward size={15} /></button>
        <button onClick={sim.toEvent} title="Run every window until the next anomaly event" aria-label="Run to next event" className="flex h-8 items-center gap-1 rounded-md px-2 text-xs text-muted hover:bg-raised hover:text-text"><FastForward size={15} /> <span className="hidden 2xl:inline">Next event</span></button>
        <div className="ml-1 hidden items-center rounded-md border border-line bg-raised p-0.5 md:flex" role="radiogroup" aria-label="Replay speed">
          {(s?.speeds ?? [1, 2, 4, 8, 16]).map((v) => (
            <button key={v} role="radio" aria-checked={s?.speed === v} onClick={() => sim.speed(v)}
              className={cx("num h-6 rounded px-1.5 text-[11px]", s?.speed === v ? "bg-surface text-text" : "text-faint hover:text-text")}>{v}×</button>
          ))}
        </div>
      </div>
      <div className="flex min-w-[150px] flex-col" aria-live="off">
        <span className="num whitespace-nowrap text-xs text-text">{s ? fmtSim(s.cursor) : "—"} <span className="text-faint">UTC</span></span>
        <div className="mt-1 h-1 w-full overflow-hidden rounded bg-raised" role="progressbar" aria-label="Scenario progress" aria-valuenow={Math.round((s?.progress ?? 0) * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded bg-blue transition-[width] duration-200" style={{ width: `${(s?.progress ?? 0) * 100}%` }} />
        </div>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <span data-coach="simulated-badge" className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-violet/40 bg-violet-soft px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-violet">
          <span className="h-1.5 w-1.5 rounded-full bg-violet" aria-hidden /> Simulated data
        </span>
        <span className="hidden w-[132px] items-center gap-1 text-[10px] leading-tight text-muted xl:flex">
          <ShieldAlert size={13} className="shrink-0 text-faint" aria-hidden /> Decision support, not a safety certification
        </span>
        <button onClick={() => (demo.active ? demo.stop() : demo.start())} className={cx("flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 text-xs font-medium",
          demo.active ? "border-amber/50 bg-amber-soft text-amber" : "border-line bg-raised text-text hover:border-faint")}>
          <Sparkles size={13} /> {demo.active ? "Exit demo" : "Guided demo"}
        </button>
        <button onClick={() => setPaletteOpen(true)} className="hidden h-8 items-center gap-1.5 whitespace-nowrap rounded-md border border-line bg-raised px-2 text-[11px] text-muted hover:text-text 2xl:flex" aria-label="Open command palette">
          <span>Search</span><span className="font-mono">Ctrl K</span>
        </button>
        <select aria-label="Acting user (simulated)" value={user.role}
          onChange={(e) => { const r = roles.find((x) => x.role === e.target.value)!; setUser({ name: r.name, role: r.role }); }}
          className="h-8 max-w-[150px] rounded-md border border-line bg-raised px-2 text-xs text-text">
          {roles.map((r) => <option key={r.role} value={r.role}>{r.name}</option>)}
        </select>
        <button onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-raised hover:text-text">
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </div>
    </header>
  );
}

function Toasts() {
  const { toasts, dismissToast } = useApp();
  const tone = { blue: "border-l-blue", amber: "border-l-amber", red: "border-l-red", violet: "border-l-violet", slate: "border-l-slate" };
  return (
    <div className="pointer-events-none fixed bottom-4 left-[76px] z-50 flex w-[360px] flex-col gap-2" aria-live="polite" role="status">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div key={t.id} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}
            className={cx("pointer-events-auto rounded-lg border border-line border-l-4 bg-raised p-3 shadow-xl", tone[t.tone])}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-text">{t.title}</p>
                {t.body && <p className="mt-0.5 line-clamp-2 text-xs text-muted">{t.body}</p>}
                {t.href && <Link href={t.href} className="mt-1 inline-block text-xs font-medium text-blue hover:underline">Open</Link>}
              </div>
              <button onClick={() => dismissToast(t.id)} aria-label="Dismiss notification" className="text-faint hover:text-text"><X size={14} /></button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function Shortcuts() {
  const { state, sim, setPaletteOpen } = useApp();
  const router = useRouter();
  const items = useMemo(() => navItems(state), [state]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen(true); return; }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === " " && el.tagName !== "BUTTON" && el.tagName !== "A") { e.preventDefault(); sim.toggle(); }
      else if (e.key === "r" || e.key === "R") sim.reset();
      else if (/^[1-9]$/.test(e.key)) {
        const it = items.find((x) => x.shortcut === e.key);
        if (it) router.push(it.href);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [items, router, sim, setPaletteOpen]);
  return null;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { error, state } = useApp();
  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-20 focus:top-2 focus:z-50 focus:rounded focus:bg-blue focus:px-3 focus:py-1 focus:text-white">Skip to content</a>
      <Rail />
      <div className="pl-[60px]">
        <TopBar />
        {error && !state && (
          <div className="m-6 rounded-lg border border-red/40 bg-red-soft p-4 text-sm text-red" role="alert">
            Cannot reach the InfraGuard API ({error}). Start the backend: <code className="font-mono">python -m uvicorn backend.api.main:app --port 8000</code>
          </div>
        )}
        <main id="main" className="mx-auto max-w-[1520px] px-6 py-6">{children}</main>
      </div>
      <Toasts />
      <CommandPalette />
      <GuidedDemo />
      <Shortcuts />
    </div>
  );
}
