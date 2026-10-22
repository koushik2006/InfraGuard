export const FEATURE_LABEL: Record<string, string> = {
  rms: "RMS acceleration",
  peak: "Peak acceleration",
  dom_freq: "Dominant frequency",
  tilt: "Tilt",
  tilt_resid: "Tilt (temperature-compensated)",
  tilt_slope: "Tilt trend",
  width: "Crack width",
  temp: "Temperature",
};

export const ASSET_TYPE_LABEL: Record<string, string> = {
  bridge: "Bridge",
  building: "Building",
  retaining_wall: "Retaining wall",
};

export function fmtNum(v: number | null | undefined, digits = 3): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const a = Math.abs(v);
  if (a >= 100000) return v.toExponential(2);
  if (a !== 0 && a < 0.01) return v.toFixed(Math.max(digits, 4));
  return v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: Math.min(digits, a < 10 ? 2 : 1) });
}

export function fmtZ(z: number | null | undefined): string {
  if (z === null || z === undefined) return "—";
  return (z >= 0 ? "+" : "−") + Math.abs(z).toFixed(1);
}

/** Simulated timestamps are shown in UTC to match the scenario definition. */
export function fmtSim(iso: string | null | undefined, withDate = true): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  return withDate ? `${date} ${time}` : time;
}

export function fmtWall(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function humanState(s: string): string {
  return s.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(" ");
}
