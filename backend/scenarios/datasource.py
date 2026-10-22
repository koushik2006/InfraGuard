"""DataSource interface. The demo uses SimulatedDataSource only; a real dataset adapter could
implement the same three methods later (not built)."""
from __future__ import annotations

from datetime import datetime
from typing import Optional, Protocol

from backend.scenarios import generator
from backend.scenarios.fixtures import FIXTURES


class DataSource(Protocol):
    label: str

    def windows(self, seed: int, asset_id: str, variant: str, environment: str,
                interventions: Optional[list[dict]] = None) -> tuple[dict[str, list[dict]], list[dict]]: ...

    def follow_up(self, seed: int, asset_id: str, follow_up_set: str, start: datetime, n_windows: int,
                  environment: str, context: Optional[dict] = None) -> dict[str, list[dict]]: ...

    def records(self, asset_id: str) -> dict[str, list[dict]]: ...


class SimulatedDataSource:
    label = "SIMULATED scenario generator (seeded, deterministic)"

    def windows(self, seed, asset_id, variant, environment, interventions=None):
        return generator.generate(seed, asset_id, variant, environment, interventions)

    def follow_up(self, seed, asset_id, follow_up_set, start, n_windows, environment, context=None):
        return generator.generate_follow_up(seed, asset_id, follow_up_set, start, n_windows, environment, context)

    def records(self, asset_id):
        return {k: [dict(r, simulated=True) for r in v] for k, v in FIXTURES.get(asset_id, {}).items()}


_SOURCE: DataSource = SimulatedDataSource()


def get_datasource() -> DataSource:
    return _SOURCE
