"""Real ModelRegistry implementation — data-driven from registry_data.py,
persisted to the `models` table so the rest of the app (builds, jobs,
adapters) can foreign-key against it like any other entity.
"""
from __future__ import annotations

from potato_core.db.base import get_session
from potato_core.db.models import Model
from potato_core.engines.models.registry_data import CURATED_MODELS
from potato_core.logging_config import get_logger

log = get_logger("models.registry")


def seed_models() -> None:
    """Idempotent upsert of the curated catalog — safe to call on every startup.

    Updates existing rows too (not just inserts), so a metadata correction
    or a newly added field (e.g. download_url) reaches DBs that were seeded
    before the change, rather than leaving them stuck with stale/blank data.
    """
    with get_session() as session:
        existing = {row.id: row for row in session.query(Model).all()}
        added = 0
        updated = 0
        for data in CURATED_MODELS:
            row = existing.get(data["id"])
            if row is None:
                session.add(Model(**data))
                added += 1
                continue
            changed = False
            for key, value in data.items():
                if getattr(row, key) != value:
                    setattr(row, key, value)
                    changed = True
            if changed:
                updated += 1
        if added:
            log.info("Seeded %d new curated model(s)", added)
        if updated:
            log.info("Updated %d existing curated model(s)", updated)


def list_models(family: str | None = None, query: str | None = None) -> list[Model]:
    with get_session() as session:
        rows = session.query(Model).order_by(Model.name).all()
        session.expunge_all()

    if family:
        rows = [m for m in rows if m.family.lower() == family.lower()]
    if query:
        needle = query.lower()
        rows = [
            m
            for m in rows
            if needle in m.name.lower() or needle in m.description.lower() or any(needle in t.lower() for t in m.tags)
        ]
    return rows


def get_model(model_id: str) -> Model | None:
    with get_session() as session:
        row = session.get(Model, model_id)
        if row is not None:
            session.expunge(row)
        return row
