"""Tests for the DB/hardware-integrated Recommendation Engine service layer."""
from __future__ import annotations

import pytest

from potato_core.db.base import get_session
from potato_core.db.models import Model
from potato_core.engines.hardware import service as hardware_service
from potato_core.engines import recommendation as recommendation_engine
from potato_core.engines.models import seed_models


def test_available_quant_options_is_only_q4km_without_fp16_source():
    seed_models()
    with get_session() as session:
        model = session.get(Model, "tinyllama-1.1b-chat")
        options = recommendation_engine.available_quant_options(model)
    assert options == ["Q4_K_M"]


def test_available_quant_options_includes_full_list_with_fp16_source():
    seed_models()
    with get_session() as session:
        model = session.get(Model, "qwen2.5-0.5b-instruct")
        options = recommendation_engine.available_quant_options(model)
    assert "Q4_K_M" in options
    assert len(options) > 1  # qwen2.5-0.5b has fp16_download_url set


def test_recommend_for_unknown_model_raises():
    with pytest.raises(recommendation_engine.RecommendationError, match="Unknown model"):
        recommendation_engine.recommend("does-not-exist")


def test_recommend_without_a_hardware_profile_raises(monkeypatch):
    # Other test files in the shared suite DB may have already scanned and
    # persisted a real hardware profile by the time this runs — assert the
    # "no profile yet" behavior directly rather than relying on ambient
    # global DB state being pristine, which only holds when this test
    # happens to run first.
    seed_models()
    monkeypatch.setattr(recommendation_engine.service.hardware_service, "get_latest_profile", lambda: None)
    with pytest.raises(recommendation_engine.RecommendationError, match="hardware profile"):
        recommendation_engine.recommend("tinyllama-1.1b-chat")


def test_recommend_uses_the_real_latest_hardware_profile():
    seed_models()
    hardware_service.scan_and_persist()

    result = recommendation_engine.recommend("tinyllama-1.1b-chat")
    assert result["model_id"] == "tinyllama-1.1b-chat"
    assert result["recommended"]["quantization"] == "Q4_K_M"
    assert result["recommended"]["compatibility"] in ("GREEN", "YELLOW", "RED")
    assert result["potato_score"] >= 0
    assert len(result["all_options"]) == 1  # tinyllama only has Q4_K_M available


def test_recommend_respects_the_models_max_context_length():
    seed_models()
    hardware_service.scan_and_persist()

    with get_session() as session:
        model = session.get(Model, "tinyllama-1.1b-chat")
        model_max_context = model.context_length

    result = recommendation_engine.recommend("tinyllama-1.1b-chat", context_length=model_max_context * 10)
    assert result["recommended"]["context_length"] == model_max_context


def test_recommend_with_mock_hardware_labels_it_as_mock():
    seed_models()
    from potato_core.engines.hardware.mock import MockHardwareProvider
    from potato_core.db.models import HardwareProfile
    from potato_core.engines.hardware.score import compute_potato_score

    snapshot = MockHardwareProvider().detect()
    score = compute_potato_score(snapshot)
    with get_session() as session:
        session.add(
            HardwareProfile(
                gpu_vram_mb=snapshot.gpu.vram_mb, ram_total_mb=snapshot.memory.total_mb,
                compute_backend=snapshot.compute_backend, is_mock=True,
                potato_score=score.score, potato_classification=score.classification,
            )
        )

    result = recommendation_engine.recommend("tinyllama-1.1b-chat")
    assert result["is_mock_hardware"] is True


def test_recommend_defaults_to_a_sane_context_not_the_models_advertised_maximum():
    """Regression test: Llama-3.1-8B advertises a 131072-token context. Real
    GQA KV-cache math means that alone needs ~16GB — defaulting the fit
    check to a model's max context made large-context modern models look
    RED on hardware they actually run fine on for normal chat. The default
    must size against everyday usage (4096), not the max."""
    seed_models()
    hardware_service.scan_and_persist()

    result = recommendation_engine.recommend("llama-3.1-8b-instruct")
    assert result["recommended"]["context_length"] == 4096
    assert result["recommended"]["context_length"] < 131072


def test_recommend_for_high_vram_model_offers_multiple_quant_options_when_fp16_available():
    seed_models()
    from potato_core.engines.hardware.mock import MockHardwareProvider
    from potato_core.db.models import HardwareProfile
    from potato_core.engines.hardware.score import compute_potato_score

    # Mock provider reports a 16GB GPU — enough headroom that several quant
    # levels of the tiny 0.5B model should classify GREEN.
    snapshot = MockHardwareProvider().detect()
    score = compute_potato_score(snapshot)
    with get_session() as session:
        session.add(
            HardwareProfile(
                gpu_vram_mb=snapshot.gpu.vram_mb, ram_total_mb=snapshot.memory.total_mb,
                compute_backend=snapshot.compute_backend, is_mock=True,
                potato_score=score.score, potato_classification=score.classification,
            )
        )

    result = recommendation_engine.recommend("qwen2.5-0.5b-instruct")
    assert len(result["all_options"]) > 1
    assert result["recommended"]["compatibility"] == "GREEN"
