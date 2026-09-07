from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

UNKNOWN = "Unknown"


class CpuInfo(BaseModel):
    model: str = UNKNOWN
    vendor: str = UNKNOWN
    cores: int | None = None
    threads: int | None = None
    architecture: str = UNKNOWN
    instruction_sets: list[str] = []
    utilization_pct: float | None = None


class GpuInfo(BaseModel):
    vendor: str = UNKNOWN
    model: str = UNKNOWN
    vram_mb: int | None = None
    driver_version: str = UNKNOWN
    utilization_pct: float | None = None
    temp_c: float | None = None


class MemoryInfo(BaseModel):
    total_mb: int | None = None
    available_mb: int | None = None


class StorageInfo(BaseModel):
    total_gb: float | None = None
    available_gb: float | None = None


class HardwareSnapshot(BaseModel):
    """What a HardwareProvider returns — real or mock, same shape."""

    os_name: str = UNKNOWN
    os_version: str = UNKNOWN
    cpu: CpuInfo = CpuInfo()
    gpu: GpuInfo = GpuInfo()
    memory: MemoryInfo = MemoryInfo()
    storage: StorageInfo = StorageInfo()
    compute_backend: str = UNKNOWN  # CUDA / ROCm / Metal / CPU / Unknown
    is_mock: bool = False


class PotatoScoreResult(BaseModel):
    score: int
    classification: str
    breakdown: dict[str, float]


class HardwareProfileResponse(BaseModel):
    id: str
    created_at: datetime
    snapshot: HardwareSnapshot
    potato_score: PotatoScoreResult

    model_config = {"from_attributes": True}
