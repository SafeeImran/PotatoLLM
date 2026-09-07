"""Tests for the Dataset Manager's DB-backed service layer."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from potato_core.engines import datasets as dataset_engine


def _write_source(tmp_path: Path, name: str, n: int = 5) -> Path:
    p = tmp_path / name
    p.write_text("\n".join(json.dumps({"text": f"Example {i}"}) for i in range(n)), encoding="utf-8")
    return p


def test_register_dataset_copies_file_and_analyzes(tmp_path):
    source = _write_source(tmp_path, "mydata.jsonl")
    result = dataset_engine.register_dataset("My Dataset", str(source))

    assert result["name"] == "My Dataset"
    assert result["format"] == "jsonl"
    assert result["example_count"] == 5
    assert result["valid_pct"] == 100.0
    assert Path(result["file_path"]).exists()
    assert Path(result["file_path"]) != source  # copied, not referencing the original


def test_register_dataset_for_missing_file_raises():
    with pytest.raises(dataset_engine.DatasetError, match="File not found"):
        dataset_engine.register_dataset("X", "C:\\does\\not\\exist.jsonl")


def test_register_dataset_for_unsupported_extension_raises(tmp_path):
    p = tmp_path / "data.parquet"
    p.write_text("irrelevant")
    with pytest.raises(dataset_engine.DatasetError, match="Unsupported"):
        dataset_engine.register_dataset("X", str(p))


def test_get_dataset_returns_registered_dataset(tmp_path):
    source = _write_source(tmp_path, "d.jsonl")
    created = dataset_engine.register_dataset("Fetch Me", str(source))
    fetched = dataset_engine.get_dataset(created["id"])
    assert fetched["id"] == created["id"]
    assert fetched["name"] == "Fetch Me"


def test_get_unknown_dataset_raises():
    with pytest.raises(dataset_engine.DatasetError):
        dataset_engine.get_dataset("does-not-exist")


def test_list_datasets_includes_registered_dataset(tmp_path):
    source = _write_source(tmp_path, "d.jsonl")
    created = dataset_engine.register_dataset("Listed", str(source))
    all_datasets = dataset_engine.list_datasets()
    assert any(d["id"] == created["id"] for d in all_datasets)


def test_reanalyze_dataset_recomputes_stats_after_file_changes(tmp_path):
    source = _write_source(tmp_path, "d.jsonl", n=3)
    created = dataset_engine.register_dataset("Reanalyze Me", str(source))
    assert created["example_count"] == 3

    # Overwrite the copied file in place with more examples, then re-analyze.
    target = Path(created["file_path"])
    target.write_text("\n".join(json.dumps({"text": f"Example {i}"}) for i in range(10)), encoding="utf-8")

    reanalyzed = dataset_engine.analyze_dataset(created["id"])
    assert reanalyzed["example_count"] == 10


def test_delete_dataset_removes_row_and_file(tmp_path):
    source = _write_source(tmp_path, "d.jsonl")
    created = dataset_engine.register_dataset("Doomed", str(source))
    file_path = Path(created["file_path"])
    assert file_path.exists()

    dataset_engine.delete_dataset(created["id"])

    with pytest.raises(dataset_engine.DatasetError):
        dataset_engine.get_dataset(created["id"])
    assert not file_path.exists()


def test_delete_unknown_dataset_raises():
    with pytest.raises(dataset_engine.DatasetError):
        dataset_engine.delete_dataset("does-not-exist")


def test_registration_survives_a_corrupt_file_with_null_stats(tmp_path):
    """Analysis failure shouldn't erase the registration — the file was
    still safely copied, so the record should stay visible for the user to
    investigate rather than silently disappearing."""
    p = tmp_path / "corrupt.json"
    p.write_text("{this is not valid json at all", encoding="utf-8")

    result = dataset_engine.register_dataset("Corrupt", str(p))
    assert result["id"]
    assert result["example_count"] is None
