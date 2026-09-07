from __future__ import annotations

from fastapi import APIRouter

from potato_core.engines import doctor as doctor_engine
from potato_core.schemas.doctor import DiagnosticsResponse

router = APIRouter(prefix="/doctor", tags=["doctor"])


@router.get("", response_model=DiagnosticsResponse)
def run_diagnostics() -> dict:
    return doctor_engine.run_diagnostics()
