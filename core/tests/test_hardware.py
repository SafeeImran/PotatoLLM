from __future__ import annotations

from potato_core.engines.hardware.mock import MockHardwareProvider
from potato_core.engines.hardware.real import RealHardwareProvider
from potato_core.schemas.hardware import HardwareSnapshot


def test_real_provider_detect_never_raises_and_returns_snapshot():
    snapshot = RealHardwareProvider().detect()
    assert isinstance(snapshot, HardwareSnapshot)
    assert snapshot.is_mock is False
    # Fields must be honest placeholders, never fabricated, when detection fails.
    assert snapshot.compute_backend in ("CUDA", "ROCm", "Metal", "CPU", "Unknown")


def test_real_provider_poll_live_never_raises():
    snapshot = RealHardwareProvider().poll_live()
    assert isinstance(snapshot, HardwareSnapshot)


def test_mock_provider_is_clearly_labeled():
    snapshot = MockHardwareProvider().detect()
    assert snapshot.is_mock is True
    assert "MOCK" in snapshot.cpu.model
    assert "MOCK" in snapshot.gpu.model
    assert snapshot.gpu.vram_mb == 16384
    assert snapshot.compute_backend == "CUDA"


def test_mock_provider_live_matches_detect_shape():
    provider = MockHardwareProvider()
    live = provider.poll_live()
    detected = provider.detect()
    assert live.gpu.vram_mb == detected.gpu.vram_mb
    assert live.is_mock is True
