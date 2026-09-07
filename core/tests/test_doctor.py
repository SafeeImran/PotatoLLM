"""Tests for Potato Doctor (spec section 55) — every check must reflect a
real probe, never a hardcoded pass."""
from __future__ import annotations

from potato_core.engines import doctor as doctor_engine


def test_run_diagnostics_returns_all_expected_checks():
    result = doctor_engine.run_diagnostics()
    names = {c["name"] for c in result["checks"]}
    assert names == {
        "Python", "GPU", "CUDA", "llama.cpp", "Model Directory Writable", "Storage", "Fine-tuning Dependencies",
    }


def test_run_diagnostics_every_check_has_a_valid_status():
    result = doctor_engine.run_diagnostics()
    for check in result["checks"]:
        assert check["status"] in ("pass", "warn", "fail")
        assert check["message"]  # never an empty explanation


def test_python_check_always_passes_since_we_are_running_python():
    result = doctor_engine.run_diagnostics()
    python_check = next(c for c in result["checks"] if c["name"] == "Python")
    assert python_check["status"] == "pass"
    import sys

    assert sys.version.split()[0] in python_check["message"]


def test_model_directory_check_reflects_a_real_writability_probe(tmp_path, monkeypatch):
    from types import SimpleNamespace

    from potato_core.engines.doctor import service as doctor_service

    # Settings is a frozen dataclass and models_dir is a derived @property —
    # neither can be monkeypatched directly, so swap the module's `settings`
    # reference for a minimal stand-in exposing just what this check reads.
    monkeypatch.setattr(doctor_service, "settings", SimpleNamespace(models_dir=tmp_path / "models"))
    result = doctor_service._check_model_directory_writable()
    assert result["status"] == "pass"
    # The probe file must not be left behind.
    assert list((tmp_path / "models").iterdir()) == []


def test_llama_cpp_check_reflects_whether_the_real_binary_exists():
    from potato_core.engines.doctor import service as doctor_service
    from potato_core.config import settings

    result = doctor_service._check_llama_cpp()
    if settings.llama_server_executable.exists():
        assert result["status"] == "pass"
    else:
        assert result["status"] == "fail"
        assert result["fix"] is not None


def test_finetune_deps_check_matches_the_real_import_check():
    from potato_core.engines.doctor import service as doctor_service
    from potato_core.engines.training.dependencies import check_ml_dependencies

    result = doctor_service._check_finetune_deps()
    deps = check_ml_dependencies()
    assert result["status"] == ("pass" if deps["available"] else "warn")


def test_all_pass_and_has_failures_are_computed_correctly():
    result = doctor_engine.run_diagnostics()
    statuses = [c["status"] for c in result["checks"]]
    assert result["all_pass"] == all(s == "pass" for s in statuses)
    assert result["has_failures"] == any(s == "fail" for s in statuses)


def test_storage_check_reflects_real_disk_usage():
    from potato_core.engines.doctor import service as doctor_service
    import shutil
    from potato_core.config import settings

    result = doctor_service._check_storage()
    real_free_gb = shutil.disk_usage(settings.data_dir).free / (1024**3)
    assert f"{real_free_gb:.1f}" in result["message"] or result["status"] in ("warn", "fail")
