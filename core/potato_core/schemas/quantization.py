from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class StartQuantizationRequest(BaseModel):
    source_artifact_id: str
    target_quant: str


class QuantizationEstimate(BaseModel):
    input_bytes: int
    estimated_output_bytes: int
    estimated_savings_pct: float


class QuantizationJobResponse(BaseModel):
    job_id: str
    model_id: str
    source_artifact_id: str
    target_quant: str
    status: str
    progress: float
    output_artifact_id: str | None
    error: str | None
    created_at: datetime
    updated_at: datetime
