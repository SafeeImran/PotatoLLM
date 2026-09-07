"""Potato Score — not a scientific universal benchmark, just a legible 0-100 read on
how suitable this machine is for local LLM workloads (spec section 10).

Weights are intentionally simple and named so they can be tuned later without
touching any caller: the API only ever sees `compute_potato_score()`.
"""
from __future__ import annotations

from potato_core.schemas.hardware import HardwareSnapshot, PotatoScoreResult

_VRAM_MAX_POINTS = 40.0
_VRAM_SATURATION_MB = 24_576  # 24GB+ gets full marks

_RAM_MAX_POINTS = 20.0
_RAM_SATURATION_MB = 65_536  # 64GB+ gets full marks

_CPU_MAX_POINTS = 15.0
_CPU_SATURATION_THREADS = 16
_CPU_AVX2_BONUS = 2.0  # folded into the 15-point budget, not additive on top

_STORAGE_MAX_POINTS = 10.0
_STORAGE_SATURATION_GB = 500.0

_BACKEND_POINTS = {
    "CUDA": 15.0,
    "ROCm": 12.0,
    "Metal": 12.0,
    "CPU": 5.0,
    "Unknown": 0.0,
}

_CLASSIFICATIONS = [
    (20, "Tiny Potato"),
    (40, "Potato"),
    (60, "Capable Potato"),
    (80, "Serious Potato"),
    (101, "Potato Beast"),
]


def _scale(value: float | None, saturation: float, max_points: float) -> float:
    if value is None or value <= 0:
        return 0.0
    return min(max_points, (value / saturation) * max_points)


def _classify(score: int) -> str:
    for threshold, label in _CLASSIFICATIONS:
        if score < threshold:
            return label
    return "Potato Beast"


def compute_potato_score(snapshot: HardwareSnapshot) -> PotatoScoreResult:
    vram_points = _scale(snapshot.gpu.vram_mb, _VRAM_SATURATION_MB, _VRAM_MAX_POINTS)
    ram_points = _scale(snapshot.memory.total_mb, _RAM_SATURATION_MB, _RAM_MAX_POINTS)

    cpu_base = _scale(snapshot.cpu.threads, _CPU_SATURATION_THREADS, _CPU_MAX_POINTS - _CPU_AVX2_BONUS)
    cpu_bonus = _CPU_AVX2_BONUS if "avx2" in snapshot.cpu.instruction_sets else 0.0
    cpu_points = min(_CPU_MAX_POINTS, cpu_base + cpu_bonus)

    storage_points = _scale(snapshot.storage.available_gb, _STORAGE_SATURATION_GB, _STORAGE_MAX_POINTS)
    backend_points = _BACKEND_POINTS.get(snapshot.compute_backend, 0.0)

    breakdown = {
        "vram": round(vram_points, 1),
        "ram": round(ram_points, 1),
        "cpu": round(cpu_points, 1),
        "storage": round(storage_points, 1),
        "backend": round(backend_points, 1),
    }
    total = round(sum(breakdown.values()))
    total = max(0, min(100, total))

    return PotatoScoreResult(score=total, classification=_classify(total), breakdown=breakdown)
