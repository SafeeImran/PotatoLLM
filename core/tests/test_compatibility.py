"""Tests for the pure compatibility/fit math (spec section 13)."""
from __future__ import annotations

import pytest

from potato_core.engines.recommendation.compatibility import (
    classify_fit,
    context_overhead_mb,
    evaluate_fit,
    parse_param_billions,
    pick_best_fit,
    recommend_backend,
    recommend_gpu_offload_pct,
)
from potato_core.engines.recommendation.quant_scaling import bpw, scale_memory_estimate


def test_parse_param_billions():
    assert parse_param_billions("8B") == 8.0
    assert parse_param_billions("0.5B") == 0.5
    assert parse_param_billions("14B") == 14.0
    assert parse_param_billions("garbage") == 0.0


def test_bpw_table_matches_real_llama_quantize_output():
    # These are the exact values captured from the vendored llama-quantize
    # binary's --help output in Phase 8 — not invented.
    assert bpw("Q4_K_M") == 4.58
    assert bpw("Q8_0") == 7.96
    assert bpw("Q2_K") == 2.5


def test_bpw_rejects_unknown_quant():
    with pytest.raises(ValueError, match="Unknown quantization"):
        bpw("NOT_A_QUANT")


def test_scale_memory_estimate_is_identity_at_baseline():
    assert scale_memory_estimate(5000, "Q4_K_M") == 5000


def test_scale_memory_estimate_scales_up_for_higher_precision():
    q8 = scale_memory_estimate(5000, "Q8_0")
    assert q8 > 5000
    assert q8 == round(5000 * (7.96 / 4.58))


def test_scale_memory_estimate_scales_down_for_lower_precision():
    q2 = scale_memory_estimate(5000, "Q2_K")
    assert q2 < 5000


def test_context_overhead_is_zero_at_or_below_baseline():
    assert context_overhead_mb("8B", 4096) == 0
    assert context_overhead_mb("8B", 2048) == 0


def test_context_overhead_grows_with_context_length():
    small = context_overhead_mb("8B", 8192)
    large = context_overhead_mb("8B", 32768)
    assert 0 < small < large


def test_context_overhead_grows_with_model_size():
    small_model = context_overhead_mb("0.5B", 32768)
    large_model = context_overhead_mb("70B", 32768)
    assert small_model < large_model


def test_classify_fit_green_when_comfortably_under_vram():
    level = classify_fit(required_vram_mb=4000, required_ram_mb=6000, hw_vram_mb=16000, hw_ram_mb=32000, backend="CUDA")
    assert level == "GREEN"


def test_classify_fit_yellow_when_tight_on_vram():
    level = classify_fit(required_vram_mb=7500, required_ram_mb=9000, hw_vram_mb=8000, hw_ram_mb=32000, backend="CUDA")
    assert level == "YELLOW"


def test_classify_fit_red_when_nothing_fits():
    level = classify_fit(required_vram_mb=40000, required_ram_mb=40000, hw_vram_mb=8000, hw_ram_mb=16000, backend="CUDA")
    assert level == "RED"


def test_classify_fit_falls_back_to_cpu_ram_when_vram_insufficient():
    # Exceeds VRAM headroom but comfortably fits RAM — should not be RED.
    level = classify_fit(required_vram_mb=20000, required_ram_mb=10000, hw_vram_mb=8000, hw_ram_mb=32000, backend="CUDA")
    assert level == "YELLOW"


def test_classify_fit_cpu_only_backend_uses_ram_thresholds():
    assert classify_fit(0, 6000, None, 32000, "CPU") == "GREEN"
    assert classify_fit(0, 30000, None, 32000, "CPU") == "YELLOW"
    assert classify_fit(0, 64000, None, 32000, "CPU") == "RED"


def test_classify_fit_red_when_no_ram_detected():
    assert classify_fit(0, 6000, None, None, "CPU") == "RED"


def test_recommend_backend_prefers_real_gpu_backend():
    assert recommend_backend("CUDA") == "CUDA"
    assert recommend_backend("ROCm") == "ROCm"
    assert recommend_backend("CPU") == "CPU"
    assert recommend_backend("Unknown") == "CPU"


def test_recommend_gpu_offload_full_when_it_fits():
    assert recommend_gpu_offload_pct(5000, 16000, "CUDA") == 100


def test_recommend_gpu_offload_partial_when_tight():
    pct = recommend_gpu_offload_pct(16000, 8000, "CUDA")
    assert 0 < pct < 100


def test_recommend_gpu_offload_zero_on_cpu_backend():
    assert recommend_gpu_offload_pct(5000, None, "CPU") == 0


def test_evaluate_fit_returns_a_complete_estimate():
    fit = evaluate_fit(
        base_est_vram_mb=5632, base_est_ram_mb=7168, parameter_count="8B", quant="Q4_K_M",
        context_length=8192, hw_vram_mb=8151, hw_ram_mb=24317, hw_backend="CUDA",
    )
    assert fit.quantization == "Q4_K_M"
    assert fit.estimated_vram_mb > 0
    assert fit.compatibility in ("GREEN", "YELLOW", "RED")
    assert fit.recommended_backend == "CUDA"


def test_pick_best_fit_prefers_green_over_yellow():
    from potato_core.engines.recommendation.compatibility import FitEstimate

    green = FitEstimate("Q4_K_M", 4096, 4000, 6000, "GREEN", "CUDA", 100)
    yellow = FitEstimate("Q8_0", 4096, 9000, 11000, "YELLOW", "CUDA", 50)
    assert pick_best_fit([yellow, green]) is green


def test_pick_best_fit_prefers_higher_quality_within_same_tier():
    from potato_core.engines.recommendation.compatibility import FitEstimate

    q4 = FitEstimate("Q4_K_M", 4096, 4000, 6000, "GREEN", "CUDA", 100)
    q8 = FitEstimate("Q8_0", 4096, 7000, 9000, "GREEN", "CUDA", 100)
    assert pick_best_fit([q4, q8]) is q8


def test_pick_best_fit_requires_at_least_one_estimate():
    with pytest.raises(ValueError):
        pick_best_fit([])
