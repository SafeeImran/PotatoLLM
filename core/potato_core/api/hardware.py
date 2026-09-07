from __future__ import annotations

from fastapi import APIRouter, HTTPException

from potato_core.engines.hardware import service
from potato_core.schemas.hardware import HardwareProfileResponse, HardwareSnapshot

router = APIRouter(prefix="/hardware", tags=["hardware"])


@router.post("/scan", response_model=HardwareProfileResponse)
def scan() -> HardwareProfileResponse:
    """Full detection pass. Called on first launch and on-demand re-scan."""
    return service.scan_and_persist()


@router.get("/latest", response_model=HardwareProfileResponse | None)
def latest() -> HardwareProfileResponse | None:
    return service.get_latest_profile()


@router.get("/live", response_model=HardwareSnapshot)
def live() -> HardwareSnapshot:
    """Cheap poll for the live hardware monitor widget."""
    return service.poll_live()
