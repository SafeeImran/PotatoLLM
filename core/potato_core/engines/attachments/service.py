"""Attachment Manager — copies user-selected files into Potato's own storage
and keeps metadata for the Playground composer to render as message chips.
"""
from __future__ import annotations

import mimetypes
import shutil
from pathlib import Path

from potato_core.config import settings
from potato_core.db.base import get_session
from potato_core.db.models import Attachment
from potato_core.logging_config import get_logger

log = get_logger("attachments")


class AttachmentError(Exception):
    pass


# MIME prefixes the UI uses to pick an icon/preview path.
_IMAGE_PREFIX = "image/"
_TEXT_PREFIX = "text/"
_APPLICATION_PREFIX = "application/"


def _detect_mime_type(path: Path) -> str | None:
    return mimetypes.guess_type(str(path))[0]


def _file_kind(mime_type: str | None) -> str:
    if mime_type is None:
        return "file"
    if mime_type.startswith(_IMAGE_PREFIX):
        return "image"
    if mime_type.startswith(_TEXT_PREFIX) or mime_type in {
        "application/json",
        "application/xml",
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument",
    }:
        return "document"
    if mime_type.startswith(_APPLICATION_PREFIX):
        return "document"
    return "file"


def register_attachment(source_path: str, mime_type: str | None = None, message_id: str | None = None) -> dict:
    source = Path(source_path)
    if not source.exists() or not source.is_file():
        raise AttachmentError(f"File not found: {source_path}")

    detected = mime_type or _detect_mime_type(source)
    size = source.stat().st_size

    with get_session() as session:
        attachment = Attachment(
            file_name=source.name,
            file_path="",
            mime_type=detected,
            size_bytes=size,
            message_id=message_id,
        )
        session.add(attachment)
        session.flush()
        attachment_id = attachment.id

    target_dir = settings.attachments_dir / attachment_id
    try:
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / source.name
        shutil.copyfile(source, target)
    except OSError as exc:
        # Roll the row back rather than leaving a metadata-only attachment that
        # points at nothing and can never be opened or extracted.
        with get_session() as session:
            orphan = session.get(Attachment, attachment_id)
            if orphan is not None:
                session.delete(orphan)
        raise AttachmentError(f"Could not store '{source.name}': {exc}") from exc

    with get_session() as session:
        attachment = session.get(Attachment, attachment_id)
        attachment.file_path = str(target)

    log.info("Registered attachment %s (%s, %d bytes)", attachment_id, source.name, size)
    return get_attachment(attachment_id)


def list_attachments(message_id: str | None = None) -> list[dict]:
    with get_session() as session:
        query = session.query(Attachment).order_by(Attachment.created_at.desc())
        if message_id is not None:
            query = query.filter(Attachment.message_id == message_id)
        return [_serialize(a) for a in query.all()]


def get_attachment(attachment_id: str) -> dict:
    with get_session() as session:
        attachment = session.get(Attachment, attachment_id)
        if attachment is None:
            raise AttachmentError(f"Unknown attachment '{attachment_id}'")
        return _serialize(attachment)


def delete_attachment(attachment_id: str) -> dict:
    with get_session() as session:
        attachment = session.get(Attachment, attachment_id)
        if attachment is None:
            raise AttachmentError(f"Unknown attachment '{attachment_id}'")
        file_path = Path(attachment.file_path) if attachment.file_path else None
        session.delete(attachment)

    freed_bytes = 0
    if file_path and file_path.exists():
        target_dir = file_path.parent
        freed_bytes = file_path.stat().st_size
        file_path.unlink()
        try:
            target_dir.rmdir()
        except OSError:
            pass

    log.info("Deleted attachment %s (%d bytes freed)", attachment_id, freed_bytes)
    return {"attachment_id": attachment_id, "freed_bytes": freed_bytes}


def _serialize(attachment: Attachment) -> dict:
    return {
        "id": attachment.id,
        "file_name": attachment.file_name,
        "file_path": attachment.file_path,
        "mime_type": attachment.mime_type,
        "size_bytes": attachment.size_bytes,
        "kind": _file_kind(attachment.mime_type),
        "message_id": attachment.message_id,
        "created_at": attachment.created_at,
    }
