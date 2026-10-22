"""Version identifiers recorded with every persisted result so replays are reproducible."""

SOFTWARE_VERSION = "infraguard-0.1.0"
DETECTOR_VERSION = "robust-z-persistence-1.0"
QUALITY_RULES_VERSION = "dq-rules-1.0"
TRIAGE_RULES_VERSION = "triage-rules-2026.10-r1"
VERIFIER_RULES_VERSION = "verify-rules-1.0"
INVESTIGATOR_RULES_VERSION = "hypothesis-rules-1.0"
FIXTURES_VERSION = "sim-fixtures-1.0"
SCENARIO_ID = "demo-v1"
DEFAULT_SEED = 4242


def versions() -> dict[str, str]:
    return {
        "software": SOFTWARE_VERSION,
        "detector": DETECTOR_VERSION,
        "quality_rules": QUALITY_RULES_VERSION,
        "triage_rules": TRIAGE_RULES_VERSION,
        "verifier_rules": VERIFIER_RULES_VERSION,
        "investigator_rules": INVESTIGATOR_RULES_VERSION,
        "fixtures": FIXTURES_VERSION,
    }
