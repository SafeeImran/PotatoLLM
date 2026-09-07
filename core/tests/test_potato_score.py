from __future__ import annotations

from potato_core.engines.hardware.score import compute_potato_score
from potato_core.schemas.hardware import CpuInfo, GpuInfo, HardwareSnapshot, MemoryInfo, StorageInfo


def _snapshot(**overrides) -> HardwareSnapshot:
    base = HardwareSnapshot(
        cpu=CpuInfo(threads=8, instruction_sets=[]),
        gpu=GpuInfo(vram_mb=8192),
        memory=MemoryInfo(total_mb=32768),
        storage=StorageInfo(available_gb=250.0),
        compute_backend="CUDA",
    )
    return base.model_copy(update=overrides)


def test_score_is_bounded_0_to_100():
    result = compute_potato_score(_snapshot())
    assert 0 <= result.score <= 100


def test_worst_case_hardware_scores_zero_and_tiny_potato():
    snapshot = HardwareSnapshot(
        cpu=CpuInfo(threads=None, instruction_sets=[]),
        gpu=GpuInfo(vram_mb=None),
        memory=MemoryInfo(total_mb=None),
        storage=StorageInfo(available_gb=None),
        compute_backend="Unknown",
    )
    result = compute_potato_score(snapshot)
    assert result.score == 0
    assert result.classification == "Tiny Potato"


def test_best_case_hardware_scores_100_and_potato_beast():
    snapshot = HardwareSnapshot(
        cpu=CpuInfo(threads=32, instruction_sets=["avx2"]),
        gpu=GpuInfo(vram_mb=49152),
        memory=MemoryInfo(total_mb=131072),
        storage=StorageInfo(available_gb=2000.0),
        compute_backend="CUDA",
    )
    result = compute_potato_score(snapshot)
    assert result.score == 100
    assert result.classification == "Potato Beast"


def test_no_dedicated_gpu_still_scores_something_via_cpu_ram():
    snapshot = _snapshot(gpu=GpuInfo(vram_mb=None), compute_backend="CPU")
    result = compute_potato_score(snapshot)
    assert result.breakdown["vram"] == 0.0
    assert result.score > 0  # RAM/CPU/storage/backend still contribute


def test_classification_bands_are_monotonic():
    scores = []
    for vram in (0, 2048, 8192, 16384, 24576):
        snapshot = _snapshot(gpu=GpuInfo(vram_mb=vram))
        scores.append(compute_potato_score(snapshot).score)
    assert scores == sorted(scores)
