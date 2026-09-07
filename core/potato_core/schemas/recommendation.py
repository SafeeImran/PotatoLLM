from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

CompatibilityLevel = Literal["GREEN", "YELLOW", "RED"]


class FitEstimateResponse(BaseModel):
    quantization: str
    context_length: int
    estimated_vram_mb: int
    estimated_ram_mb: int
    compatibility: CompatibilityLevel
    recommended_backend: str
    recommended_gpu_offload_pct: int


class RecommendationResponse(BaseModel):
    model_id: str
    potato_score: int
    potato_classification: str
    recommended: FitEstimateResponse
    all_options: list[FitEstimateResponse]
    is_mock_hardware: bool


class MakeItPotatoResponse(BaseModel):
    status: str  # "ready" | "preparing"
    recommendation: RecommendationResponse
    artifact_id: str | None = None
    step: str | None = None  # "downloading" | "downloading_fp16_source" | "quantizing"
    job: dict | None = None
