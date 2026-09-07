from __future__ import annotations

from fastapi import APIRouter, HTTPException

from potato_core.engines import build as build_engine
from potato_core.schemas.build import (
    BuildResponse,
    CreateBuildRequest,
    DuplicateBuildRequest,
    RenameBuildRequest,
)

router = APIRouter(prefix="/builds", tags=["builds"])


@router.get("", response_model=list[BuildResponse])
def list_builds() -> list[dict]:
    return build_engine.list_builds()


@router.get("/{build_id}", response_model=BuildResponse)
def get_build(build_id: str) -> dict:
    try:
        return build_engine.get_build(build_id)
    except build_engine.BuildError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("", response_model=BuildResponse)
def create_build(body: CreateBuildRequest) -> dict:
    try:
        return build_engine.create_build(
            body.name, body.model_artifact_id, body.context_length, body.gpu_offload_layers, body.backend
        )
    except build_engine.BuildError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/{build_id}", response_model=BuildResponse)
def rename_build(build_id: str, body: RenameBuildRequest) -> dict:
    try:
        return build_engine.rename_build(build_id, body.name)
    except build_engine.BuildError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{build_id}/duplicate", response_model=BuildResponse)
def duplicate_build(build_id: str, body: DuplicateBuildRequest) -> dict:
    try:
        return build_engine.duplicate_build(build_id, body.name)
    except build_engine.BuildError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/{build_id}", status_code=204)
def delete_build(build_id: str) -> None:
    try:
        build_engine.delete_build(build_id)
    except build_engine.BuildError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
