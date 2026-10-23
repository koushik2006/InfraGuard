"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, post } from "./api";
import { DEMO_USERS } from "./directory";
import type { AppState, AuditRow, Role } from "./types";

export interface Toast { id: number; tone: "blue" | "amber" | "red" | "violet" | "slate"; title: string; body?: string; href?: string }

interface Ctx {
  state: AppState | null;
  error: string | null;
  version: string;
  user: { name: string; role: Role };
  setUser: (u: { name: string; role: Role }) => void;
  theme: "dark" | "light";
  toggleTheme: () => void;
  toasts: Toast[];
  pushToast: (t: Omit<Toast, "id">) => void;
  dismissToast: (id: number) => void;
  refresh: () => Promise<void>;
  sim: {
    play: () => Promise<void>; pause: () => Promise<void>; toggle: () => Promise<void>;
    step: (ticks?: number) => Promise<void>; speed: (s: number) => Promise<void>;
    reset: (body?: Record<string, unknown>) => Promise<void>; toEvent: () => Promise<void>;
  };
  paletteOpen: boolean;
  setPaletteOpen: (o: boolean) => void;
  demo: { active: boolean; step: number; start: () => void; stop: () => void; go: (n: number) => void };
}

const AppCtx = createContext<Ctx | null>(null);

const TOAST_ACTIONS: Record<string, Toast["tone"]> = {
  anomaly_event_created: "amber",
  escalation_required: "red",
  data_quality_issue: "violet",
  transient_exceedance_not_alerted: "blue",
  work_order_approve: "blue",
  work_order_edit_approve: "blue",
  work_order_reject: "slate",
  fault_injected: "violet",
};

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [user, setUserState] = useState<{ name: string; role: Role }>({ name: "A. Rao (demo engineer)", role: "engineer" });
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [demoActive, setDemoActive] = useState(false);
  const [demoStep, setDemoStep] = useState(0);
  const lastAudit = useRef<number | null>(null);
  const toastId = useRef(1);

  useEffect(() => {
    try {
      const t = localStorage.getItem("ig-theme");
      if (t === "light" || t === "dark") setTheme(t);
      const u = localStorage.getItem("ig-user");
      if (u) { const p = JSON.parse(u); if (DEMO_USERS.some((x) => x.name === p.name && x.role === p.role)) setUserState(p); }
    } catch {}
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("ig-theme", theme); } catch {}
  }, [theme]);

  const pushToast = useCallback((t: Omit<Toast, "id">) => {
    const id = toastId.current++;
    setToasts((ts) => [...ts.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 6000);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((ts) => ts.filter((x) => x.id !== id)), []);

  const handleActivity = useCallback((rows: AuditRow[]) => {
    if (!rows.length) return;
    const newest = rows[0].id;
    if (lastAudit.current === null) {
      lastAudit.current = newest;
      return;
    }
    const fresh = rows.filter((r) => r.id > (lastAudit.current ?? 0)).reverse();
    lastAudit.current = Math.max(newest, lastAudit.current);
    const shown = fresh.filter((r) => TOAST_ACTIONS[r.action]).slice(-3);
    for (const r of shown) {
      pushToast({
        tone: TOAST_ACTIONS[r.action],
        title: r.action === "anomaly_event_created" ? "Anomaly event — investigation started"
          : r.action === "transient_exceedance_not_alerted" ? "Transient exceedance — not alerted"
          : r.action === "escalation_required" ? "Escalation required"
          : r.action === "data_quality_issue" ? "Data-quality issue"
          : r.action === "fault_injected" ? "Simulated fault injected"
          : r.summary.split(":")[0],
        body: r.summary,
        href: r.incident_id ? `/incidents/${r.incident_id}` : r.asset_id ? `/assets/${r.asset_id}` : undefined,
      });
    }
  }, [pushToast]);

  const refresh = useCallback(async () => {
    try {
      const s = await api<AppState>("/api/state");
      setState(s);
      setError(null);
      handleActivity(s.activity);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [handleActivity]);

  const running = state?.sim.running;
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, running ? 500 : 1500);
    return () => clearInterval(t);
  }, [refresh, running]);

  const wrap = useCallback((fn: () => Promise<unknown>) => async () => {
    try { await fn(); } catch (e) { pushToast({ tone: "red", title: "Action failed", body: (e as Error).message }); }
    await refresh();
  }, [refresh, pushToast]);

  const sim = useMemo(() => ({
    play: wrap(() => post("/api/sim/play")),
    pause: wrap(() => post("/api/sim/pause")),
    toggle: wrap(() => post(running ? "/api/sim/pause" : "/api/sim/play")),
    step: (ticks = 1) => wrap(() => post("/api/sim/step", { ticks }))(),
    speed: (s: number) => wrap(() => post("/api/sim/speed", { speed: s }))(),
    reset: (body: Record<string, unknown> = {}) => wrap(async () => {
      await post("/api/sim/reset", { actor: user.name, role: user.role, ...body });
      lastAudit.current = null;
    })(),
    toEvent: wrap(() => post("/api/sim/advance-to-event")),
  }), [wrap, running, user]);

  const setUser = useCallback((u: { name: string; role: Role }) => {
    setUserState(u);
    try { localStorage.setItem("ig-user", JSON.stringify(u)); } catch {}
  }, []);

  const lastId = state?.activity[0]?.id ?? 0;
  const version = `${state?.sim.cursor ?? ""}|${lastId}|${state?.run.run_id ?? ""}`;

  const demo = useMemo(() => ({
    active: demoActive, step: demoStep,
    start: () => { setDemoStep(0); setDemoActive(true); },
    stop: () => setDemoActive(false),
    go: (n: number) => setDemoStep(n),
  }), [demoActive, demoStep]);

  const value: Ctx = {
    state, error, version, user, setUser, theme, toggleTheme: () => setTheme((t) => (t === "dark" ? "light" : "dark")),
    toasts, pushToast, dismissToast, refresh, sim, paletteOpen, setPaletteOpen, demo,
  };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp outside AppProvider");
  return c;
}
