from __future__ import annotations

from fastapi import APIRouter, HTTPException

from potato_core.engines import models as model_registry
from potato_core.schemas.models import ModelResponse

router = APIRouter(prefix="/models", tags=["models"])


@router.get("", response_model=list[ModelResponse])
def list_models(family: str | None = None, q: str | None = None) -> list[ModelResponse]:
    return model_registry.list_models(family=family, query=q)


@router.get("/{model_id}", response_model=ModelResponse)
def get_model(model_id: str) -> ModelResponse:
    model = model_registry.get_model(model_id)
    if model is None:
        raise HTTPException(status_code=404, detail=f"Model '{model_id}' not found")
    return model
