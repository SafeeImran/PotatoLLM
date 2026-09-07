from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class CreateBuildRequest(BaseModel):
    name: str
    model_artifact_id: str
    context_length: int | None = None
    gpu_offload_layers: int | None = None
    backend: str = "llama.cpp"


class RenameBuildRequest(BaseModel):
    name: str


class DuplicateBuildRequest(BaseModel):
    name: str | None = None


class BuildResponse(BaseModel):
    id: str
    name: str
    base_model_id: str
    base_model_name: str
    model_artifact_id: str
    quantization: str | None
    size_bytes: int | None
    backend: str
    gpu_offload_layers: int | None
    context_length: int | None
    last_benchmark_tokens_per_sec: float | None
    created_at: datetime
    updated_at: datetime
