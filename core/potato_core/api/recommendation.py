from __future__ import annotations

from fastapi import APIRouter, HTTPException

from potato_core.engines import recommendation as recommendation_engine
from potato_core.schemas.recommendation import MakeItPotatoResponse, RecommendationResponse

router = APIRouter(prefix="/recommendation", tags=["recommendation"])


@router.get("/{model_id}", response_model=RecommendationResponse)
def recommend(model_id: str, context_length: int | None = None) -> dict:
    try:
        return recommendation_engine.recommend(model_id, context_length)
    except recommendation_engine.RecommendationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{model_id}/make-it-potato", response_model=MakeItPotatoResponse)
def make_it_potato(model_id: str, context_length: int | None = None) -> dict:
    try:
        return recommendation_engine.make_it_potato(model_id, context_length)
    except recommendation_engine.RecommendationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
