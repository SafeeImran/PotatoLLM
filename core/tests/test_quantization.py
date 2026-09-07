"""Tests for the real Quantization Engine. Validation-only tests always run;
the tests that actually invoke llama-quantize are skipped (not failed) when
the vendored binary or a real FP16 source file isn't available on this
machine — see test_inference.py for the same pattern and why.
"""
from __future__ import annotations

import shutil
import time
from pathlib import Path

import pytest

from potato_core.config import settings
from potato_core.db.base import get_session
from potato_core.db.models import Job, ModelArtifact, QuantizationJob
from potato_core.engines import quantization as quantization_engine
from potato_core.engines.models import seed_models

_REAL_FP16_GGUF = (
    Path.home() / "AppData" / "Roaming" / "PotatoLLM" / "models" / "qwen2.5-0.5b-instruct"
    / "qwen2.5-0.5b-instruct-fp16.gguf"
)


def _wait_until(predicate, timeout=60, interval=0.25):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(interval)
    return False


def _job_status(job_id: str) -> str:
    with get_session() as session:
        return session.get(Job, job_id).status


def test_start_quantization_for_unknown_source_raises():
    with pytest.raises(quantization_engine.QuantizationError, match="Unknown source artifact"):
        quantization_engine.start_quantization("does-not-exist", "Q4_K_M")


def test_start_quantization_for_unverified_source_raises():
    seed_models()
    with get_session() as session:
        artifact = ModelArtifact(
            model_id="tinyllama-1.1b-chat", format="gguf", quantization="FP16",
            file_path="C:\\nowhere.gguf", status="downloading",
        )
        session.add(artifact)
        session.flush()
        artifact_id = artifact.id

    with pytest.raises(quantization_engine.QuantizationError, match="not verified"):
        quantization_engine.start_quantization(artifact_id, "Q4_K_M")


def test_start_quantization_for_already_quantized_source_raises():
    """The core quality guardrail: never requantize an already-lossy file."""
    seed_models()
    with get_session() as session:
        artifact = ModelArtifact(
            model_id="tinyllama-1.1b-chat", format="gguf", quantization="Q4_K_M",
            file_path="C:\\somewhere.gguf", status="verified",
        )
        session.add(artifact)
        session.flush()
        artifact_id = artifact.id

    with pytest.raises(quantization_engine.QuantizationError, match="already quantized"):
        quantization_engine.start_quantization(artifact_id, "Q8_0")


@pytest.fixture(scope="module")
def real_fp16_artifact():
    from potato_core.engines.quantization.service import _quantize_executable

    if not _quantize_executable().exists():
        pytest.skip("llama-quantize binary not vendored — see DEVELOPMENT.md")
    if not _REAL_FP16_GGUF.exists():
        pytest.skip("no real FP16 source downloaded to test against")

    seed_models()
    target_dir = settings.models_dir / "qwen2.5-0.5b-instruct"
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / _REAL_FP16_GGUF.name
    if not target.exists():
        shutil.copyfile(_REAL_FP16_GGUF, target)

    with get_session() as session:
        artifact = ModelArtifact(
            model_id="qwen2.5-0.5b-instruct",
            format="gguf",
            quantization="FP16",
            file_path=str(target),
            size_bytes=target.stat().st_size,
            status="verified",
        )
        session.add(artifact)
        session.flush()
        artifact_id = artifact.id

    return artifact_id


def test_real_estimate_reflects_actual_tensor_data(real_fp16_artifact):
    result = quantization_engine.estimate(real_fp16_artifact, "Q4_K_M")
    assert result["input_bytes"] > 0
    assert result["estimated_output_bytes"] > 0
    assert result["estimated_output_bytes"] < result["input_bytes"]
    assert result["estimated_savings_pct"] > 0


def test_real_quantization_produces_smaller_verified_artifact(real_fp16_artifact):
    result = quantization_engine.start_quantization(real_fp16_artifact, "Q4_K_M")
    job_id = result["job_id"]

    assert _wait_until(lambda: _job_status(job_id) in ("completed", "failed"), timeout=120)
    assert _job_status(job_id) == "completed", quantization_engine.get_quantization(job_id).get("error")

    final = quantization_engine.get_quantization(job_id)
    assert final["output_artifact_id"] is not None

    with get_session() as session:
        source = session.get(ModelArtifact, real_fp16_artifact)
        output = session.get(ModelArtifact, final["output_artifact_id"])
        assert output.status == "verified"
        assert output.quantization == "Q4_K_M"
        assert output.size_bytes > 0
        assert output.size_bytes < source.size_bytes  # actually smaller, not just claimed to be
        assert Path(output.file_path).stat().st_size == output.size_bytes


def test_real_quantization_cancel_kills_the_process_and_cleans_up(real_fp16_artifact):
    result = quantization_engine.start_quantization(real_fp16_artifact, "Q5_K_M")
    job_id = result["job_id"]

    # Wait for real progress, not just "running" — status flips to "running"
    # slightly before the subprocess handle is registered for cancellation,
    # so cancelling too early would race into a no-op that fails to stop it.
    def _progress() -> float:
        with get_session() as session:
            return session.get(Job, job_id).progress

    assert _wait_until(lambda: _progress() > 0, timeout=30)
    quantization_engine.cancel_quantization(job_id)

    assert _wait_until(lambda: _job_status(job_id) == "cancelled", timeout=30)

    with get_session() as session:
        qj = session.get(QuantizationJob, job_id)
        out_path = Path(qj.config_json["output_path"])
        assert not out_path.exists()  # a killed-mid-write file must not linger
        assert qj.output_artifact_id is None  # and must never become a usable artifact
