"""Settings Engine (spec section 32) — real, validated, persisted preferences.

Reads and writes the `application_settings` table through the typed registry
in registry.py. Two rules hold this together:

1. **Unknown keys are rejected.** A setting the app doesn't consume can't be
   stored, so the Settings UI can never show a control that does nothing.
2. **Reads always resolve.** `get()` falls back to the registry default when a
   row doesn't exist (or holds a value that no longer validates), so every
   consumer can call it unconditionally without a None check.

Consumers deliberately call `get()` at the point of use rather than caching a
snapshot — a settings change takes effect on the next generation/download/scan
without restarting Potato Core.
"""
from __future__ import annotations

from typing import Any

from potato_core.db.base import get_session
from potato_core.db.models import ApplicationSetting
from potato_core.engines.settings.registry import BY_KEY, DEFINITIONS, SECTIONS, SettingDefinition


class SettingsError(ValueError):
    """Raised for an unknown key or a value that fails the registry's constraints."""


def definitions() -> list[dict]:
    """The user-facing schema, ordered by section then declaration order — the
    Settings page renders straight off this rather than hardcoding a control per
    key. Hidden (internal) settings are omitted; they still resolve through
    `get()`/`get_all()` like any other key."""
    order = {section: i for i, section in enumerate(SECTIONS)}
    visible = [d for d in DEFINITIONS if not d.hidden]
    ordered = sorted(visible, key=lambda d: order.get(d.section, len(order)))
    return [d.to_dict() for d in ordered]


def coerce(definition: SettingDefinition, value: Any) -> Any:
    """Validates and normalizes a raw value against its definition.

    JSON gives us no int/float distinction and the HTTP layer hands us whatever
    the UI sent, so coercion happens here — once — instead of in every consumer.
    """
    if definition.type == "bool":
        if not isinstance(value, bool):
            raise SettingsError(f"'{definition.key}' expects true or false, got {value!r}")
        return value

    if definition.type in ("int", "float"):
        # bool is an int subclass in Python; a checkbox value must not silently
        # become the number 1 for a numeric setting.
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise SettingsError(f"'{definition.key}' expects a number, got {value!r}")
        number = int(value) if definition.type == "int" else float(value)
        if definition.type == "int" and float(value) != number:
            raise SettingsError(f"'{definition.key}' expects a whole number, got {value!r}")
        if definition.minimum is not None and number < definition.minimum:
            raise SettingsError(f"'{definition.key}' must be at least {definition.minimum}, got {number}")
        if definition.maximum is not None and number > definition.maximum:
            raise SettingsError(f"'{definition.key}' must be at most {definition.maximum}, got {number}")
        return number

    if definition.type == "enum":
        if value not in definition.options:
            raise SettingsError(f"'{definition.key}' must be one of {definition.options}, got {value!r}")
        return value

    if definition.type == "string":
        if not isinstance(value, str):
            raise SettingsError(f"'{definition.key}' expects text, got {value!r}")
        return value

    raise SettingsError(f"Setting '{definition.key}' has unsupported type '{definition.type}'")


def _definition(key: str) -> SettingDefinition:
    definition = BY_KEY.get(key)
    if definition is None:
        raise SettingsError(f"Unknown setting '{key}'")
    return definition


def get(key: str) -> Any:
    """The effective value for `key` — the stored one if it's still valid,
    otherwise the registry default. Never raises for a stored value that has
    gone stale (e.g. bounds tightened in a later release); it falls back."""
    definition = _definition(key)
    with get_session() as session:
        row = session.get(ApplicationSetting, key)
        if row is None or not isinstance(row.value_json, dict) or "value" not in row.value_json:
            return definition.default
        try:
            return coerce(definition, row.value_json["value"])
        except SettingsError:
            return definition.default


def get_all() -> dict[str, dict]:
    """Every registry key with its effective value, in the `{key: {"value": ...}}`
    shape the UI's settings client expects."""
    with get_session() as session:
        stored = {row.key: row.value_json for row in session.query(ApplicationSetting).all()}

    resolved: dict[str, dict] = {}
    for definition in DEFINITIONS:
        raw = stored.get(definition.key)
        value = definition.default
        if isinstance(raw, dict) and "value" in raw:
            try:
                value = coerce(definition, raw["value"])
            except SettingsError:
                value = definition.default
        resolved[definition.key] = {"value": value, "is_default": value == definition.default}
    return resolved


def set_value(key: str, value: Any) -> Any:
    """Validates, persists, and applies a setting. Returns the coerced value."""
    definition = _definition(key)
    coerced = coerce(definition, value)

    with get_session() as session:
        row = session.get(ApplicationSetting, key)
        if row is None:
            session.add(ApplicationSetting(key=key, value_json={"value": coerced}))
        else:
            row.value_json = {"value": coerced}

    _apply_side_effects(key, coerced)
    return coerced


def reset(key: str | None = None) -> dict[str, dict]:
    """Deletes stored overrides so the registry defaults take effect again.
    `key=None` resets everything."""
    if key is not None:
        _definition(key)  # reject unknown keys before touching the DB

    # "Reset all" means the user's preferences, not internal state — clearing
    # onboarding_complete would drop them back into the first-run scan.
    resettable = [key] if key is not None else [d.key for d in DEFINITIONS if not d.hidden]

    with get_session() as session:
        for row in session.query(ApplicationSetting).filter(ApplicationSetting.key.in_(resettable)).all():
            session.delete(row)

    for reset_key in resettable:
        _apply_side_effects(reset_key, BY_KEY[reset_key].default)
    return get_all()


def apply_startup_settings() -> None:
    """Re-applies the settings that configure live process state. Called once
    from the app lifespan after migrations, since the values live in the
    database and can't be read before it exists."""
    _apply_side_effects("log_level", get("log_level"))


def _apply_side_effects(key: str, value: Any) -> None:
    """A few settings configure live process state, not just a value someone
    reads later. Those are applied here so a change lands immediately instead
    of at the next core start."""
    if key == "log_level":
        import logging

        # configure_logging() attaches Potato Core's handlers to this logger
        # (it deliberately does not propagate to the true root), so this is
        # the level that actually governs what reaches the log file.
        logging.getLogger("potato_core").setLevel(value)
