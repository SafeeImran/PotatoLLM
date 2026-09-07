from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class RegisterAttachmentRequest(BaseModel):
    source_path: str
    mime_type: str | None = None
    message_id: str | None = None


class AttachmentResponse(BaseModel):
    id: str
    file_name: str
    file_path: str
    mime_type: str | None
    size_bytes: int
    kind: str
    message_id: str | None
    created_at: datetime
