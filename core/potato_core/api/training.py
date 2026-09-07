from __future__ import annotations

from fastapi import APIRouter, HTTPException

from potato_core.engines import training as training_engine
from potato_core.engines.training.hyperparameters import SliderInputs
from potato_core.schemas.training import (
    CreateTrainingJobRequest,
    MLDependencyStatus,
    SliderConfig,
    TrainingJobResponse,
)

router = APIRouter(prefix="/training", tags=["training"])


def _to_slider_inputs(sliders: SliderConfig) -> SliderInputs:
    return SliderInputs(**sliders.model_dump())


@router.get("/dependencies", response_model=MLDependencyStatus)
def dependencies() -> dict:
    return training_engine.check_ml_dependencies()


@router.post("/preview")
def preview(sliders: SliderConfig) -> dict:
    hp = training_engine.map_sliders_to_hyperparameters(_to_slider_inputs(sliders))
    return hp.to_dict()


@router.get("/jobs", response_model=list[TrainingJobResponse])
def list_jobs() -> list[dict]:
    return training_engine.list_training_jobs()


@router.get("/jobs/{job_id}", response_model=TrainingJobResponse)
def get_job(job_id: str) -> dict:
    try:
        return training_engine.get_training_job(job_id)
    except training_engine.TrainingError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/jobs", response_model=TrainingJobResponse)
def create_job(body: CreateTrainingJobRequest) -> dict:
    try:
        return training_engine.create_training_job(
            body.base_model_id, body.dataset_id, _to_slider_inputs(body.sliders), body.advanced_overrides
        )
    except training_engine.TrainingError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/jobs/{job_id}/start", response_model=TrainingJobResponse)
def start_job(job_id: str) -> dict:
    try:
        return training_engine.start_training(job_id)
    except training_engine.TrainingError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/jobs/{job_id}/pause", response_model=TrainingJobResponse)
def pause_job(job_id: str) -> dict:
    try:
        return training_engine.pause_training(job_id)
    except training_engine.TrainingError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/jobs/{job_id}/stop", response_model=TrainingJobResponse)
def stop_job(job_id: str) -> dict:
    try:
        return training_engine.stop_training(job_id)
    except training_engine.TrainingError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
