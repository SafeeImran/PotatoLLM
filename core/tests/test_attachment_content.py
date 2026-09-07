"""Attachment -> model-readable content."""
from __future__ import annotations

import base64
import zipfile

import pytest

from potato_core.engines.attachments import content


def _attachment(path, mime_type=None, kind="file", size=None):
    return {
        "id": "a1",
        "file_name": path.name,
        "file_path": str(path),
        "mime_type": mime_type,
        "size_bytes": size if size is not None else path.stat().st_size,
        "kind": kind,
        "message_id": None,
    }


def _png(path):
    # Smallest valid PNG: a 1x1 transparent pixel.
    path.write_bytes(
        base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk"
            "YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
        )
    )
    return path


def test_extracts_plain_text(tmp_path):
    f = tmp_path / "notes.txt"
    f.write_text("hello potato", encoding="utf-8")
    assert content.extract_text(_attachment(f, "text/plain")) == "hello potato"


def test_extracts_source_code_by_extension_even_without_a_mime_type(tmp_path):
    f = tmp_path / "train.py"
    f.write_text("def go():\n    return 1\n", encoding="utf-8")
    assert "def go()" in content.extract_text(_attachment(f, None))


def test_undecodable_bytes_do_not_raise(tmp_path):
    f = tmp_path / "weird.txt"
    f.write_bytes(b"ok \xff\xfe bytes")
    assert "ok" in content.extract_text(_attachment(f, "text/plain"))


def test_extracts_docx_without_a_third_party_dependency(tmp_path):
    f = tmp_path / "report.docx"
    document = (
        '<?xml version="1.0"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        "<w:body>"
        "<w:p><w:r><w:t>First para</w:t></w:r></w:p>"
        "<w:p><w:r><w:t>Second </w:t></w:r><w:r><w:t>para</w:t></w:r></w:p>"
        "</w:body></w:document>"
    )
    with zipfile.ZipFile(f, "w") as archive:
        archive.writestr("word/document.xml", document)

    text = content.extract_text(_attachment(f, None))
    assert "First para" in text
    # Runs inside one paragraph are joined, not split across lines.
    assert "Second para" in text


def test_unsupported_binary_raises(tmp_path):
    f = tmp_path / "model.gguf"
    f.write_bytes(b"\x00\x01\x02")
    with pytest.raises(content.ExtractionError):
        content.extract_text(_attachment(f, "application/octet-stream"))


def test_long_text_is_truncated_and_says_so(tmp_path):
    f = tmp_path / "huge.txt"
    f.write_text("x" * (content.MAX_TEXT_CHARS + 5000), encoding="utf-8")
    text = content.extract_text(_attachment(f, "text/plain"))
    assert "truncated" in text
    assert len(text) < content.MAX_TEXT_CHARS + 200


def test_document_becomes_a_fenced_text_part(tmp_path):
    f = tmp_path / "notes.md"
    f.write_text("# Title", encoding="utf-8")
    parts = content.to_content_parts(_attachment(f, "text/markdown", kind="document"), multimodal=False)

    assert len(parts) == 1
    assert parts[0]["type"] == "text"
    assert "[file: notes.md]" in parts[0]["text"]
    assert "# Title" in parts[0]["text"]


def test_fence_is_widened_so_embedded_backticks_cannot_break_out(tmp_path):
    f = tmp_path / "readme.md"
    f.write_text("```\nnested fence\n```", encoding="utf-8")
    parts = content.to_content_parts(_attachment(f, "text/markdown"), multimodal=False)
    assert "````" in parts[0]["text"]


def test_image_becomes_a_data_url_when_a_projector_is_loaded(tmp_path):
    f = _png(tmp_path / "shot.png")
    parts = content.to_content_parts(_attachment(f, "image/png", kind="image"), multimodal=True)

    assert [p["type"] for p in parts] == ["text", "image_url"]
    assert parts[1]["image_url"]["url"].startswith("data:image/png;base64,")


def test_image_on_a_text_only_model_is_described_not_dropped(tmp_path):
    f = _png(tmp_path / "shot.png")
    parts = content.to_content_parts(_attachment(f, "image/png", kind="image"), multimodal=False)

    assert len(parts) == 1
    assert parts[0]["type"] == "text"
    assert "no vision support" in parts[0]["text"]
    assert "shot.png" in parts[0]["text"]


def test_image_format_llama_cpp_cannot_decode_is_described(tmp_path):
    f = tmp_path / "diagram.svg"
    f.write_text("<svg/>", encoding="utf-8")
    parts = content.to_content_parts(_attachment(f, "image/svg+xml", kind="image"), multimodal=True)
    assert "cannot decode" in parts[0]["text"]


def test_oversized_image_is_described_rather_than_encoded(tmp_path):
    f = _png(tmp_path / "big.png")
    attachment = _attachment(f, "image/png", kind="image", size=content.MAX_IMAGE_BYTES + 1)
    parts = content.to_content_parts(attachment, multimodal=True)
    assert "limit" in parts[0]["text"]


def test_missing_file_is_reported_not_crashed(tmp_path):
    attachment = _attachment(tmp_path / "gone.txt", "text/plain", size=10)
    parts = content.to_content_parts(attachment, multimodal=False)
    assert "missing" in parts[0]["text"].lower()


def test_no_attachments_keeps_the_plain_string_shape(tmp_path):
    assert content.build_message_content("just text", [], multimodal=False) == "just text"


def test_message_with_attachments_puts_the_user_text_last(tmp_path):
    f = tmp_path / "data.csv"
    f.write_text("a,b\n1,2\n", encoding="utf-8")
    parts = content.build_message_content(
        "what is in this?", [_attachment(f, "text/csv", kind="document")], multimodal=False
    )

    assert isinstance(parts, list)
    assert parts[-1] == {"type": "text", "text": "what is in this?"}
    assert "data.csv" in parts[0]["text"]


def test_scanned_pdf_says_it_needs_ocr_rather_than_returning_nothing(tmp_path):
    from pypdf import PdfWriter

    f = tmp_path / "scan.pdf"
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    with open(f, "wb") as handle:
        writer.write(handle)

    with pytest.raises(content.ExtractionError, match="OCR"):
        content.extract_text(_attachment(f, "application/pdf"))
