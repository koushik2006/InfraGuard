// Mirrors backend/contracts.py (subset used by the UI).
export type AssetStatus = "No anomaly detected" | "Investigate" | "Data unavailable" | "Escalation required";
export type Role = "viewer" | "engineer" | "asset_owner";

export interface SparkPoint { i: number; v: number | null; q: string; x: boolean }

export interface SensorHealth {
  sensor_id: string; kind: string; location: string;
  health: "ok" | "degraded" | "failed" | "unavailable"; latest: string; issues: number; detail: string;
}

export interface AssetSummary {
  asset_id: string; name: string; type: "bridge" | "building" | "retaining_wall"; criticality: string;
  location_text: string; status: AssetStatus; data_quality_issues: string[]; open_incident: string | null;
  baseline: { version: string; status: string; reviewed: boolean };
  display: { sensor_id: string; feature: string; unit: string; latest: number | null; median: number | null; sparkline: SparkPoint[] };
  sensors: SensorHealth[]; open_incidents: number; last_updated: string; windows_ingested: number;
  thresholds: Threshold[]; threshold_label: string | null;
}

export interface Threshold { sensor_id: string; feature: string; limit: number; direction: string; kind: string; label: string; source: string }

export interface AuditRow {
  id: number; ts: string; sim_time: string | null; incident_id: string | null; asset_id: string | null;
  actor: string; actor_type: "agent" | "human" | "system"; action: string; from_state: string | null;
  to_state: string | null; summary: string; detail: Record<string, unknown>;
}

export interface IncidentBrief {
  incident_id: string; asset_id: string; state: string; status_text: string; closed: boolean; escalation: boolean;
  event_id: string; primary_sensor_id: string; top_feature: string; top_z: number; onset_time: string;
  detected_time: string; priority: string | null; timeframe: string | null; work_order_id: string | null;
  work_order_status: string | null;
}

export interface RunConfig {
  scenario_id: string; seed: number; variants: Record<string, string>; environment: string;
  interventions: { type: string; sensor_id: string; from_time: string; label: string }[];
}

export interface AppState {
  run: { run_id: string; config: RunConfig; versions: Record<string, string> };
  sim: {
    cursor: string; start: string; monitor_start: string; end: string; running: boolean; speed: number;
    speeds: number[]; progress: number; finished: boolean; last_tick_at: string | null;
  };
  assets: AssetSummary[]; incidents: IncidentBrief[]; activity: AuditRow[];
  llm: { enabled: boolean; model: string | null; mode: string }; data_source: string;
}

export interface FeatureDeviation { feature: string; unit: string; value: number; median: number; scale: number; z: number }

export interface AnomalyEvent {
  event_id: string; asset_id: string; primary_sensor_id: string; deviations: FeatureDeviation[];
  onset_window: number; onset_time: string; detected_window: number; detected_time: string; last_window: number;
  last_time: string; persistence_count: number; persistence_required: number; persistence_window: number;
  corroborating_sensors: string[]; data_quality: { passed: boolean; checked_windows: number; issues: string[] };
  change_point_window: number | null; change_point_time: string | null; method: string; z_threshold: number;
  window_minutes: number; baseline_version: string; scenario_seed: number; run_id: string; input_hash: string;
  owner_criterion: { configured: boolean; exceeded: boolean; kind: string | null; label: string; value: number | null; limit: number | null };
  detection_params: Record<string, unknown>; note: string;
}

