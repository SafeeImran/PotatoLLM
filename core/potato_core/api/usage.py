from __future__ import annotations

from fastapi import APIRouter

from potato_core.engines import usage as usage_engine
from potato_core.schemas.usage import (
    ClearUsageResult,
    DailyUsagePoint,
    ModelUsageBreakdown,
    RecentSession,
    UsageRecordResponse,
    UsageSummary,
)

router = APIRouter(prefix="/usage", tags=["usage"])


@router.get("/summary", response_model=UsageSummary)
def summary() -> dict:
    return usage_engine.get_summary()


@router.get("/by-model", response_model=list[ModelUsageBreakdown])
def by_model() -> list[dict]:
    return usage_engine.get_model_breakdown()


@router.get("/timeseries", response_model=list[DailyUsagePoint])
def timeseries(days: int = 14) -> list[dict]:
    return usage_engine.get_daily_timeseries(days)


@router.get("/sessions", response_model=list[RecentSession])
def sessions(limit: int = 10) -> list[dict]:
    return usage_engine.get_recent_sessions(limit)


@router.get("/records", response_model=list[UsageRecordResponse])
def records(limit: int = 100) -> list[UsageRecordResponse]:
    return usage_engine.list_records(limit)


@router.delete("/records", response_model=ClearUsageResult)
def clear_records() -> dict:
    """Deletes all locally-stored usage history. Backs Settings -> Privacy."""
    return usage_engine.clear_records()
