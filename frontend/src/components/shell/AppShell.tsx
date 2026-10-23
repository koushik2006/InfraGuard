"use client";

import { DEMO_USERS } from "@/lib/directory";
import { AnimatePresence, motion } from "framer-motion";
import {
  FastForward, Moon, Pause, Play, RotateCcw, ShieldAlert, SkipForward, Sparkles, Sun, X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { cx, fmtSim } from "@/lib/format";
import { useApp } from "@/lib/store";
import { CommandPalette } from "./CommandPalette";
import { GuidedDemo } from "./GuidedDemo";
import { navItems } from "./nav";

function Rail() {
  const path = usePathname();
  const items = navItems();
  return (
    <nav aria-label="Primary" className="fixed inset-y-0 left-0 z-30 flex w-[60px] flex-col border-r border-line bg-surface py-3 xl:w-[196px]">
      <Link href="/" aria-label="InfraGuard home" className="mb-5 flex items-center gap-2.5 px-[10px] xl:px-4">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-blue-soft text-blue">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden><path d="M3 17h18M5 17V9l7-4 7 4v8M9 17v-5h6v5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
        </span>
        <span className="hidden text-sm font-semibold tracking-tight xl:inline">InfraGuard</span>
      </Link>
      <ul className="flex flex-col gap-1 px-[10px] xl:px-3">
        {items.map((it) => {
          const active = it.match(path);
          const Icon = it.icon;
          return (
            <li key={it.key} className="relative">
              <Link href={it.href} aria-label={it.label} title={it.label} aria-current={active ? "page" : undefined}
                className={cx("flex h-10 items-center gap-3 rounded-lg px-[10px] text-sm transition-colors", active ? "bg-blue-soft font-medium text-blue" : "text-muted hover:bg-raised hover:text-text")}>
                <Icon size={18} aria-hidden className="shrink-0" />
                <span className="hidden xl:inline">{it.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function ScenarioMenu() {
  const { state, sim } = useApp();
  const v = state?.run.config.variants["BRG-017"] ?? "persistent_deviation";
  return (
    <label className="flex h-8 items-center gap-2 whitespace-nowrap rounded-md border border-line bg-raised px-2.5 text-xs" data-coach="scenario">
      <span className="hidden text-faint xl:inline">Scenario</span>
      <select aria-label="Bridge scenario (resets the replay)" value={v} onChange={(e) => sim.reset({ variants: { "BRG-017": e.target.value } })} className="bg-transparent text-text outline-none">
        <option value="persistent_deviation">Persistent deviation</option>
        <option value="benign_transient">Benign transient only</option>
        <option value="normal">Normal</option>
      </select>
    </label>
  );
}

function TopBar() {
  const { state, sim, theme, toggleTheme, user, setUser, setPaletteOpen, demo } = useApp();
  const s = state?.sim;
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-bg/90 px-4 backdrop-blur">
      <div className="mr-1 hidden min-w-0 flex-col leading-tight 2xl:flex">
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
        <div className="ml-1 hidden items-center rounded-md border border-line bg-raised p-0.5 2xl:flex" role="radiogroup" aria-label="Replay speed">
          {(s?.speeds ?? [1, 2, 4, 8, 16]).map((v) => (
            <button key={v} role="radio" aria-checked={s?.speed === v} onClick={() => sim.speed(v)}
              className={cx("num h-6 rounded px-1.5 text-[11px]", s?.speed === v ? "bg-surface text-text" : "text-faint hover:text-text")}>{v}×</button>
          ))}
        </div>
      </div>
      <div className="flex min-w-[110px] flex-col xl:min-w-[150px]" aria-live="off">
        <span className="num whitespace-nowrap text-xs text-text">{s ? fmtSim(s.cursor) : "—"} <span className="text-faint">UTC</span></span>
        <div className="mt-1 h-1 w-full overflow-hidden rounded bg-raised" role="progressbar" aria-label="Scenario progress" aria-valuenow={Math.round((s?.progress ?? 0) * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded bg-blue transition-[width] duration-200" style={{ width: `${(s?.progress ?? 0) * 100}%` }} />
        </div>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <span data-coach="simulated-badge" className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-violet/40 bg-violet-soft px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-violet">
          <span className="h-1.5 w-1.5 rounded-full bg-violet" aria-hidden /> Simulated data
        </span>
        <span className="hidden w-[132px] items-center gap-1 text-[10px] leading-tight text-muted 2xl:flex">
          <ShieldAlert size={13} className="shrink-0 text-faint" aria-hidden /> Decision support, not a safety certification
        </span>
        <button onClick={() => (demo.active ? demo.stop() : demo.start())} aria-label={demo.active ? "Exit guided demo" : "Guided demo"} title="Guided demo" className={cx("flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 text-xs font-medium",
          demo.active ? "border-amber/50 bg-amber-soft text-amber" : "border-line bg-raised text-text hover:border-faint")}>
          <Sparkles size={13} /> <span className="hidden xl:inline">{demo.active ? "Exit demo" : "Guided demo"}</span>
        </button>
        <button onClick={() => setPaletteOpen(true)} className="hidden h-8 items-center gap-1.5 whitespace-nowrap rounded-md border border-line bg-raised px-2 text-[11px] text-muted hover:text-text 2xl:flex" aria-label="Open command palette">
          <span>Search</span><span className="font-mono">Ctrl K</span>
        </button>
        <select aria-label="Acting user (demo identity)" value={user.name} title="Demo identity — no real sign-in"
          onChange={(e) => { const r = DEMO_USERS.find((x) => x.name === e.target.value)!; setUser({ name: r.name, role: r.role }); }}
          className="h-8 max-w-[120px] rounded-md border border-line bg-raised px-2 text-xs text-text xl:max-w-[170px]">
          {DEMO_USERS.map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}
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
    <div className="pointer-events-none fixed bottom-4 left-[76px] xl:left-[212px] z-50 flex w-[360px] flex-col gap-2" aria-live="polite" role="status">
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
  const { sim, setPaletteOpen } = useApp();
  const router = useRouter();
  const items = navItems();
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
      <div className="pl-[60px] xl:pl-[196px]">
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
