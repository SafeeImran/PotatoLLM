"""Tests for the Settings Engine (spec section 32).

The engine's whole job is that a setting is typed, validated, persisted, and
actually read by something — so these tests check the validation boundaries and
then check that real consumers observe the stored value.
"""
from __future__ import annotations

import pytest

from potato_core.engines import settings as app_settings
from potato_core.engines.settings.registry import BY_KEY, DEFINITIONS, SECTIONS


@pytest.fixture(autouse=True)
def _clean_settings():
    def clear_all():
        app_settings.reset()
        app_settings.reset("onboarding_complete")  # hidden keys are skipped by reset-all

    clear_all()
    yield
    clear_all()


def test_every_definition_declares_what_it_actually_changes():
    # A setting with no named consumer is a switch that does nothing — the one
    # thing this registry exists to prevent.
    for definition in DEFINITIONS:
        assert definition.effect, f"'{definition.key}' does not say what it changes"
        assert definition.label and definition.description
        if not definition.hidden:
            assert definition.section in SECTIONS


def test_every_definition_default_passes_its_own_validation():
    for definition in DEFINITIONS:
        assert app_settings.service.coerce(definition, definition.default) == definition.default


def test_get_falls_back_to_the_registry_default_when_nothing_is_stored():
    assert app_settings.get("default_context_length") == BY_KEY["default_context_length"].default
    assert app_settings.get("usage_analytics_enabled") is True


def test_get_all_returns_every_key_with_a_default_flag():
    resolved = app_settings.get_all()
    assert set(resolved) == set(BY_KEY)
    assert all(entry["is_default"] for entry in resolved.values())

    app_settings.set_value("default_context_length", 8192)
    resolved = app_settings.get_all()
    assert resolved["default_context_length"] == {"value": 8192, "is_default": False}
    assert resolved["default_top_k"]["is_default"] is True


def test_set_value_persists_and_round_trips():
    app_settings.set_value("default_max_tokens", 1024)
    assert app_settings.get("default_max_tokens") == 1024


def test_unknown_keys_are_rejected():
    with pytest.raises(app_settings.SettingsError):
        app_settings.set_value("enable_warp_drive", True)
    with pytest.raises(app_settings.SettingsError):
        app_settings.get("enable_warp_drive")


def test_values_outside_the_declared_bounds_are_rejected():
    with pytest.raises(app_settings.SettingsError):
        app_settings.set_value("default_context_length", 0)
    with pytest.raises(app_settings.SettingsError):
        app_settings.set_value("default_context_length", 999_999)
    with pytest.raises(app_settings.SettingsError):
        app_settings.set_value("max_concurrent_downloads", 99)
    # ...and the boundaries themselves are accepted.
    assert app_settings.set_value("default_context_length", 512) == 512
    assert app_settings.set_value("default_temperature", 2.0) == 2.0


def test_wrong_types_are_rejected_rather_than_coerced():
    with pytest.raises(app_settings.SettingsError):
        app_settings.set_value("developer_mode", "yes")
    with pytest.raises(app_settings.SettingsError):
        app_settings.set_value("default_context_length", "8192")
    with pytest.raises(app_settings.SettingsError):
        app_settings.set_value("default_system_prompt", 42)
    # bool is an int subclass in Python; a checkbox value must not become a number.
    with pytest.raises(app_settings.SettingsError):
        app_settings.set_value("default_top_k", True)


def test_int_settings_reject_fractional_numbers():
    with pytest.raises(app_settings.SettingsError):
        app_settings.set_value("default_top_k", 12.5)
    assert app_settings.set_value("default_top_k", 12.0) == 12


def test_enum_settings_only_accept_declared_options():
    with pytest.raises(app_settings.SettingsError):
        app_settings.set_value("log_level", "VERBOSE")
    assert app_settings.set_value("log_level", "DEBUG") == "DEBUG"


def test_log_level_is_applied_to_the_live_logger():
    import logging

    app_settings.set_value("log_level", "ERROR")
    assert logging.getLogger("potato_core").level == logging.ERROR
    app_settings.set_value("log_level", "INFO")
    assert logging.getLogger("potato_core").level == logging.INFO


def test_reset_restores_a_single_key_without_touching_the_others():
    app_settings.set_value("default_top_k", 7)
    app_settings.set_value("default_max_tokens", 64)
    app_settings.reset("default_top_k")
    assert app_settings.get("default_top_k") == BY_KEY["default_top_k"].default
    assert app_settings.get("default_max_tokens") == 64


def test_reset_all_restores_every_default():
    app_settings.set_value("default_top_k", 7)
    app_settings.set_value("developer_mode", True)
    resolved = app_settings.reset()
    assert all(entry["is_default"] for entry in resolved.values())
    assert app_settings.get("developer_mode") is False


