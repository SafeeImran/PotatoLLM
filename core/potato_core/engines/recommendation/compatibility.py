"""Pure compatibility math (spec section 13) — no DB, no I/O, so it's cheap
to test exhaustively. Every number this module produces is an *estimate*;
callers must label it "Estimated" and never present it as measured.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

from potato_core.engines.recommendation.quant_scaling import bpw, scale_memory_estimate

CompatibilityLevel = Literal["GREEN", "YELLOW", "RED"]

_GPU_BACKENDS = ("CUDA", "ROCm", "Metal")

# Rough, clearly-approximate KV-cache overhead for context beyond a 4096
# baseline (which the registry's base estimate already implicitly covers).
# Modern GQA-architecture models (most of the curated 12) run roughly in the
# 10-20 MB per 1K tokens per billion params range; this is a single flat
# coefficient, not per-architecture — it exists so a 128K-context request
# isn't silently priced the same as an 8K one, not to be precise to the MB.
_CONTEXT_BASELINE_TOKENS = 4096
_KV_MB_PER_1K_TOKENS_PER_BILLION_PARAMS = 15.0


@dataclass(frozen=True)
class FitEstimate:
    quantization: str
    context_length: int
    estimated_vram_mb: int
    estimated_ram_mb: int
    compatibility: CompatibilityLevel
    recommended_backend: str
    recommended_gpu_offload_pct: int


def parse_param_billions(parameter_count: str) -> float:
    match = re.match(r"([\d.]+)\s*B", parameter_count.strip(), re.IGNORECASE)
    return float(match.group(1)) if match else 0.0


def context_overhead_mb(parameter_count: str, context_length: int) -> int:
    if context_length <= _CONTEXT_BASELINE_TOKENS:
        return 0
    extra_k_tokens = (context_length - _CONTEXT_BASELINE_TOKENS) / 1000
    params_b = parse_param_billions(parameter_count)
    return round(extra_k_tokens * params_b * _KV_MB_PER_1K_TOKENS_PER_BILLION_PARAMS)


def classify_fit(
    required_vram_mb: int,
    required_ram_mb: int,
    hw_vram_mb: int | None,
    hw_ram_mb: int | None,
    backend: str,
) -> CompatibilityLevel:
    if backend in _GPU_BACKENDS and hw_vram_mb:
        if required_vram_mb <= hw_vram_mb * 0.8:
            return "GREEN"
        if required_vram_mb <= hw_vram_mb * 1.05:
            return "YELLOW"  # tight, but partial-offload usually still works
        # Doesn't comfortably fit VRAM — fall through to a CPU-offloaded read.
        if hw_ram_mb and required_ram_mb <= hw_ram_mb * 0.9:
            return "YELLOW"
        return "RED"

    if not hw_ram_mb:
        return "RED"
    if required_ram_mb <= hw_ram_mb * 0.7:
        return "GREEN"
    if required_ram_mb <= hw_ram_mb * 0.95:
        return "YELLOW"
    return "RED"


def recommend_backend(hw_backend: str) -> str:
    return hw_backend if hw_backend in _GPU_BACKENDS else "CPU"


def recommend_gpu_offload_pct(required_vram_mb: int, hw_vram_mb: int | None, backend: str) -> int:
    if backend not in _GPU_BACKENDS or not hw_vram_mb:
        return 0
    if required_vram_mb <= hw_vram_mb:
        return 100
    return max(0, min(100, round((hw_vram_mb * 0.9 / required_vram_mb) * 100)))


def evaluate_fit(
    base_est_vram_mb: int,
    base_est_ram_mb: int,
    parameter_count: str,
    quant: str,
    context_length: int,
    hw_vram_mb: int | None,
    hw_ram_mb: int | None,
    hw_backend: str,
) -> FitEstimate:
    overhead = context_overhead_mb(parameter_count, context_length)
    est_vram = scale_memory_estimate(base_est_vram_mb, quant) + overhead
    est_ram = scale_memory_estimate(base_est_ram_mb, quant) + overhead

    level = classify_fit(est_vram, est_ram, hw_vram_mb, hw_ram_mb, hw_backend)
    backend = recommend_backend(hw_backend)
    offload_pct = recommend_gpu_offload_pct(est_vram, hw_vram_mb, hw_backend) if backend != "CPU" else 0

    return FitEstimate(
        quantization=quant,
        context_length=context_length,
        estimated_vram_mb=est_vram,
        estimated_ram_mb=est_ram,
        compatibility=level,
        recommended_backend=backend,
        recommended_gpu_offload_pct=offload_pct,
    )


_TIER_RANK = {"GREEN": 0, "YELLOW": 1, "RED": 2}


def pick_best_fit(estimates: list[FitEstimate]) -> FitEstimate:
    """Prefers the best compatibility tier, then the highest-quality
    (highest bits-per-weight) option within that tier."""
    if not estimates:
        raise ValueError("pick_best_fit requires at least one estimate")
    return min(estimates, key=lambda e: (_TIER_RANK[e.compatibility], -bpw(e.quantization)))
