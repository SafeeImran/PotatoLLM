"""Tests for the real log reader (spec section 41)."""
from __future__ import annotations

from potato_core.config import settings
from potato_core.engines import logs as logs_engine

_SAMPLE_LOG = (
    "2026-08-28 20:00:00,123 | INFO     | potato_core.main | Potato Core starting\n"
    "2026-08-28 20:00:01,456 | WARNING  | potato_core.hardware.real | No NVIDIA GPU detected\n"
    "2026-08-28 20:00:02,789 | ERROR    | potato_core.downloads | Download failed\n"
    "Traceback (most recent call last):\n"
    "  File \"x.py\", line 1, in <module>\n"
    "ValueError: boom\n"
    "2026-08-28 20:00:03,012 | INFO     | potato_core.main | Recovered\n"
)


def _write_sample_log():
    settings.logs_dir.mkdir(parents=True, exist_ok=True)
    log_path = settings.logs_dir / "potato-core.log"
    log_path.write_text(_SAMPLE_LOG, encoding="utf-8")
    return log_path


def test_read_logs_returns_empty_when_no_file_exists(tmp_path, monkeypatch):
    monkeypatch.setattr(logs_engine.service, "_log_file_path", lambda: tmp_path / "nonexistent.log")
    result = logs_engine.read_logs()
    assert result["entries"] == []
    assert result["file_exists"] is False


def test_read_logs_parses_real_log_lines():
    _write_sample_log()
    result = logs_engine.read_logs()
    assert result["file_exists"] is True
    assert result["total_matched"] == 4
    # Most recent first.
    assert result["entries"][0]["message"] == "Recovered"
    assert result["entries"][0]["level"] == "INFO"


def test_read_logs_captures_multiline_traceback_as_one_entry():
    _write_sample_log()
    result = logs_engine.read_logs()
    error_entry = next(e for e in result["entries"] if e["level"] == "ERROR")
    assert "Download failed" in error_entry["message"]
    assert "Traceback" in error_entry["message"]
    assert "ValueError: boom" in error_entry["message"]


def test_read_logs_filters_by_level():
    _write_sample_log()
    result = logs_engine.read_logs(level="warning")
    assert result["total_matched"] == 1
    assert result["entries"][0]["level"] == "WARNING"


def test_read_logs_filters_by_search_text():
    _write_sample_log()
    result = logs_engine.read_logs(search="gpu")
    assert result["total_matched"] == 1
    assert "GPU" in result["entries"][0]["message"]


def test_read_logs_respects_limit():
    _write_sample_log()
    result = logs_engine.read_logs(limit=2)
    assert len(result["entries"]) == 2
    assert result["total_matched"] == 4  # matched count reflects the full filtered set, not just what's returned


def test_read_raw_log_returns_full_file_content():
    path = _write_sample_log()
    raw = logs_engine.read_raw_log()
    assert raw == path.read_text(encoding="utf-8")


def test_get_log_file_info_reflects_real_file_state():
    path = _write_sample_log()
    info = logs_engine.get_log_file_info()
    assert info["exists"] is True
    # Compare against the actual file on disk, not the in-memory string —
    # Path.write_text() translates \n -> \r\n on Windows, so the real byte
    # count legitimately differs from len(_SAMPLE_LOG.encode()).
    assert info["size_bytes"] == path.stat().st_size
    assert info["size_bytes"] > 0
