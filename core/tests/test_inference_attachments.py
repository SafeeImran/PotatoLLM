"""Attachment ids on a chat message become model-readable content parts.

Expansion lives in the inference orchestrator rather than the HTTP router,
because what a message should expand into depends on which loaded model is
answering — a vision slot gets image parts, a text-only responder gets the
honest "cannot read this" note.
"""
from __future__ import annotations

import base64

import pytest

from potato_core.engines import attachments as attachment_engine
from potato_core.engines.inference import orchestrator

PNG_1PX = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk"
    "YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)


@pytest.fixture
def text_attachment(tmp_path):
    source = tmp_path / "eval.csv"
    source.write_text("task,score\ngsm8k,74.2\n", encoding="utf-8")
    return attachment_engine.register_attachment(str(source))


@pytest.fixture
def image_attachment(tmp_path):
    source = tmp_path / "loss.png"
    source.write_bytes(PNG_1PX)
    return attachment_engine.register_attachment(str(source))


def test_message_without_attachments_keeps_its_plain_string_content():
    payload = orchestrator.expand_message({"role": "user", "content": "hello"}, multimodal=False)
    assert payload == {"role": "user", "content": "hello"}


def test_attachment_ids_are_stripped_from_the_payload(text_attachment):
    payload = orchestrator.expand_message(
        {"role": "user", "content": "summarise", "attachment_ids": [text_attachment["id"]]},
        multimodal=False,
    )
    assert "attachment_ids" not in payload


def test_document_attachment_is_expanded_into_text_parts(text_attachment):
    payload = orchestrator.expand_message(
        {"role": "user", "content": "summarise", "attachment_ids": [text_attachment["id"]]},
        multimodal=False,
    )

    parts = payload["content"]
    assert isinstance(parts, list)
    assert "gsm8k,74.2" in parts[0]["text"]
    assert parts[-1]["text"] == "summarise"


def test_image_attachment_is_sent_to_a_vision_model(image_attachment):
    payload = orchestrator.expand_message(
        {"role": "user", "content": "what is this?", "attachment_ids": [image_attachment["id"]]},
        multimodal=True,
    )

    types = [part["type"] for part in payload["content"]]
    assert "image_url" in types


def test_image_attachment_degrades_honestly_on_a_text_only_model(image_attachment):
    payload = orchestrator.expand_message(
        {"role": "user", "content": "what is this?", "attachment_ids": [image_attachment["id"]]},
        multimodal=False,
    )

    types = [part["type"] for part in payload["content"]]
    assert "image_url" not in types
    assert any("no vision support" in part["text"] for part in payload["content"])


def test_unknown_attachment_id_raises_rather_than_silently_dropping_the_file():
    with pytest.raises(attachment_engine.AttachmentError):
        orchestrator.expand_message(
            {"role": "user", "content": "hi", "attachment_ids": ["does-not-exist"]},
            multimodal=False,
        )
