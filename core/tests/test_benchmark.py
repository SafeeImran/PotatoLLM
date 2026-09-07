"""Tests for the real Benchmark Engine. Validation-only tests always run;
tests that actually run a generation through llama-server are skipped (not
failed) when the vendored binary or a real downloaded model isn't available
— see test_inference.py for the same pattern and why.
"""
from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from potato_core.config import settings
from potato_core.db.base import get_session
from potato_core.db.models import Benchmark, ModelArtifact
from potato_core.engines import benchmark as benchmark_engine
from potato_core.engines import inference as inference_engine
from potato_core.engines.benchmark.service import _summarize_samples
from potato_core.engines.models import seed_models

_REAL_DOWNLOADED_GGUF = (
    Path.home() / "AppData" / "Roaming" / "PotatoLLM" / "models" / "qwen2.5-0.5b-instruct"
    / "qwen2.5-0.5b-instruct-q4_k_m.gguf"
)


def test_summarize_samples_takes_peak_utilization_and_last_vram():
    samples = [
        {"cpu_util_pct": 10.0, "gpu_util_pct": 20.0, "vram_mb": 4000, "ram_mb": 8000, "temp_c": 50.0},
        {"cpu_util_pct": 90.0, "gpu_util_pct": 95.0, "vram_mb": 4200, "ram_mb": 8500, "temp_c": 62.0},
        {"cpu_util_pct": 30.0, "gpu_util_pct": 40.0, "vram_mb": 4200, "ram_mb": 8100, "temp_c": 58.0},
    ]
    summary = _summarize_samples(samples)
    assert summary["cpu_util_pct"] == 90.0
    assert summary["gpu_util_pct"] == 95.0
    assert summary["vram_mb"] == 4200  # last reading, not peak
    assert summary["ram_mb"] == 8500
    assert summary["temp_c"] == 62.0


def test_summarize_samples_handles_empty_list():
    summary = _summarize_samples([])
    assert summary == {"cpu_util_pct": None, "gpu_util_pct": None, "vram_mb": None, "ram_mb": None, "temp_c": None}


def test_summarize_samples_ignores_missing_fields():
    samples = [{"cpu_util_pct": None, "gpu_util_pct": 50.0, "vram_mb": None, "ram_mb": None, "temp_c": None}]
    summary = _summarize_samples(samples)
    assert summary["gpu_util_pct"] == 50.0
    assert summary["cpu_util_pct"] is None


def test_run_benchmark_for_unknown_artifact_raises():
    with pytest.raises(benchmark_engine.BenchmarkError, match="Unknown model artifact"):
        benchmark_engine.run_benchmark("does-not-exist")


def test_run_benchmark_for_unverified_artifact_raises():
    seed_models()
    with get_session() as session:
        artifact = ModelArtifact(
            model_id="tinyllama-1.1b-chat", format="gguf", quantization="Q4_K_M",
            file_path="C:\\nowhere.gguf", status="downloading",
        )
        session.add(artifact)
        session.flush()
        artifact_id = artifact.id

    with pytest.raises(benchmark_engine.BenchmarkError, match="not verified"):
        benchmark_engine.run_benchmark(artifact_id)


def test_list_benchmarks_filters_by_artifact():
    seed_models()
    with get_session() as session:
        session.add(Benchmark(model_artifact_id="artifact-a", tokens_per_sec=10.0))
        session.add(Benchmark(model_artifact_id="artifact-b", tokens_per_sec=20.0))

    results = benchmark_engine.list_benchmarks(model_artifact_id="artifact-a")
    assert len(results) >= 1
    assert all(b.model_artifact_id == "artifact-a" for b in results)


def test_get_benchmark_unknown_raises():
    with pytest.raises(benchmark_engine.BenchmarkError):
        benchmark_engine.get_benchmark("does-not-exist")


@pytest.fixture(scope="module")
def real_verified_artifact():
    if not settings.llama_server_executable.exists():
        pytest.skip("llama-server binary not vendored — see DEVELOPMENT.md")
    if not _REAL_DOWNLOADED_GGUF.exists():
        pytest.skip("no real downloaded GGUF available to test against")

    seed_models()
    target_dir = settings.models_dir / "qwen2.5-0.5b-instruct"
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / _REAL_DOWNLOADED_GGUF.name
    if not target.exists():
        shutil.copyfile(_REAL_DOWNLOADED_GGUF, target)

    with get_session() as session:
        artifact = ModelArtifact(
            model_id="qwen2.5-0.5b-instruct",
            format="gguf",
            quantization="Q4_K_M",
            file_path=str(target),
            size_bytes=target.stat().st_size,
            status="verified",
        )
        session.add(artifact)
        session.flush()
        artifact_id = artifact.id

    yield artifact_id
    inference_engine.unload_model()


def test_real_benchmark_produces_measured_stats_and_persists(real_verified_artifact):
    result = benchmark_engine.run_benchmark(real_verified_artifact, context_length=1024, prompt="Count to five.")

    # Measured, not estimated — must be real positive numbers from an actual run.
    assert result["tokens_per_sec"] > 0
    assert result["prompt_tokens_per_sec"] > 0
    assert result["ttft_seconds"] is not None and result["ttft_seconds"] >= 0
    assert result["total_latency_seconds"] > 0
    assert result["backend"] == "llama.cpp"
    assert result["context_length"] == 1024

    stored = benchmark_engine.get_benchmark(result["id"])
    assert stored.model_artifact_id == real_verified_artifact
    assert stored.tokens_per_sec == result["tokens_per_sec"]
    assert stored.is_measured is True


def test_real_benchmark_samples_real_hardware_during_the_run(real_verified_artifact):
    result = benchmark_engine.run_benchmark(real_verified_artifact, context_length=1024, prompt="Count to ten slowly.")
    # At least one sample must have been taken during the run — proves the
    # background sampler thread actually ran concurrently with generation,
    # not that it silently no-opped.
    assert result["sample_count"] >= 1


def test_real_benchmark_auto_loads_the_model_if_not_already_loaded(real_verified_artifact):
    inference_engine.unload_model()
    assert inference_engine.get_status()["loaded"] is False

    result = benchmark_engine.run_benchmark(real_verified_artifact, context_length=1024)
    assert result["tokens_per_sec"] > 0
    assert inference_engine.get_status()["loaded"] is True
    assert inference_engine.get_status()["model_artifact_id"] == real_verified_artifact
