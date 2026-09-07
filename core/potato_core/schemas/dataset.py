from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class RegisterDatasetRequest(BaseModel):
    name: str
    source_path: str


class DatasetResponse(BaseModel):
    id: str
    name: str
    file_path: str
    format: str
    example_count: int | None
    estimated_tokens: int | None
    avg_tokens: float | None
    max_tokens: int | None
    duplicate_pct: float | None
    valid_pct: float | None
    created_at: datetime
