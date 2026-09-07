from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class DownloadJobResponse(BaseModel):
    job_id: str
    model_id: str
    model_name: str
    variant: str
    status: str
    progress: float
    bytes_downloaded: int
    bytes_total: int | None
    speed_bps: float | None
    error: str | None
    created_at: datetime
    updated_at: datetime
