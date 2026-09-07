from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from potato_core.db.base import get_session
from potato_core.db.models import InferenceSession, Model, ModelArtifact
from potato_core.engines import inference as inference_engine
from potato_core.engines import usage as usage_engine
from potato_core.engines.inference import runtime as inference_runtime
from potato_core.schemas.inference import (
    AvailableModel,
    GenerateRequest,
    InferenceStatusResponse,
    LoadModelRequest,
    RuntimeDefaults,
    SetPrimaryRequest,
    UnloadModelRequest,
)

router = APIRouter(prefix="/inference", tags=["inference"])

# Tracks the DB row for whatever InferenceSession is currently open, so a
# completed generation's UsageRecord can be linked to it. One session per chat,
# not per model: a multi-model turn is still one piece of work, and splitting
# its usage across the models that contributed would double-count the tokens.
_current_session_id: str | None = None


@router.get("/status", response_model=InferenceStatusResponse)
def status() -> dict:
    return inference_engine.get_status()


@router.get("/available-models", response_model=list[AvailableModel])
def available_models() -> list[dict]:
    with get_session() as session:
        rows = (
            session.query(ModelArtifact, Model)
            .join(Model, Model.id == ModelArtifact.model_id)
            .filter(ModelArtifact.status == "verified")
            .order_by(Model.name)
            .all()
        )
        return [
            {
                "artifact_id": artifact.id,
                "model_id": model.id,
                "model_name": model.name,
                "quantization": artifact.quantization,
                "size_bytes": artifact.size_bytes,
                "context_length": model.context_length,
                "multimodal": bool(artifact.mmproj_path),
            }
            for artifact, model in rows
        ]


@router.get("/runtime-defaults", response_model=RuntimeDefaults)
def runtime_defaults(refresh: bool = False) -> dict:
    """The Auto values behind the Playground's Performance controls — detected
    from this machine, so the UI can label an Auto control with the number it
    will actually get instead of the word "auto" alone."""
    return inference_runtime.detect(refresh=refresh)


@router.post("/load", response_model=InferenceStatusResponse)
def load(body: LoadModelRequest) -> dict:
    global _current_session_id
    try:
        result = inference_engine.load_model(
            body.model_artifact_id,
            body.context_length,
            body.runtime.model_dump(exclude_none=True) if body.runtime else None,
            role=body.role,
        )
    except inference_engine.InferenceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    with get_session() as session:
        inference_session = InferenceSession(
            model_artifact_id=body.model_artifact_id,
            params_json=result["runtime"],
        )
        session.add(inference_session)
        session.flush()
        _current_session_id = inference_session.id
    return result


@router.post("/unload", response_model=InferenceStatusResponse)
def unload(body: UnloadModelRequest | None = None) -> dict:
    """Unload one slot, or every slot when no artifact is named."""
    global _current_session_id
    artifact_id = body.model_artifact_id if body else None

    try:
        status = inference_engine.unload_model(artifact_id)
    except inference_engine.InferenceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # The session tracks the chat, not an individual model, so it only closes
    # once the last slot is gone.
    if not status["loaded"]:
        with get_session() as db_session:
            open_session = (
                db_session.query(InferenceSession)
                .filter(InferenceSession.ended_at.is_(None))
                .order_by(InferenceSession.started_at.desc())
                .first()
            )
            if open_session:
                open_session.ended_at = datetime.now(timezone.utc)
        _current_session_id = None

    return status


@router.post("/primary", response_model=InferenceStatusResponse)
def primary(body: SetPrimaryRequest) -> dict:
    """Hand the answering role to an already-loaded model."""
    try:
        return inference_engine.set_primary(body.model_artifact_id)
    except inference_engine.InferenceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/generate")
async def generate_stream(body: GenerateRequest) -> StreamingResponse:
    if not inference_engine.get_status()["loaded"]:
        raise HTTPException(status_code=400, detail="No model is loaded — call /inference/load first")

    # Attachment expansion and any vision hand-off happen in the orchestrator:
    # both depend on which model is answering, and that is its decision to make.
    messages = [m.model_dump() for m in body.messages]
    params = body.model_dump(exclude={"messages", "responder_artifact_id"})
    responder = body.responder_artifact_id

    session_id = _current_session_id

    async def ndjson():
        try:
            async for chunk in inference_engine.run_turn(messages, params, responder):
                if chunk.get("done") and chunk.get("stats"):
                    usage_engine.record_usage(session_id, chunk["stats"])
                yield json.dumps(chunk) + "\n"
        except Exception as exc:  # noqa: BLE001 — surface the error to the client rather than a bare 500
            yield json.dumps({"error": str(exc)}) + "\n"

    return StreamingResponse(ndjson(), media_type="application/x-ndjson")


@router.post("/benchmark")
def benchmark() -> dict:
    if not inference_engine.get_status()["loaded"]:
        raise HTTPException(status_code=400, detail="No model is loaded — call /inference/load first")
    try:
        return inference_engine.benchmark()
    except inference_engine.InferenceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
