"""The single LLM module. An LLM only ever DRAFTS TEXT (narratives, plan wording).

- Disabled by default (offline demo). Enable with INFRAGUARD_LLM=on and ANTHROPIC_API_KEY.
- Timeout, strict schema validation, one retry, then a deterministic fallback.
- Output is rejected if it cites evidence that was not supplied, or uses banned language
  (safety verdicts, collapse predictions, closure/evacuation orders).
"""
from __future__ import annotations

import os
import re
from typing import Callable, Optional

from pydantic import BaseModel, Field, ValidationError

from backend.contracts import NarrativeDraft

DEFAULT_MODEL = os.environ.get("INFRAGUARD_LLM_MODEL", "claude-opus-5-5")
TIMEOUT_S = float(os.environ.get("INFRAGUARD_LLM_TIMEOUT", "12"))

BANNED_PATTERNS = [
    r"\bsafe\b", r"\bunsafe\b", r"\bcollapse", r"probability of failure", r"failure probability",
    r"\bevacuat", r"\bclose the (bridge|building|road|wall|structure)", r"\bclosure\b",
    r"\bguarantee", r"\bcertif(y|ied)\b", r"\bresolved\b",
]


class LLMDraft(BaseModel):
    summary: str = Field(min_length=20, max_length=1200)
    key_points: list[str] = Field(min_length=1, max_length=6)
    citations: list[str] = Field(min_length=1)


class LLMUnavailable(Exception):
    pass


def banned_phrases(text: str) -> list[str]:
    return [p for p in BANNED_PATTERNS if re.search(p, text, flags=re.IGNORECASE)]


def llm_enabled() -> bool:
    return os.environ.get("INFRAGUARD_LLM", "off").lower() in ("on", "1", "true") and bool(
        os.environ.get("ANTHROPIC_API_KEY"))


def status() -> dict:
    return {"enabled": llm_enabled(), "model": DEFAULT_MODEL if llm_enabled() else None,
            "mode": "llm-drafting" if llm_enabled() else "deterministic (LLM off / offline)"}


def _anthropic_transport(system: str, prompt: str) -> LLMDraft:
    try:
        import anthropic
    except ImportError as e:  # pragma: no cover
        raise LLMUnavailable("anthropic SDK not installed") from e
    client = anthropic.Anthropic(timeout=TIMEOUT_S, max_retries=0)
    try:
        resp = client.messages.parse(
            model=DEFAULT_MODEL, max_tokens=2000, system=system,
            messages=[{"role": "user", "content": prompt}], output_format=LLMDraft,
        )
    except anthropic.APITimeoutError as e:
        raise TimeoutError(str(e)) from e
    except anthropic.APIError as e:
        raise LLMUnavailable(f"API error: {type(e).__name__}") from e
    if resp.stop_reason == "refusal" or resp.parsed_output is None:
        raise ValueError("model returned no parsable output")
    return resp.parsed_output


Transport = Callable[[str, str], object]
_transport_override: Optional[Transport] = None


def set_transport(t: Optional[Transport]) -> None:
    """Test hook: inject a fake transport (simulate timeouts / malformed output)."""
    global _transport_override
    _transport_override = t


def draft(task: str, facts: dict, allowed_citations: list[str],
          fallback: Callable[[], NarrativeDraft]) -> NarrativeDraft:
    """Ask the LLM for a wording draft; validate; retry once; otherwise deterministic fallback."""
    if _transport_override is None and not llm_enabled():
        fb = fallback()
        return fb.model_copy(update={"fallback_reason": "LLM disabled (offline mode)"})
    transport = _transport_override or _anthropic_transport
    system = (
        "You draft wording for an infrastructure-monitoring DECISION-SUPPORT tool. All data is SIMULATED. "
        "Only restate the supplied structured facts in plain language. Never state or imply a structure is "
        "safe or unsafe, never predict collapse or give failure probabilities, never recommend closures or "
        "evacuations. Label hypotheses as hypotheses. Cite only the evidence IDs supplied."
    )
    prompt = f"Task: {task}\nAllowed evidence IDs: {allowed_citations}\nFacts (JSON): {facts}"
    errors: list[str] = []
    for attempt in range(2):  # first try + one retry
        try:
            raw = transport(system, prompt)
            d = raw if isinstance(raw, LLMDraft) else LLMDraft.model_validate(raw)
            unknown = [c for c in d.citations if c not in allowed_citations]
            if unknown:
                raise ValueError(f"cited unknown evidence {unknown}")
            bad = banned_phrases(" ".join([d.summary, *d.key_points]))
            if bad:
                raise ValueError(f"banned language {bad}")
            return NarrativeDraft(summary=d.summary, key_points=d.key_points, citations=d.citations,
                                  source="llm", model=DEFAULT_MODEL)
        except (TimeoutError, ValidationError, ValueError, TypeError, LLMUnavailable) as e:
            errors.append(f"attempt {attempt + 1}: {type(e).__name__}: {str(e)[:160]}")
            if isinstance(e, LLMUnavailable):
                break
    fb = fallback()
    return fb.model_copy(update={"fallback_reason": " | ".join(errors)})
