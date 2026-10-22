"use client";

import { Command, CornerDownLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { post } from "@/lib/api";
import { cx } from "@/lib/format";
import { useApp } from "@/lib/store";
import { latestIncident, navItems } from "./nav";

interface Cmd { id: string; label: string; group: string; hint?: string; run: () => void | Promise<void> }

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen, state, sim, toggleTheme, demo, user, pushToast, refresh } = useApp();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const cmds = useMemo<Cmd[]>(() => {
    const nav = navItems(state).map((n) => ({ id: "nav-" + n.key, group: "Go to", label: n.label, hint: n.shortcut, run: () => router.push(n.href) }));
    const assets = (state?.assets ?? []).map((a) => ({ id: "asset-" + a.asset_id, group: "Assets", label: `${a.name} (${a.asset_id})`, run: () => router.push(`/assets/${a.asset_id}`) }));
    const inc = latestIncident(state);
    const act: Cmd[] = [
      { id: "play", group: "Replay", label: state?.sim.running ? "Pause replay" : "Play replay", hint: "Space", run: sim.toggle },
      { id: "event", group: "Replay", label: "Run to next anomaly event", run: sim.toEvent },
      { id: "step", group: "Replay", label: "Step one window", run: () => sim.step(1) },
      { id: "reset", group: "Replay", label: "Reset to scenario", hint: "R", run: () => sim.reset() },
      { id: "frozen", group: "Simulation", label: "Inject frozen-sensor fault on IN-02 (retaining wall)", run: async () => {
        await post("/api/sim/inject-fault", { sensor_id: "IN-02", kind: "frozen_sensor", actor: user.name, role: user.role });
        pushToast({ tone: "violet", title: "Frozen-sensor fault injected", body: "IN-02 will repeat its last record from now on (simulated)." });
        await refresh();
      } },
      { id: "theme", group: "View", label: "Toggle light / dark theme", run: toggleTheme },
      { id: "demo", group: "View", label: demo.active ? "Exit guided demo" : "Start guided demo", run: () => (demo.active ? demo.stop() : demo.start()) },
    ];
    if (inc) {
      act.push({ id: "why", group: "Incident", label: `Why was ${inc} flagged?`, run: () => router.push(`/incidents/${inc}?why=1`) });
      act.push({ id: "approve", group: "Incident", label: `Review proposal for ${inc}`, run: () => router.push(`/incidents/${inc}/plan`) });
    }
    return [...nav, ...assets, ...act];
  }, [state, router, sim, toggleTheme, demo, user, pushToast, refresh]);

  const filtered = cmds.filter((c) => (c.group + " " + c.label).toLowerCase().includes(q.toLowerCase()));

  useEffect(() => {
    if (paletteOpen) { setQ(""); setSel(0); setTimeout(() => input.current?.focus(), 10); }
  }, [paletteOpen]);
  useEffect(() => setSel(0), [q]);

  if (!paletteOpen) return null;
  const run = async (c: Cmd) => { setPaletteOpen(false); await c.run(); };
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 pt-[12vh]" onClick={() => setPaletteOpen(false)}>
      <div role="dialog" aria-modal="true" aria-label="Command palette" onClick={(e) => e.stopPropagation()}
        className="w-[560px] max-w-[92vw] overflow-hidden rounded-xl border border-line bg-surface shadow-2xl">
        <div className="flex items-center gap-2 border-b border-line px-4">
          <Command size={15} className="text-faint" aria-hidden />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a command or search…"
            aria-label="Search commands" aria-controls="palette-list" aria-activedescendant={filtered[sel] ? `cmd-${filtered[sel].id}` : undefined}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, filtered.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
              else if (e.key === "Enter" && filtered[sel]) run(filtered[sel]);
              else if (e.key === "Escape") setPaletteOpen(false);
            }}
            className="h-12 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-faint" />
        </div>
        <ul id="palette-list" role="listbox" className="max-h-[50vh] overflow-y-auto p-1.5">
          {filtered.length === 0 && <li className="px-3 py-6 text-center text-xs text-muted">No matching commands</li>}
          {filtered.map((c, i) => (
            <li key={c.id} id={`cmd-${c.id}`} role="option" aria-selected={i === sel} onMouseEnter={() => setSel(i)} onClick={() => run(c)}
              className={cx("flex cursor-pointer items-center justify-between rounded-md px-3 py-2 text-sm", i === sel ? "bg-blue-soft text-text" : "text-muted")}>
              <span><span className="mr-2 text-[11px] uppercase tracking-wider text-faint">{c.group}</span>{c.label}</span>
              {i === sel ? <CornerDownLeft size={13} className="text-faint" /> : c.hint && <span className="font-mono text-[11px] text-faint">{c.hint}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
