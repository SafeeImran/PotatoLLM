from __future__ import annotations

from fastapi import APIRouter, HTTPException

from potato_core.engines import attachments as attachment_engine
from potato_core.schemas.attachment import AttachmentResponse, RegisterAttachmentRequest

router = APIRouter(prefix="/attachments", tags=["attachments"])


@router.get("", response_model=list[AttachmentResponse])
def list_attachments(message_id: str | None = None) -> list[dict]:
    return attachment_engine.list_attachments(message_id)


@router.get("/{attachment_id}", response_model=AttachmentResponse)
def get_attachment(attachment_id: str) -> dict:
    try:
        return attachment_engine.get_attachment(attachment_id)
    except attachment_engine.AttachmentError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("", response_model=AttachmentResponse)
def register_attachment(body: RegisterAttachmentRequest) -> dict:
    try:
        return attachment_engine.register_attachment(body.source_path, body.mime_type, body.message_id)
    except attachment_engine.AttachmentError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/{attachment_id}", status_code=204)
def delete_attachment(attachment_id: str) -> None:
    try:
        attachment_engine.delete_attachment(attachment_id)
    except attachment_engine.AttachmentError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
