import { Box, ClipboardCheck, LayoutDashboard, ScanSearch, ShieldCheck } from "lucide-react";
import type { AppState } from "@/lib/types";

export interface NavItem { key: string; label: string; href: string; icon: React.ElementType; shortcut: string; match: (p: string) => boolean }

/** Most relevant open incident (or the latest one), used by shortcuts and the guided demo. */
export function latestIncident(state: AppState | null): string | null {
  if (!state?.incidents.length) return null;
  return (state.incidents.filter((i) => !i.closed).at(-1) ?? state.incidents.at(-1))?.incident_id ?? null;
}

export function latestWorkOrder(state: AppState | null): string | null {
  const pick = state?.incidents.filter((i) => i.work_order_id && !i.closed).at(-1) ?? state?.incidents.filter((i) => i.work_order_id).at(-1);
  return pick?.work_order_id ?? null;
}

/** The primary destinations. */
export function navItems(): NavItem[] {
  return [
    { key: "overview", label: "Overview", href: "/", icon: LayoutDashboard, shortcut: "1", match: (p) => p === "/" },
    { key: "infrastructure", label: "Infrastructure", href: "/assets", icon: Box, shortcut: "2", match: (p) => p.startsWith("/assets") },
    { key: "investigations", label: "Investigations", href: "/incidents", icon: ScanSearch, shortcut: "3", match: (p) => p.startsWith("/incidents") },
    { key: "workorders", label: "Work Orders", href: "/work-orders", icon: ClipboardCheck, shortcut: "4", match: (p) => p.startsWith("/work-orders") },
    { key: "audit", label: "Audit Trail", href: "/audit", icon: ShieldCheck, shortcut: "5", match: (p) => p.startsWith("/audit") },
  ];
}
