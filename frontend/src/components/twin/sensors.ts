import { Activity, Compass, Ruler, Thermometer, Wind } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { IncidentBrief, SensorFinding } from "@/lib/types";

/** Sensor state as computed by the backend (/api/assets/{id}/sensors). The UI never derives it. */
export type TwinState = "normal" | "observation" | "investigate" | "escalation" | "data_quality";

export interface SensorState {
  state: TwinState; state_reason: string;
  sensor_id: string; kind: string; location: string; schematic: { x: number; y: number; label: string } | null;
  feature: string; feature_label: string; unit: string; latest: number | null; latest_time: string; z: number | null;
  exceeding: boolean; quality: string; quality_detail: string; detection_sensor: boolean; baseline_median: number | null;
  baseline_version: string; baseline_status: string; trend: (number | null)[]; trend_quality: string[];
  incident_role: "primary" | "corroborating" | "context" | null; incident_id: string | null;
  finding_kind: "incident_finding" | "closed_incident" | "transient" | null; finding: SensorFinding | null;
  component: { id: string | null; name: string | null; mapped: boolean };
  anomaly_interval: { onset: string; last: string } | null; evidence: { ref_id: string; title: string; summary: string }[];
}

export interface TwinEnvironment {
  temperature_c: number | null; wind_ms: number | null; traffic_index: number | null; heavy_vehicle: boolean | null; time: string; note: string;
}

export interface SensorsResp {
  asset_id: string; cursor: string; sensors: SensorState[]; environment: TwinEnvironment; reporting: number; total: number;
  open_incident: string | null; status: string;
  incident: (IncidentBrief & { findings_count: number; finding_sensors: string[] }) | null;
}

/** Colours for the always-dark 3D viewport. Green is used only for "reporting" indicators, never for a safety claim. */
export const STATE_META: Record<TwinState, { label: string; color: string; glyph: string; hint: string }> = {
  normal: { label: "Normal", color: "#22d3ee", glyph: "", hint: "Within this sensor's own baseline range" },
  observation: { label: "Under observation", color: "#ffb020", glyph: "◔", hint: "Beyond baseline range but no persistent anomaly (or context-only sensor)" },
  investigate: { label: "Requires investigation", color: "#ffb020", glyph: "!", hint: "Persistent deviation that passed the data-quality gate" },
  escalation: { label: "Escalation required", color: "#ff5a47", glyph: "!!", hint: "Owner-supplied criterion exceeded" },
  data_quality: { label: "Data-quality issue", color: "#a78bfa", glyph: "?", hint: "Missing, stale, frozen or implausible data — a sensor issue, not a structural finding" },
};

export const REPORTING_COLOR = "#34d399";

export const KIND_ICON: Record<string, LucideIcon> = {
  accelerometer: Activity, tiltmeter: Compass, strain_gauge: Ruler, crackmeter: Ruler, anemometer: Wind, temperature: Thermometer,
};


export const KIND_LABEL: Record<string, string> = {
  accelerometer: "Deck vibration (accelerometer)", tiltmeter: "Tilt", strain_gauge: "Strain gauge", anemometer: "Wind (anemometer)",
  temperature: "Temperature", crackmeter: "Crack meter",
};

/** Scene placement of each sensor on the 3D model (visual layout only — all values come from the backend). */
export const POS3D: Record<string, [number, number, number]> = {
  "ACC-M1": [-3, 1.5, -2.6],
  "ACC-Q1": [-16, 1.4, -2.6],
  "ACC-P2": [24, 1.4, 2.6],
  "STR-G1": [9, -1.6, 0],
  "STR-C1": [15.4, 11.4, 3.5],
  "TLT-T1": [22, 22, 3.4],
  "TLT-P2": [22, -6.5, 5.1],
  "WND-1": [-22, 32.4, 3.5],
  "TMP-B1": [-44, -1.3, 0],
};

export const FINDING_KIND_LABEL: Record<string, string> = {
  incident_finding: "Finding in an open incident",
  closed_incident: "Continuation of a closed incident",
  transient: "Transient observation — not an incident",
};
export const ROLE_LABEL: Record<string, string> = { primary: "Primary finding", corroborating: "Corroborating finding", context: "Context observation" };

/** Components that exist as real meshes in the 3D scene. A sensor whose component is not listed gets no highlight. */
export const SCENE_COMPONENTS = new Set(["deck_s1", "deck_q1", "deck_mid", "deck_p2", "girder_mid", "cable_c6", "tower_1", "tower_1_top", "tower_2", "pier_1", "pier_2"]);
