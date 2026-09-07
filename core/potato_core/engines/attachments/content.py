"""Turns a stored attachment into something a model can actually consume.

No LLM ingests a PDF or a .docx — llama.cpp included. Products that "support
file upload" all extract text in their own application layer first, and that is
what this module does. Images are different: llama.cpp *can* see them, but only
when a vision model is loaded with its mmproj projector, so the caller passes
`multimodal` and gets an honest note back instead of an image part when the
loaded model has no eyes.

Output is OpenAI-style content parts, which is exactly what llama-server's
/v1/chat/completions accepts.
"""
from __future__ import annotations

import base64
import json
import xml.etree.ElementTree as ElementTree
import zipfile
from pathlib import Path

from potato_core.logging_config import get_logger

log = get_logger("attachments.content")

# Big enough for a long document, small enough that one attachment can't blow
# the context window on its own. Truncation is always announced in the output.
MAX_TEXT_CHARS = 60_000

# Guard against a multi-hundred-MB "image" being base64'd into a request body.
MAX_IMAGE_BYTES = 20 * 1024 * 1024

# Formats llama.cpp's mtmd stack decodes. Anything else is described, not sent.
SUPPORTED_IMAGE_MIME = {"image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp"}

# Extensions that are plain text even when mimetypes disagrees or returns None.
TEXT_EXTENSIONS = {
    ".txt", ".md", ".markdown", ".rst", ".log", ".csv", ".tsv", ".json", ".jsonl",
    ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".env", ".xml", ".html", ".htm",
    ".py", ".js", ".jsx", ".ts", ".tsx", ".rs", ".go", ".java", ".c", ".h", ".cpp",
    ".hpp", ".cs", ".rb", ".php", ".sh", ".bash", ".ps1", ".sql", ".r", ".swift",
    ".kt", ".scala", ".lua", ".pl", ".vim", ".dockerfile", ".gitignore", ".gradle",
}

_DOCX_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


class ExtractionError(Exception):
    pass


def _read_text_file(path: Path) -> str:
    # Model output is going to quote this back; a hard decode failure on one
    # stray byte would be worse than replacing it.
    raw = path.read_bytes()
    return raw.decode("utf-8", errors="replace")


def _read_pdf(path: Path) -> str:
    try:
        from pypdf import PdfReader
    except ImportError as exc:  # pragma: no cover - dependency is declared
        raise ExtractionError("PDF support needs the 'pypdf' package") from exc

    reader = PdfReader(str(path))
    pages = []
    for number, page in enumerate(reader.pages, start=1):
        text = (page.extract_text() or "").strip()
        if text:
            pages.append(f"[page {number}]\n{text}")
    if not pages:
        raise ExtractionError(
            "No text layer found — this looks like a scanned PDF, which needs OCR"
        )
    return "\n\n".join(pages)


def _read_docx(path: Path) -> str:
    """.docx is a zip of XML, so this needs no third-party dependency."""
    try:
        with zipfile.ZipFile(path) as archive:
            xml = archive.read("word/document.xml")
    except (zipfile.BadZipFile, KeyError) as exc:
        raise ExtractionError("Not a readable .docx file") from exc

    root = ElementTree.fromstring(xml)
    paragraphs = []
    for para in root.iter(f"{_DOCX_NS}p"):
        runs = [node.text or "" for node in para.iter(f"{_DOCX_NS}t")]
        line = "".join(runs).strip()
        if line:
            paragraphs.append(line)
    return "\n\n".join(paragraphs)


def _is_text_like(path: Path, mime_type: str | None) -> bool:
    if path.suffix.lower() in TEXT_EXTENSIONS:
        return True
    if mime_type is None:
        return False
    return mime_type.startswith("text/") or mime_type in {
        "application/json", "application/xml", "application/javascript",
        "application/x-yaml", "application/toml",
    }


def extract_text(attachment: dict) -> str:
    """Plain text for a document-ish attachment. Raises ExtractionError otherwise."""
    path = Path(attachment["file_path"])
    if not path.exists():
        raise ExtractionError(f"File is missing on disk: {path}")

    mime_type = attachment.get("mime_type")
    suffix = path.suffix.lower()

    if suffix == ".pdf" or mime_type == "application/pdf":
        text = _read_pdf(path)
    elif suffix == ".docx":
        text = _read_docx(path)
    elif _is_text_like(path, mime_type):
        text = _read_text_file(path)
    else:
        raise ExtractionError(f"No text extractor for '{mime_type or suffix or 'unknown type'}'")

    if len(text) > MAX_TEXT_CHARS:
        text = text[:MAX_TEXT_CHARS] + f"\n\n[truncated at {MAX_TEXT_CHARS:,} characters]"
    return text


def _data_url(attachment: dict) -> str:
    path = Path(attachment["file_path"])
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{attachment['mime_type']};base64,{encoded}"


def _describe(attachment: dict, reason: str) -> dict:
    size_kb = (attachment.get("size_bytes") or 0) / 1024
    return {
        "type": "text",
        "text": (
            f"[attachment: {attachment['file_name']} "
            f"({attachment.get('mime_type') or 'unknown type'}, {size_kb:,.0f} KB) "
            f"— contents not included: {reason}]"
        ),
    }


def to_content_parts(attachment: dict, multimodal: bool) -> list[dict]:
    """One attachment -> the content parts representing it in a chat message."""
    path = Path(attachment["file_path"])
    mime_type = attachment.get("mime_type") or ""

    if attachment.get("kind") == "image" or mime_type.startswith("image/"):
        if not multimodal:
            return [_describe(attachment, "the loaded model has no vision support")]
        if mime_type not in SUPPORTED_IMAGE_MIME:
            return [_describe(attachment, f"llama.cpp cannot decode {mime_type}")]
        if not path.exists():
            return [_describe(attachment, "the file is missing on disk")]
        if (attachment.get("size_bytes") or 0) > MAX_IMAGE_BYTES:
            return [_describe(attachment, f"larger than the {MAX_IMAGE_BYTES // 1024 // 1024} MB limit")]
        return [
            {"type": "text", "text": f"[image: {attachment['file_name']}]"},
            {"type": "image_url", "image_url": {"url": _data_url(attachment)}},
        ]

    try:
        text = extract_text(attachment)
    except ExtractionError as exc:
        return [_describe(attachment, str(exc))]

    fence = "```"
    while fence in text:
        fence += "`"
    return [
        {
            "type": "text",
            "text": f"[file: {attachment['file_name']}]\n{fence}\n{text}\n{fence}",
        }
    ]


def build_message_content(text: str, attachments: list[dict], multimodal: bool) -> str | list[dict]:
    """Merges the typed message with its attachments.

    Returns a plain string when there is nothing attached, so the overwhelmingly
    common case keeps the exact request shape llama-server saw before.
    """
    if not attachments:
        return text

    parts: list[dict] = []
    for attachment in attachments:
        parts.extend(to_content_parts(attachment, multimodal))
    if text:
        parts.append({"type": "text", "text": text})

    log.debug("Built %d content part(s) from %d attachment(s)", len(parts), len(attachments))
    return parts


def summarize_for_log(content: str | list[dict]) -> str:
    """Compact description of a message body — keeps base64 blobs out of logs."""
    if isinstance(content, str):
        return f"text({len(content)} chars)"
    return json.dumps([part.get("type") for part in content])
