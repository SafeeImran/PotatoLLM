from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import PlainTextResponse

from potato_core.engines import logs as logs_engine
from potato_core.schemas.logs import ClearLogsResult, LogFileInfo, LogsResponse

router = APIRouter(prefix="/logs", tags=["logs"])


@router.get("", response_model=LogsResponse)
def get_logs(level: str | None = None, search: str | None = None, limit: int = 500) -> dict:
    return logs_engine.read_logs(level=level, search=search, limit=limit)


@router.get("/raw", response_class=PlainTextResponse)
def get_raw_logs() -> str:
    return logs_engine.read_raw_log()


@router.get("/info", response_model=LogFileInfo)
def get_log_info() -> dict:
    return logs_engine.get_log_file_info()


@router.delete("", response_model=ClearLogsResult)
def clear_logs() -> dict:
    """Deletes the local log file and its rotated backups. Backs Settings -> Privacy."""
    return logs_engine.clear_logs()
