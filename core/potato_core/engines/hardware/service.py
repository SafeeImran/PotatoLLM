"""Orchestrates provider selection, Potato Score, and persistence.

This is the only module the API layer talks to — it never touches
RealHardwareProvider/MockHardwareProvider directly.
"""
from __future__ import annotations

from potato_core.config import settings
from potato_core.db.base import get_session
from potato_core.db.models import HardwareProfile
from potato_core.engines.hardware.base import HardwareProvider
from potato_core.engines.hardware.mock import MockHardwareProvider
from potato_core.engines.hardware.real import RealHardwareProvider
from potato_core.engines.hardware.score import compute_potato_score
from potato_core.schemas.hardware import HardwareProfileResponse, HardwareSnapshot


def _get_provider() -> HardwareProvider:
    if settings.mock_hardware:
        return MockHardwareProvider()
    return RealHardwareProvider()


def scan_and_persist() -> HardwareProfileResponse:
    """Full detection pass — run on first launch and whenever the user asks to re-scan."""
    provider = _get_provider()
    snapshot = provider.detect()
    score = compute_potato_score(snapshot)

    with get_session() as session:
        row = HardwareProfile(
            os_name=snapshot.os_name,
            os_version=snapshot.os_version,
            cpu_model=snapshot.cpu.model,
            cpu_vendor=snapshot.cpu.vendor,
            cpu_cores=snapshot.cpu.cores,
            cpu_threads=snapshot.cpu.threads,
            cpu_architecture=snapshot.cpu.architecture,
            cpu_instruction_sets=snapshot.cpu.instruction_sets,
            gpu_vendor=snapshot.gpu.vendor,
            gpu_model=snapshot.gpu.model,
            gpu_vram_mb=snapshot.gpu.vram_mb,
            gpu_driver_version=snapshot.gpu.driver_version,
            gpu_utilization_pct=snapshot.gpu.utilization_pct,
            gpu_temp_c=snapshot.gpu.temp_c,
            compute_backend=snapshot.compute_backend,
            ram_total_mb=snapshot.memory.total_mb,
            ram_available_mb=snapshot.memory.available_mb,
            storage_total_gb=snapshot.storage.total_gb,
            storage_available_gb=snapshot.storage.available_gb,
            potato_score=score.score,
            potato_classification=score.classification,
            is_mock=snapshot.is_mock,
            raw_detection_json=snapshot.model_dump(mode="json"),
        )
        session.add(row)
        session.flush()
        profile_id = row.id
        created_at = row.created_at

    return HardwareProfileResponse(
        id=profile_id,
        created_at=created_at,
        snapshot=snapshot,
        potato_score=score,
    )


def get_latest_profile() -> HardwareProfileResponse | None:
    with get_session() as session:
        row = (
            session.query(HardwareProfile)
            .order_by(HardwareProfile.created_at.desc())
            .first()
        )
        if row is None:
            return None
        snapshot = HardwareSnapshot(
            os_name=row.os_name,
            os_version=row.os_version,
            cpu={
                "model": row.cpu_model,
                "vendor": row.cpu_vendor,
                "cores": row.cpu_cores,
                "threads": row.cpu_threads,
                "architecture": row.cpu_architecture,
                "instruction_sets": row.cpu_instruction_sets or [],
            },
            gpu={
                "vendor": row.gpu_vendor,
                "model": row.gpu_model,
                "vram_mb": row.gpu_vram_mb,
                "driver_version": row.gpu_driver_version,
                "utilization_pct": row.gpu_utilization_pct,
                "temp_c": row.gpu_temp_c,
            },
            memory={"total_mb": row.ram_total_mb, "available_mb": row.ram_available_mb},
            storage={"total_gb": row.storage_total_gb, "available_gb": row.storage_available_gb},
            compute_backend=row.compute_backend,
            is_mock=row.is_mock,
        )
        score = compute_potato_score(snapshot)
        return HardwareProfileResponse(
            id=row.id,
            created_at=row.created_at,
            snapshot=snapshot,
            potato_score=score,
        )


def poll_live() -> HardwareSnapshot:
    """Lightweight live read for the hardware monitor — not persisted."""
    return _get_provider().poll_live()
