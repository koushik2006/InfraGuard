"""Shared helpers: every agent tool call is a real function call, timed and recorded."""
from __future__ import annotations

import time
from typing import Any, Callable

from backend.contracts import ToolCall


class ToolRecorder:
    def __init__(self) -> None:
        self.calls: list[ToolCall] = []

    def call(self, name: str, args: dict[str, Any], fn: Callable[[], Any],
             summarize: Callable[[Any], str] = lambda r: f"{len(r)} result(s)" if hasattr(r, "__len__") else "ok"):
        t0 = time.perf_counter()
        result = fn()
        dt = (time.perf_counter() - t0) * 1000
        count = len(result) if hasattr(result, "__len__") and not isinstance(result, (str, dict)) else 1
        self.calls.append(ToolCall(name=name, args=args, result_summary=summarize(result),
                                   result_count=count, duration_ms=round(dt, 3)))
        return result


class EvidenceBook:
    """Allocates stable evidence IDs (E01, E02, ...) in retrieval order."""

    def __init__(self) -> None:
        self.refs: list = []
        self._by_source: dict[str, str] = {}

    def add(self, **kw) -> str:
        from backend.contracts import EvidenceRef
        key = f"{kw['kind']}:{kw['source_id']}"
        if key in self._by_source:
            return self._by_source[key]
        ref_id = f"E{len(self.refs) + 1:02d}"
        self.refs.append(EvidenceRef(ref_id=ref_id, **kw))
        self._by_source[key] = ref_id
        return ref_id
