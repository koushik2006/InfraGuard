import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.contracts import RunConfig  # noqa: E402
from backend.db.database import Database  # noqa: E402
from backend.orchestrator.engine import Engine  # noqa: E402
from backend.scenarios.assets import DEFAULT_VARIANTS  # noqa: E402
from backend.version import SCENARIO_ID  # noqa: E402


def make_run(seed=4242, **variants):
    v = dict(DEFAULT_VARIANTS)
    v.update(variants)
    return RunConfig(scenario_id=SCENARIO_ID, seed=seed, variants=v)


@pytest.fixture()
def engine():
    return Engine(Database(":memory:"))
