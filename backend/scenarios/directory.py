"""Fictional demo teams, officers and demo users. These are NOT real people or credentials: the app has no
authentication, the acting user is a demo selection, and roles are enforced by the backend on every action."""
from __future__ import annotations

TEAMS = [
    {"id": "bridge-inspection", "name": "Bridge Inspection Team (demo)",
     "people": ["R. Menon (demo officer)", "S. Gupta (demo officer)"]},
    {"id": "structural-maintenance", "name": "Structural Maintenance Crew (demo)",
     "people": ["T. Nair (demo officer)", "P. Das (demo officer)"]},
    {"id": "instrumentation", "name": "Monitoring & Instrumentation Team (demo)",
     "people": ["A. Khan (demo officer)"]},
]

DEMO_USERS = [
    {"name": "A. Rao (demo engineer)", "role": "engineer"},
    {"name": "K. Iyer (demo asset owner)", "role": "asset_owner"},
    *[{"name": person, "role": "maintenance"} for t in TEAMS for person in t["people"]],
    {"name": "Guest viewer (demo)", "role": "viewer"},
]


def team_by_name(name: str) -> dict | None:
    return next((t for t in TEAMS if t["name"] == name), None)


def valid_assignment(team: str, person: str) -> bool:
    t = team_by_name(team)
    return bool(t and person in t["people"])
