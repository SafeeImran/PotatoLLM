from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class UsageSummary(BaseModel):
    tokens_today: int
    prompt_tokens_today: int
    completion_tokens_today: int
    avg_tokens_per_sec_today: float | None
    avg_ttft_seconds_today: float | None
    generations_today: int
    total_tokens_all_time: int
    total_sessions: int
    total_generations: int


class ModelUsageBreakdown(BaseModel):
    model_id: str
    model_name: str
    total_tokens: int
    generations: int
    avg_tokens_per_sec: float | None


class DailyUsagePoint(BaseModel):
    date: str
    tokens: int
    prompt_tokens: int
    completion_tokens: int
    generations: int
    avg_tokens_per_sec: float | None
    avg_ttft_seconds: float | None


class RecentSession(BaseModel):
    session_id: str
    model_id: str | None
    model_name: str | None
    total_tokens: int
    generations: int
    avg_tokens_per_sec: float | None
    avg_ttft_seconds: float | None
    duration_seconds: float | None
    started_at: datetime
    last_activity_at: datetime


class UsageRecordResponse(BaseModel):
    id: str
    session_id: str | None
    input_tokens: int
    output_tokens: int
    tokens_per_sec: float | None
    ttft_seconds: float | None
    cpu_util_pct: float | None
    gpu_util_pct: float | None
    vram_mb: float | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ClearUsageResult(BaseModel):
    deleted: int
