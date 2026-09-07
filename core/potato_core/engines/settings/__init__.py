"""Settings Engine (spec section 32) — validated, persisted preferences.

Every key is declared in registry.py and consumed by real code; see
service.py for reads/writes.
"""
from potato_core.engines.settings.registry import DEFINITIONS, SECTIONS, SettingDefinition
from potato_core.engines.settings.service import (
    SettingsError,
    apply_startup_settings,
    definitions,
    get,
    get_all,
    reset,
    set_value,
)

__all__ = [
    "DEFINITIONS",
    "SECTIONS",
    "SettingDefinition",
    "SettingsError",
    "apply_startup_settings",
    "definitions",
    "get",
    "get_all",
    "reset",
    "set_value",
]