export interface EvidenceRef {
  ref_id: string; kind: string; source_id: string; title: string; summary: string; timestamp: string | null;
  simulated: true; data: Record<string, unknown>;
}
export interface Claim { text: string; kind: "observation" | "hypothesis"; refs: string[] }
export interface Hypothesis {
  key: string; title: string; label: string; support: "strong" | "moderate" | "weak" | "insufficient";
  support_points: number; rank: number; evidence_for: Claim[]; evidence_against: Claim[];
}
export interface ToolCall { name: string; args: Record<string, unknown>; result_summary: string; result_count: number; duration_ms: number }
export interface Narrative { summary: string; key_points: string[]; citations: string[]; source: string; fallback_reason: string | null; model: string | null }
export interface Investigation {
  event_id: string; asset_id: string; observations: Claim[]; hypotheses: Hypothesis[]; missing_evidence: string[];
  evidence_refs: EvidenceRef[]; narrative: Narrative; tool_calls: ToolCall[]; rules_version: string;
}
export interface TriageFactor { name: string; observed: string; points: number; rule: string }
export interface Triage {
  priority: string; priority_label: string; timeframe: string; demonstration_triage_score: number; score_formula: string;
  factors: TriageFactor[]; escalation_required: boolean; escalation_basis: string; insufficient_evidence: boolean;
  insufficient_evidence_reason: string | null; recommended_first_action: string; rules_version: string; disclaimer: string;
  _reason: string; _window: number; _sim_time: string;
}
export interface PlanStep { order: number; action: string; rationale: string; refs: string[] }
export interface WorkOrder {
  work_order_id: string; incident_id: string; asset_id: string; priority: string; timeframe: string; reason: string;
  steps: PlanStep[]; required_evidence: string[]; status: string; assigned_to: string | null; plan_text: Narrative; label: string;
}
export interface Approval {
  approval_id: string; decision: string; actor: string; role: string; note: string; edits: Record<string, unknown> | null;
  timestamp: string; sim_time: string; work_order_id: string;
}
export interface VerificationMetric {
  feature: string; sensor_id: string; baseline_median: number; baseline_scale: number; pre_median_z: number | null;
  post_median_z: number | null; post_fraction_exceeding: number | null; pre_windows: number; post_windows_total: number;
  post_windows_valid: number; z_threshold: number;
}
export interface Verification {
  follow_up_set: string; outcome: "persists" | "improves" | "cannot_assess"; outcome_label: string;
  metrics: VerificationMetric[]; reasoning: string[]; incident_status: string; disclaimer: string; _id: string; _sim_time: string;
}
export interface AgentRun {
  run_key: string; agent: string; status: string; started_at: string; finished_at: string; duration_ms: number;
  tool_calls: ToolCall[]; fallback_used: boolean; fallback_reason: string | null; output: unknown;
}
export interface IncidentDetail {
  incident: { incident_id: string; asset_id: string; run_id: string; state: string; status_text: string; escalation: number; closed: number; scenario_seed: number; baseline_version: string; created_at: string };
  state_text: string; allowed_transitions: string[]; follow_up_allowed: boolean;
  event: AnomalyEvent; investigation: Investigation | null; triage: Triage[]; work_orders: WorkOrder[];
  approvals: Approval[]; verifications: Verification[]; agent_runs: AgentRun[]; audit: AuditRow[];
  workflow_inputs: Record<string, unknown>; baseline: Baseline | null;
  asset: { asset_id: string; name: string; type: string }; is_current_run: boolean;
}

export interface FeatureBaseline {
  sensor_id: string; feature: string; unit: string; median: number; mad: number; scale: number; n: number;
  p05: number; p95: number; zero_mad_fallback: boolean; fallback_detail: string;
}
export interface Baseline {
  asset_id: string; version: string; status: string; reference_reviewed: boolean;
  reference_period: { start: string; end: string; reviewed: boolean; reviewed_by: string | null; note: string };
  computed_from_windows: number; features: FeatureBaseline[];
  temp_models: { sensor_id: string; temperature_sensor_id: string; intercept: number; slope_per_degC: number; n: number; temp_min: number; temp_max: number }[];
  detection: Record<string, unknown> & { z_threshold: number; persistence_windows: number; min_exceedances: number; window_minutes: number; method: string };
  config_hash: string; insufficient_sensors: string[]; notes: string[];
}

export interface SensorConfig {
  sensor_id: string; asset_id: string; kind: string; location: string; sampling_rate_hz: number; features: string[];
  units: Record<string, string>; detection_features: string[]; primary: boolean; schematic: { x: number; y: number; label: string } | null;
}
export interface AssetConfig {
  asset_id: string; name: string; type: string; location_text: string; criticality: string; description: string;
  sensors: SensorConfig[]; reference_period: Baseline["reference_period"]; detection: Baseline["detection"]; thresholds: Threshold[];
}
export interface AssetDetail {
  config: AssetConfig; baseline: Baseline; summary: AssetSummary;
  records: Record<string, { id: string; date: string; title: string; text: string; category: string }[]>;
  feature_labels: Record<string, string>;
}

export interface SeriesPoint { i: number; t: string; v: number | null; z: number | null; q: string; qd?: string; x?: boolean; phase?: string; incident_id?: string }
export interface Series {
  asset_id: string; sensor_id: string; feature: string; label: string; unit: string;
  baseline: (FeatureBaseline & { band_lo: number; band_hi: number }) | null;
  detection: { z_threshold: number; persistence_windows: number; min_exceedances: number; window_minutes: number };
  reference_end_index: number; points: SeriesPoint[];
  incidents: { incident_id: string; state: string; onset_window: number; detected_window: number; last_window: number; onset_time: string; primary_sensor_id: string }[];
  follow_up: SeriesPoint[]; transients: { sensor_id: string; window_index: number; t_start: string; feature: string; z: number; reason: string }[];
  thresholds: Threshold[]; threshold_label: string | null; is_detection_feature: boolean;
}