def test_a_stored_value_that_no_longer_validates_falls_back_instead_of_raising():
    # Simulates bounds tightening in a later release: the row survives, but a
    # read must not blow up every consumer that touches it.
    from potato_core.db.base import get_session
    from potato_core.db.models import ApplicationSetting

    with get_session() as session:
        session.add(ApplicationSetting(key="default_top_k", value_json={"value": 9999}))

    assert app_settings.get("default_top_k") == BY_KEY["default_top_k"].default
    assert app_settings.get_all()["default_top_k"]["is_default"] is True


def test_internal_settings_are_readable_but_never_offered_as_controls():
    keys = {d["key"] for d in app_settings.definitions()}
    assert "onboarding_complete" not in keys
    assert "developer_mode" in keys
    # Still a real, validated, persisted setting — App.tsx reads it to decide
    # whether to show the first-run hardware scan.
    assert app_settings.get("onboarding_complete") is False
    assert app_settings.set_value("onboarding_complete", True) is True
    assert app_settings.get_all()["onboarding_complete"]["value"] is True


def test_reset_all_leaves_internal_state_alone():
    # Resetting preferences must never drop the user back into onboarding.
    app_settings.set_value("onboarding_complete", True)
    app_settings.set_value("developer_mode", True)
    app_settings.reset()
    assert app_settings.get("developer_mode") is False
    assert app_settings.get("onboarding_complete") is True


def test_definitions_are_ordered_by_section_for_the_settings_page():
    sections = [d["section"] for d in app_settings.definitions()]
    seen: list[str] = []
    for section in sections:
        if section not in seen:
            seen.append(section)
    assert seen == [s for s in SECTIONS if s in seen]


# --------------------------------------------------------------------------
# Real consumers observe the stored value
# --------------------------------------------------------------------------


def test_generation_params_fall_back_to_the_configured_defaults():
    from potato_core.engines.inference import llama_cpp_backend

    app_settings.set_value("default_temperature", 0.15)
    app_settings.set_value("default_max_tokens", 77)

    payload = llama_cpp_backend._build_payload([{"role": "user", "content": "hi"}], {}, stream=False)
    assert payload["temperature"] == 0.15
    assert payload["max_tokens"] == 77

    # An explicit request param still wins over the default.
    payload = llama_cpp_backend._build_payload([], {"temperature": 1.5}, stream=False)
    assert payload["temperature"] == 1.5
    assert payload["max_tokens"] == 77


def test_usage_tracking_writes_nothing_when_the_privacy_setting_is_off():
    from potato_core.db.base import get_session
    from potato_core.db.models import UsageRecord
    from potato_core.engines import usage as usage_engine

    stats = {"prompt_tokens": 10, "completion_tokens": 20, "tokens_per_sec": 30.0, "ttft_ms": 100}

    app_settings.set_value("usage_analytics_enabled", False)
    with get_session() as session:
        before = session.query(UsageRecord).count()
    usage_engine.record_usage(None, stats)
    with get_session() as session:
        assert session.query(UsageRecord).count() == before

    app_settings.set_value("usage_analytics_enabled", True)
    usage_engine.record_usage(None, stats)
    with get_session() as session:
        assert session.query(UsageRecord).count() == before + 1

    usage_engine.clear_records()
    with get_session() as session:
        assert session.query(UsageRecord).count() == 0


def test_doctor_storage_check_uses_the_configured_thresholds(monkeypatch):
    import shutil
    from collections import namedtuple

    from potato_core.engines.doctor import service as doctor_service

    # A fixed 5 GB free, so the same disk reading can be judged against three
    # different user-configured threshold pairs. The real-disk behaviour of this
    # check is covered in test_doctor.py; what matters here is that the numbers
    # come from settings rather than being hardcoded.
    usage = namedtuple("usage", "total used free")(500 * 1024**3, 495 * 1024**3, 5 * 1024**3)
    monkeypatch.setattr(shutil, "disk_usage", lambda _path: usage)

    assert doctor_service._check_storage()["status"] == "warn"  # defaults: crit 2, warn 10

    app_settings.set_value("low_disk_critical_gb", 6.0)
    assert doctor_service._check_storage()["status"] == "fail"

    app_settings.set_value("low_disk_critical_gb", 2.0)
    app_settings.set_value("low_disk_warning_gb", 4.0)
    assert doctor_service._check_storage()["status"] == "pass"


def test_compatibility_estimates_use_the_configured_default_context():
    from potato_core.engines.hardware import service as hardware_service
    from potato_core.engines.models import seed_models
    from potato_core.engines.recommendation import service as recommendation_service

    seed_models()
    hardware_service.scan_and_persist()

    app_settings.set_value("default_context_length", 8192)
    with_8k = recommendation_service.recommend("qwen2.5-0.5b-instruct")
    app_settings.set_value("default_context_length", 4096)
    with_4k = recommendation_service.recommend("qwen2.5-0.5b-instruct")

    assert with_8k["recommended"]["context_length"] == 8192
    assert with_4k["recommended"]["context_length"] == 4096
    # A larger context really costs more estimated memory — the setting feeds
    # the fit math, it isn't just echoed back.
    assert with_8k["recommended"]["estimated_vram_mb"] >= with_4k["recommended"]["estimated_vram_mb"]
