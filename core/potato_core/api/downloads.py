from __future__ import annotations

from fastapi import APIRouter, HTTPException

from potato_core.engines import downloads as download_manager
from potato_core.schemas.downloads import DownloadJobResponse

router = APIRouter(prefix="/downloads", tags=["downloads"])


@router.get("", response_model=list[DownloadJobResponse])
def list_downloads() -> list[dict]:
    return download_manager.list_downloads()


@router.get("/{job_id}", response_model=DownloadJobResponse)
def get_download(job_id: str) -> dict:
    try:
        return download_manager.get_download(job_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/models/{model_id}/start", response_model=DownloadJobResponse)
def start_download(model_id: str, variant: str = "quantized") -> dict:
    try:
        return download_manager.start_download(model_id, variant)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{job_id}/pause", response_model=DownloadJobResponse)
def pause_download(job_id: str) -> dict:
    try:
        download_manager.pause_download(job_id)
        return download_manager.get_download(job_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{job_id}/resume", response_model=DownloadJobResponse)
def resume_download(job_id: str) -> dict:
    try:
        return download_manager.resume_download(job_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{job_id}/cancel", response_model=DownloadJobResponse)
def cancel_download(job_id: str) -> dict:
    try:
        download_manager.cancel_download(job_id)
        return download_manager.get_download(job_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{job_id}/retry", response_model=DownloadJobResponse)
def retry_download(job_id: str) -> dict:
    try:
        return download_manager.retry_download(job_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
