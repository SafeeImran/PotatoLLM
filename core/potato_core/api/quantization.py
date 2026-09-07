from __future__ import annotations

from fastapi import APIRouter, HTTPException

from potato_core.engines import quantization as quantization_engine
from potato_core.schemas.quantization import (
    QuantizationEstimate,
    QuantizationJobResponse,
    StartQuantizationRequest,
)

router = APIRouter(prefix="/quantization", tags=["quantization"])


@router.get("", response_model=list[QuantizationJobResponse])
def list_jobs() -> list[dict]:
    return quantization_engine.list_quantizations()


@router.get("/{job_id}", response_model=QuantizationJobResponse)
def get_job(job_id: str) -> dict:
    try:
        return quantization_engine.get_quantization(job_id)
    except quantization_engine.QuantizationError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/estimate", response_model=QuantizationEstimate)
def estimate(body: StartQuantizationRequest) -> dict:
    try:
        return quantization_engine.estimate(body.source_artifact_id, body.target_quant)
    except quantization_engine.QuantizationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/start", response_model=QuantizationJobResponse)
def start(body: StartQuantizationRequest) -> dict:
    try:
        return quantization_engine.start_quantization(body.source_artifact_id, body.target_quant)
    except quantization_engine.QuantizationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{job_id}/cancel", response_model=QuantizationJobResponse)
def cancel(job_id: str) -> dict:
    quantization_engine.cancel_quantization(job_id)
    return quantization_engine.get_quantization(job_id)
