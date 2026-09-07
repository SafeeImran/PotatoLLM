from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class RunBenchmarkRequest(BaseModel):
    model_artifact_id: str
    context_length: int | None = None
    prompt: str | None = None


class RunBuildBenchmarkRequest(BaseModel):
    build_id: str
    prompt: str | None = None


class BenchmarkResult(BaseModel):
    id: str
    model_artifact_id: str | None = None
    build_id: str | None = None
    tokens_per_sec: float | None
    prompt_tokens_per_sec: float | None
    ttft_seconds: float | None
    total_latency_seconds: float | None
    cpu_util_pct: float | None
    gpu_util_pct: float | None
    vram_mb: float | None
    ram_mb: float | None
    temp_c: float | None
    context_length: int | None
    backend: str | None
    created_at: datetime
    sample_count: int | None = None

    model_config = {"from_attributes": True}
