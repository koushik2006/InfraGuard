"""Pydantic contracts for every agent input/output and every persisted object.

Agents exchange these validated objects, never free text. Every object that
leaves an agent is validated against its model before it is persisted.
"""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

# --------------------------------------------------------------------------
# Vocabulary
# --------------------------------------------------------------------------
AssetStatus = Literal["No anomaly detected", "Investigate", "Data unavailable", "Escalation required"]
QualityStatus = Literal["ok", "missing", "stale", "frozen", "implausible"]
BaselineStatus = Literal["provisional", "validated", "insufficient_data"]
SupportLevel = Literal["strong", "moderate", "weak", "insufficient"]
ClaimKind = Literal["observation", "hypothesis"]
HypothesisKey = Literal["sensor_fault", "environmental_or_load", "structural_behaviour_change"]
Priority = Literal["P1", "P2", "P3", "P4"]
VerificationOutcome = Literal["persists", "improves", "cannot_assess"]
AgentName = Literal["sentinel", "investigator", "prioritiser", "planner", "verifier"]
AgentStatus = Literal["idle", "running", "done", "fallback_used", "error"]
WorkOrderStatus = Literal["proposed", "approved", "rejected", "assigned", "in_progress", "completed"]
FollowUpSet = Literal["persists", "improves", "insufficient"]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# --------------------------------------------------------------------------
# Asset configuration
# --------------------------------------------------------------------------
class SchematicPoint(Strict):
    x: float
    y: float
    label: str


class SensorConfig(Strict):
    sensor_id: str
    asset_id: str
    kind: Literal["accelerometer", "tiltmeter", "crackmeter", "temperature"]
    location: str
    sampling_rate_hz: float
    features: list[str]
    units: dict[str, str]
    detection_features: list[str] = Field(default_factory=list)
    primary: bool = False
    schematic: Optional[SchematicPoint] = None


class EngineeringThreshold(Strict):
    sensor_id: str
    feature: str
    limit: float
    direction: Literal["above", "below", "abs_above"]
    kind: Literal["owner_criterion", "demo_criterion"]
    label: str
    source: str


class ReferencePeriod(Strict):
    start: str
    end: str
    reviewed: bool
    reviewed_by: Optional[str] = None
    note: str


class DetectionParams(Strict):
    method: Literal["robust_z"] = "robust_z"
    z_threshold: float
    persistence_windows: int
    min_exceedances: int
    window_minutes: int
    min_reference_windows: int
    temperature_compensation: bool = False
    temperature_sensor_id: Optional[str] = None
    slope_window: int = 12
    frozen_windows: int = 3
    stale_after_windows: int = 2
    min_scale: dict[str, float] = Field(default_factory=dict)
    plausible_range: dict[str, tuple[float, float]] = Field(default_factory=dict)


class AssetConfig(Strict):
    asset_id: str
    name: str
    type: Literal["bridge", "building", "retaining_wall"]
    location_text: str
    criticality: Literal["high", "medium", "low"]
    description: str
    sensors: list[SensorConfig]
    reference_period: ReferencePeriod
    detection: DetectionParams
    thresholds: list[EngineeringThreshold] = Field(default_factory=list)
    simulated: Literal[True] = True


# --------------------------------------------------------------------------
# Readings / baselines / detection
# --------------------------------------------------------------------------
class QualityFlag(Strict):
    status: QualityStatus
    detail: str = ""


class WindowFeature(Strict):
    asset_id: str
    sensor_id: str
    window_index: int
    t_start: str
    t_end: str
    phase: Literal["reference", "monitoring", "follow_up"]
    features: dict[str, Optional[float]]
    quality: QualityFlag


class FeatureBaseline(Strict):
    sensor_id: str
    feature: str
    unit: str
    median: float
    mad: float
    scale: float
    n: int
    p05: float
    p95: float
    zero_mad_fallback: bool = False
    fallback_detail: str = ""


class TempModel(Strict):
    sensor_id: str
    temperature_sensor_id: str
    intercept: float
    slope_per_degC: float
    n: int
    temp_min: float
    temp_max: float


class BaselineConfig(Strict):
    asset_id: str
    version: str
    status: BaselineStatus
    reference_reviewed: bool
    reference_period: ReferencePeriod
    computed_from_windows: int
    features: list[FeatureBaseline]
    temp_models: list[TempModel] = Field(default_factory=list)
    detection: DetectionParams
    config_hash: str
    insufficient_sensors: list[str] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
    simulated: Literal[True] = True


class FeatureDeviation(Strict):
    feature: str
    unit: str
    value: float
    median: float
    scale: float
    z: float


class OwnerCriterionCheck(Strict):
    configured: bool
    exceeded: bool
    kind: Optional[str] = None
    label: str
    value: Optional[float] = None
    limit: Optional[float] = None


class DataQualityGate(Strict):
    passed: bool
    checked_windows: int
    issues: list[str] = Field(default_factory=list)


class AnomalyEvent(Strict):
    event_id: str
    asset_id: str
    primary_sensor_id: str
    deviations: list[FeatureDeviation]
    onset_window: int
    onset_time: str
    detected_window: int
    detected_time: str
    last_window: int
    last_time: str
    persistence_count: int
    persistence_required: int
    persistence_window: int
    corroborating_sensors: list[str]
    data_quality: DataQualityGate
    change_point_window: Optional[int] = None
    change_point_time: Optional[str] = None
    method: str
    z_threshold: float
    window_minutes: int
    baseline_version: str
    detection_params: DetectionParams
    owner_criterion: OwnerCriterionCheck
    scenario_seed: int
    run_id: str
    input_hash: str
    note: str = "Anomaly indicator relative to this asset's own baseline. Not a failure probability."


