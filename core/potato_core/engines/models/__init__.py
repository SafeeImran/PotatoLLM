"""Model Registry (spec section 11) — real, data-driven implementation.

Holds the 12 curated open-source models as metadata, not scattered across UI
components. See `registry_data.py` for the catalog and `service.py` for the
persistence-backed read API (`list_models`, `get_model`) and startup seeding
(`seed_models`).
"""
from potato_core.engines.models.service import get_model, list_models, seed_models

__all__ = ["get_model", "list_models", "seed_models"]
