"use client";

import { FastForward, Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui";
import { useApp } from "@/lib/store";

/** Runs the replay until the Sentinel opens the next anomaly. The label reflects the real pending request. */
export function RunToEventButton({ size = "md", variant = "primary", label = "Run to next event" }: { size?: "sm" | "md"; variant?: "primary" | "secondary" | "ghost"; label?: string }) {
  const { sim } = useApp();
  const [busy, setBusy] = useState(false);
  return (
    <Button size={size} variant={variant} disabled={busy} onClick={async () => { setBusy(true); try { await sim.toEvent(); } finally { setBusy(false); } }}>
      {busy ? <><Loader2 size={14} className="animate-spin" /> Checking sensor readings…</> : <><FastForward size={14} /> {label}</>}
    </Button>
  );
}
