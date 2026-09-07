from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

CheckStatus = Literal["pass", "warn", "fail"]


class DiagnosticCheck(BaseModel):
    name: str
    status: CheckStatus
    message: str
    fix: str | None = None


class DiagnosticsResponse(BaseModel):
    checks: list[DiagnosticCheck]
    all_pass: bool
    has_failures: bool
