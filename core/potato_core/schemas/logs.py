from __future__ import annotations

from pydantic import BaseModel


class LogEntry(BaseModel):
    timestamp: str
    level: str
    logger: str
    message: str


class LogsResponse(BaseModel):
    entries: list[LogEntry]
    total_matched: int
    file_exists: bool


class LogFileInfo(BaseModel):
    path: str
    exists: bool
    size_bytes: int


class ClearLogsResult(BaseModel):
    freed_bytes: int
    files_removed: int
