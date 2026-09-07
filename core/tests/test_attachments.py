"""Tests for the Attachment Manager."""
from __future__ import annotations

from pathlib import Path

import pytest

from potato_core.config import settings
from potato_core.engines import attachments as attachment_engine


@pytest.fixture
def sample_file(tmp_path):
    path = tmp_path / "hello.txt"
    path.write_text("hello world")
    return path


def test_register_attachment_copies_file_into_attachments_dir(sample_file):
    result = attachment_engine.register_attachment(str(sample_file))
    assert result["file_name"] == "hello.txt"
    assert result["size_bytes"] == 11
    assert result["mime_type"] == "text/plain"
    assert Path(result["file_path"]).exists()
    assert Path(result["file_path"]).is_relative_to(settings.attachments_dir)


def test_register_attachment_detects_image_mime(tmp_path):
    path = tmp_path / "pixel.png"
    path.write_bytes(b"\x89PNG\r\n\x1a\n")
    result = attachment_engine.register_attachment(str(path))
    assert result["kind"] == "image"
    assert result["mime_type"] == "image/png"


def test_register_missing_file_raises():
    with pytest.raises(attachment_engine.AttachmentError):
        attachment_engine.register_attachment("/nonexistent/file.txt")


def test_list_and_get_attachments(sample_file):
    registered = attachment_engine.register_attachment(str(sample_file), message_id="msg-1")
    by_message = attachment_engine.list_attachments(message_id="msg-1")
    assert len(by_message) == 1
    assert by_message[0]["id"] == registered["id"]

    fetched = attachment_engine.get_attachment(registered["id"])
    assert fetched["id"] == registered["id"]


def test_delete_attachment_removes_file_and_row(sample_file):
    registered = attachment_engine.register_attachment(str(sample_file))
    file_path = Path(registered["file_path"])
    assert file_path.exists()

    result = attachment_engine.delete_attachment(registered["id"])
    assert result["freed_bytes"] == 11
    assert not file_path.exists()

    with pytest.raises(attachment_engine.AttachmentError):
        attachment_engine.get_attachment(registered["id"])


def test_delete_unknown_attachment_raises():
    with pytest.raises(attachment_engine.AttachmentError):
        attachment_engine.delete_attachment("does-not-exist")
