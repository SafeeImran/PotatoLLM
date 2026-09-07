from __future__ import annotations

from fastapi import APIRouter, HTTPException

from potato_core.engines import storage as storage_engine
from potato_core.schemas.storage import (
    ClearCacheResult,
    DeleteArtifactResult,
    DeleteFileRequest,
    DeleteFileResult,
    OrphanReport,
    PurgeResult,
    StorageSummary,
    StoredDataset,
    StoredModel,
)

router = APIRouter(prefix="/storage", tags=["storage"])


@router.get("/summary", response_model=StorageSummary)
def summary() -> dict:
    return storage_engine.get_storage_summary()


@router.get("/models", response_model=list[StoredModel])
def stored_models() -> list[dict]:
    return storage_engine.list_stored_models()


@router.get("/datasets", response_model=list[StoredDataset])
def stored_datasets() -> list[dict]:
    return storage_engine.list_stored_datasets()


@router.get("/orphans", response_model=OrphanReport)
def orphans() -> dict:
    return storage_engine.find_orphans()


@router.delete("/models/{artifact_id}", response_model=DeleteArtifactResult)
def delete_model(artifact_id: str, force: bool = False) -> dict:
    try:
        return storage_engine.delete_artifact(artifact_id, force=force)
    except storage_engine.StorageError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/orphans/delete-file", response_model=DeleteFileResult)
def delete_untracked_file(body: DeleteFileRequest) -> dict:
    try:
        return storage_engine.delete_untracked_file(body.file_path)
    except storage_engine.StorageError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/orphans/purge-missing", response_model=PurgeResult)
def purge_missing() -> dict:
    return storage_engine.purge_missing_artifacts()


@router.post("/cache/clear", response_model=ClearCacheResult)
def clear_cache() -> dict:
    return storage_engine.clear_cache()
