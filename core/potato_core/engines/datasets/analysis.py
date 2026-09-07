"""Pure dataset parsing/analysis logic (spec section 24) — no DB, no I/O
beyond reading the given file, so it's cheap to test exhaustively.

Recognizes the common instruction-tuning record shapes without assuming a
single fixed schema:
  - {"text": "..."}
  - {"messages": [{"role": "...", "content": "..."}, ...]}   (chat format)
  - {"prompt": "...", "completion"|"response"|"output": "..."}
  - {"instruction": "...", "output": "...", "input": "..." (optional)}
A record matching none of these is counted as invalid ("missing fields"),
not silently skipped — spec explicitly wants malformed/missing-field counts
surfaced, not hidden.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
from dataclasses import dataclass, field
from pathlib import Path

import tiktoken

SUPPORTED_FORMATS = ("jsonl", "json", "csv", "txt")

# cl100k_base is a real, widely-used tokenizer (GPT-3.5/4's) — a reasonable,
# consistent stand-in for "estimated tokens" across arbitrary base models,
# which each have their own tokenizer we can't assume without loading one.
# Downloads its vocab file once on first use, then caches it locally.
_encoding = None


def _get_encoding():
    global _encoding
    if _encoding is None:
        _encoding = tiktoken.get_encoding("cl100k_base")
    return _encoding


def count_tokens(text: str) -> int:
    return len(_get_encoding().encode(text, disallowed_special=()))


@dataclass
class ParsedRecord:
    text: str | None  # None means invalid/unparseable
    invalid_reason: str | None = None


@dataclass
class DatasetAnalysis:
    example_count: int
    valid_count: int
    invalid_count: int
    duplicate_count: int
    estimated_tokens: int
    avg_tokens: float | None
    max_tokens: int | None
    valid_pct: float
    duplicate_pct: float
    invalid_reasons: dict[str, int] = field(default_factory=dict)


def detect_format(file_path: Path) -> str:
    ext = file_path.suffix.lower().lstrip(".")
    if ext not in SUPPORTED_FORMATS:
        raise ValueError(f"Unsupported dataset format '.{ext}' — expected one of {SUPPORTED_FORMATS}")
    return ext


def _extract_text_from_record(obj: object) -> ParsedRecord:
    if not isinstance(obj, dict):
        return ParsedRecord(text=None, invalid_reason="not a JSON object")

    if isinstance(obj.get("text"), str) and obj["text"].strip():
        return ParsedRecord(text=obj["text"])

    messages = obj.get("messages")
    if isinstance(messages, list) and messages:
        parts = [m.get("content", "") for m in messages if isinstance(m, dict) and isinstance(m.get("content"), str)]
        joined = "\n".join(p for p in parts if p.strip())
        if joined.strip():
            return ParsedRecord(text=joined)
        return ParsedRecord(text=None, invalid_reason="messages present but no usable content")

    prompt = obj.get("prompt")
    completion = obj.get("completion") or obj.get("response") or obj.get("output")
    if isinstance(prompt, str) and isinstance(completion, str) and prompt.strip() and completion.strip():
        return ParsedRecord(text=f"{prompt}\n{completion}")

    instruction = obj.get("instruction")
    output = obj.get("output")
    if isinstance(instruction, str) and isinstance(output, str) and instruction.strip() and output.strip():
        extra = obj.get("input")
        joined = f"{instruction}\n{extra}\n{output}" if isinstance(extra, str) and extra.strip() else f"{instruction}\n{output}"
        return ParsedRecord(text=joined)

    return ParsedRecord(text=None, invalid_reason="missing recognized fields (text/messages/prompt+completion/instruction+output)")


def _parse_jsonl(raw: str) -> list[ParsedRecord]:
    records = []
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            records.append(ParsedRecord(text=None, invalid_reason="invalid JSON"))
            continue
        records.append(_extract_text_from_record(obj))
    return records


def _parse_json(raw: str) -> list[ParsedRecord]:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON file: {exc}") from exc
    if not isinstance(data, list):
        raise ValueError("Top-level JSON must be an array of examples")
    return [_extract_text_from_record(obj) for obj in data]


def _parse_csv(raw: str) -> list[ParsedRecord]:
    reader = csv.DictReader(io.StringIO(raw))
    if reader.fieldnames is None:
        return []
    records = []
    for row in reader:
        records.append(_extract_text_from_record(dict(row)))
    return records


def _parse_txt(raw: str) -> list[ParsedRecord]:
    return [ParsedRecord(text=line.strip()) for line in raw.splitlines() if line.strip()]


_PARSERS = {"jsonl": _parse_jsonl, "json": _parse_json, "csv": _parse_csv, "txt": _parse_txt}


def analyze_file(file_path: Path, format: str | None = None) -> DatasetAnalysis:
    fmt = format or detect_format(file_path)
    if fmt not in _PARSERS:
        raise ValueError(f"Unsupported dataset format '{fmt}' — expected one of {SUPPORTED_FORMATS}")

    raw = file_path.read_text(encoding="utf-8", errors="replace")
    records = _PARSERS[fmt](raw)

    valid_records = [r for r in records if r.text is not None]
    invalid_records = [r for r in records if r.text is None]

    invalid_reasons: dict[str, int] = {}
    for r in invalid_records:
        key = r.invalid_reason or "unknown"
        invalid_reasons[key] = invalid_reasons.get(key, 0) + 1

    seen_hashes: set[str] = set()
    duplicate_count = 0
    token_counts: list[int] = []
    for r in valid_records:
        normalized = r.text.strip()
        h = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
        if h in seen_hashes:
            duplicate_count += 1
        else:
            seen_hashes.add(h)
        token_counts.append(count_tokens(normalized))

    total = len(records)
    valid_count = len(valid_records)
    estimated_tokens = sum(token_counts)

    return DatasetAnalysis(
        example_count=total,
        valid_count=valid_count,
        invalid_count=len(invalid_records),
        duplicate_count=duplicate_count,
        estimated_tokens=estimated_tokens,
        avg_tokens=(estimated_tokens / valid_count) if valid_count else None,
        max_tokens=max(token_counts) if token_counts else None,
        valid_pct=round((valid_count / total) * 100, 1) if total else 0.0,
        duplicate_pct=round((duplicate_count / valid_count) * 100, 1) if valid_count else 0.0,
        invalid_reasons=invalid_reasons,
    )
