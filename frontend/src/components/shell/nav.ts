import {
  ClipboardCheck, FlaskConical, Gauge, History, LayoutDashboard, LineChart, ListChecks, ScanSearch,
  ScrollText, SlidersHorizontal, Spline,
} from "lucide-react";
import type { AppState } from "@/lib/types";

export interface NavItem { key: string; label: string; href: string; icon: React.ElementType; shortcut?: string; match: (p: string) => boolean }

export function latestIncident(state: AppState | null): string | null {
  if (!state?.incidents.length) return null;
  const open = state.incidents.filter((i) => !i.closed && i.asset_id === "BRG-017");
  const pick = open.at(-1) ?? state.incidents.filter((i) => !i.closed).at(-1) ?? state.incidents.at(-1);
  return pick?.incident_id ?? null;
}

export function navItems(state: AppState | null): NavItem[] {
  const inc = latestIncident(state);
  const incBase = inc ? `/incidents/${inc}` : "/incidents";
  return [
    { key: "command", label: "Command Centre", href: "/", icon: LayoutDashboard, shortcut: "1", match: (p) => p === "/" },
    { key: "asset", label: "Asset Detail", href: "/assets/BRG-017", icon: LineChart, shortcut: "2", match: (p) => p.startsWith("/assets") },
    { key: "investigation", label: "Investigation Centre", href: incBase, icon: ScanSearch, shortcut: "3", match: (p) => /^\/incidents(\/[^/]+)?$/.test(p) },
    { key: "planner", label: "Inspection Planner", href: inc ? `${incBase}/plan` : "/incidents", icon: ClipboardCheck, shortcut: "4", match: (p) => p.endsWith("/plan") },
    { key: "verify", label: "Verification & Audit", href: inc ? `${incBase}/verify` : "/incidents", icon: ListChecks, shortcut: "5", match: (p) => p.endsWith("/verify") },
    { key: "schematic", label: "Bridge Schematic", href: "/schematic", icon: Spline, shortcut: "6", match: (p) => p.startsWith("/schematic") },
    { key: "whatif", label: "What-If Lab", href: "/whatif", icon: FlaskConical, shortcut: "7", match: (p) => p.startsWith("/whatif") },
    { key: "replay", label: "Decision Replay", href: inc ? `${incBase}/replay` : "/incidents", icon: History, shortcut: "8", match: (p) => p.endsWith("/replay") },
    { key: "simulation", label: "Simulation Controls", href: "/simulation", icon: SlidersHorizontal, shortcut: "9", match: (p) => p.startsWith("/simulation") },
    { key: "audit", label: "Audit Log", href: "/audit", icon: ScrollText, match: (p) => p.startsWith("/audit") },
    { key: "metrics", label: "Detection Metrics", href: "/metrics", icon: Gauge, match: (p) => p.startsWith("/metrics") },
  ];
}
