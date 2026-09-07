from __future__ import annotations

from fastapi import APIRouter, HTTPException

from potato_core.engines import datasets as dataset_engine
from potato_core.schemas.dataset import DatasetResponse, RegisterDatasetRequest

router = APIRouter(prefix="/datasets", tags=["datasets"])


@router.get("", response_model=list[DatasetResponse])
def list_datasets() -> list[dict]:
    return dataset_engine.list_datasets()


@router.get("/{dataset_id}", response_model=DatasetResponse)
def get_dataset(dataset_id: str) -> dict:
    try:
        return dataset_engine.get_dataset(dataset_id)
    except dataset_engine.DatasetError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("", response_model=DatasetResponse)
def register_dataset(body: RegisterDatasetRequest) -> dict:
    try:
        return dataset_engine.register_dataset(body.name, body.source_path)
    except dataset_engine.DatasetError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{dataset_id}/reanalyze", response_model=DatasetResponse)
def reanalyze_dataset(dataset_id: str) -> dict:
    try:
        return dataset_engine.analyze_dataset(dataset_id)
    except dataset_engine.DatasetError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/{dataset_id}", status_code=204)
def delete_dataset(dataset_id: str) -> None:
    try:
        dataset_engine.delete_dataset(dataset_id)
    except dataset_engine.DatasetError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
