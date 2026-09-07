"""Potato Doctor (spec section 55) — real diagnostic checks, each backed by
an actual probe (hardware detection, a real file-existence/writability
check, a real Python import check). No check here is a static "OK" —
every result reflects this machine's real current state.
"""
from __future__ import annotations

import shutil
import sys
import uuid

from potato_core.config import settings
from potato_core.engines import settings as app_settings
from potato_core.engines.hardware import service as hardware_service
from potato_core.engines.training.dependencies import check_ml_dependencies


def _check(name: str, status: str, message: str, fix: str | None = None) -> dict:
    return {"name": name, "status": status, "message": message, "fix": fix}


def _check_gpu() -> dict:
    profile = hardware_service.get_latest_profile()
    if profile is None:
        return _check("GPU", "warn", "No hardware scan yet.", "Run a hardware scan from the Hardware page.")
    gpu = profile.snapshot.gpu
    if gpu.vendor == "None detected" or gpu.vram_mb is None:
        return _check("GPU", "warn", "No dedicated GPU detected — CPU-only inference will be slower.", None)
    return _check("GPU", "pass", f"{gpu.model} ({gpu.vram_mb / 1024:.1f} GB VRAM)")


def _check_cuda() -> dict:
    profile = hardware_service.get_latest_profile()
    if profile is None:
        return _check("CUDA", "warn", "No hardware scan yet.", "Run a hardware scan from the Hardware page.")
    backend = profile.snapshot.compute_backend
    if backend == "CUDA":
        return _check("CUDA", "pass", f"Driver {profile.snapshot.gpu.driver_version}")
    return _check("CUDA", "warn", f"Compute backend is '{backend}', not CUDA — GPU acceleration unavailable.", None)


def _check_python() -> dict:
    return _check("Python", "pass", f"{sys.version.split()[0]} ({sys.executable})")


def _check_llama_cpp() -> dict:
    try:
        exe = settings.llama_server_executable
    except RuntimeError as exc:
        return _check("llama.cpp", "fail", str(exc), "This platform isn't supported by the vendored binary yet.")
    if exe.exists():
        return _check("llama.cpp", "pass", f"Found at {exe}")
    return _check(
        "llama.cpp", "fail", f"Not found at {exe}",
        "See DEVELOPMENT.md's 'Inference engine (llama.cpp)' section to fetch it.",
    )


def _check_model_directory_writable() -> dict:
    settings.models_dir.mkdir(parents=True, exist_ok=True)
    probe = settings.models_dir / f".potato-doctor-probe-{uuid.uuid4().hex[:8]}"
    try:
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        return _check("Model Directory Writable", "pass", str(settings.models_dir))
    except OSError as exc:
        return _check(
            "Model Directory Writable", "fail", f"{settings.models_dir}: {exc}",
            "Check folder permissions or change the model directory in Settings.",
        )


def _check_storage() -> dict:
    """Real free space on the data directory's drive, judged against the
    user's own thresholds (Settings -> Storage) rather than fixed numbers —
    "low" means something different on a 256GB laptop than a 4TB workstation."""
    usage = shutil.disk_usage(settings.data_dir)
    free_gb = usage.free / (1024**3)
    critical_gb = app_settings.get("low_disk_critical_gb")
    warning_gb = app_settings.get("low_disk_warning_gb")
    if free_gb < critical_gb:
        return _check(
            "Storage", "fail", f"Only {free_gb:.1f} GB free.",
            "Free up disk space — models and builds need room. The Storage page can delete unused models.",
        )
    if free_gb < warning_gb:
        return _check(
            "Storage", "warn", f"{free_gb:.1f} GB free — getting low for larger models.",
            "Review what's on disk from the Storage page.",
        )
    return _check("Storage", "pass", f"{free_gb:.1f} GB free")


def _check_finetune_deps() -> dict:
    deps = check_ml_dependencies()
    if deps["available"]:
        return _check("Fine-tuning Dependencies", "pass", "PyTorch, Transformers, PEFT, and TRL are installed.")
    return _check(
        "Fine-tuning Dependencies", "warn",
        f"Missing: {', '.join(deps['missing'])} — real training won't run without them.",
        deps["install_hint"],
    )


def run_diagnostics() -> dict:
    checks = [
        _check_python(),
        _check_gpu(),
        _check_cuda(),
        _check_llama_cpp(),
        _check_model_directory_writable(),
        _check_storage(),
        _check_finetune_deps(),
    ]
    return {
        "checks": checks,
        "all_pass": all(c["status"] == "pass" for c in checks),
        "has_failures": any(c["status"] == "fail" for c in checks),
    }