# --------------------------------------------------------------------------
# Investigation
# --------------------------------------------------------------------------
class EvidenceRef(Strict):
    ref_id: str
    kind: Literal[
        "reading_window", "baseline", "maintenance_record", "inspection_note",
        "environment_record", "sensor_health", "prior_event",
    ]
    source_id: str
    title: str
    summary: str
    timestamp: Optional[str] = None
    simulated: Literal[True] = True
    data: dict[str, Any] = Field(default_factory=dict)


class Claim(Strict):
    text: str
    kind: ClaimKind
    refs: list[str] = Field(min_length=1)


class Hypothesis(Strict):
    key: HypothesisKey
    title: str
    label: Literal["hypothesis"] = "hypothesis"
    support: SupportLevel
    support_points: int
    rank: int
    evidence_for: list[Claim]
    evidence_against: list[Claim]


class ToolCall(Strict):
    name: str
    args: dict[str, Any]
    result_summary: str
    result_count: int = 0
    duration_ms: float = 0.0


class NarrativeDraft(Strict):
    summary: str
    key_points: list[str]
    citations: list[str]
    source: Literal["llm", "deterministic_fallback"]
    fallback_reason: Optional[str] = None
    model: Optional[str] = None


class InvestigationResult(Strict):
    event_id: str
    asset_id: str
    observations: list[Claim]
    hypotheses: list[Hypothesis]
    missing_evidence: list[str]
    evidence_refs: list[EvidenceRef]
    narrative: NarrativeDraft
    tool_calls: list[ToolCall]
    rules_version: str


# --------------------------------------------------------------------------
# Triage / planning / approval / verification
# --------------------------------------------------------------------------
class TriageFactor(Strict):
    name: str
    observed: str
    points: int
    rule: str


class TriageResult(Strict):
    event_id: str
    asset_id: str
    priority: Priority
    priority_label: str
    timeframe: str
    demonstration_triage_score: int
    score_formula: str
    factors: list[TriageFactor]
    escalation_required: bool
    escalation_basis: str
    insufficient_evidence: bool
    insufficient_evidence_reason: Optional[str] = None
    recommended_first_action: str
    rules_version: str
    disclaimer: str = (
        "Decision support: an inspection-priority recommendation for a qualified engineer. "
        "Not a structural-safety assessment."
    )


class PlanStep(Strict):
    order: int
    action: str
    rationale: str
    refs: list[str] = Field(default_factory=list)


class WorkOrderDraft(Strict):
    work_order_id: str
    incident_id: str
    asset_id: str
    priority: Priority
    timeframe: str
    reason: str
    steps: list[PlanStep]
    required_evidence: list[str]
    status: WorkOrderStatus = "proposed"
    assigned_to: Optional[str] = None
    plan_text: NarrativeDraft
    label: str = "Proposal: requires human review"


class ApprovalRequest(Strict):
    decision: Literal["approve", "reject", "edit_approve"]
    actor: str
    role: Literal["viewer", "engineer", "asset_owner"]
    note: str = ""
    edits: Optional[dict[str, Any]] = None


class ApprovalRecord(Strict):
    approval_id: str
    incident_id: str
    work_order_id: str
    decision: Literal["approve", "reject", "edit_approve"]
    actor: str
    role: str
    note: str
    edits: Optional[dict[str, Any]] = None
    timestamp: str
    sim_time: str


class VerificationMetrics(Strict):
    feature: str
    sensor_id: str
    baseline_median: float
    baseline_scale: float
    pre_median_z: Optional[float]
    post_median_z: Optional[float]
    post_fraction_exceeding: Optional[float]
    pre_windows: int
    post_windows_total: int
    post_windows_valid: int
    z_threshold: float


class VerificationResult(Strict):
    incident_id: str
    asset_id: str
    follow_up_set: FollowUpSet
    outcome: VerificationOutcome
    outcome_label: str
    metrics: list[VerificationMetrics]
    reasoning: list[str]
    evidence_refs: list[str]
    incident_status: str
    keeps_incident_open: bool
    rules_version: str
    disclaimer: str = "Monitoring outcome only. This is not a structural-safety verdict."


class AgentRun(Strict):
    run_key: str
    incident_id: Optional[str]
    agent: AgentName
    status: AgentStatus
    started_at: str
    finished_at: Optional[str]
    duration_ms: Optional[float]
    input_summary: dict[str, Any]
    output: Optional[dict[str, Any]]
    tool_calls: list[ToolCall] = Field(default_factory=list)
    fallback_used: bool = False
    fallback_reason: Optional[str] = None
    error: Optional[str] = None


# --------------------------------------------------------------------------
# Simulation / what-if
# --------------------------------------------------------------------------
class Intervention(Strict):
    type: Literal["frozen_sensor", "stale_sensor"]
    sensor_id: str
    from_time: str
    label: str = ""


class RunConfig(Strict):
    scenario_id: str
    seed: int
    variants: dict[str, str]
    environment: Literal["nominal", "heatwave", "cold_snap"] = "nominal"
    interventions: list[Intervention] = Field(default_factory=list)
