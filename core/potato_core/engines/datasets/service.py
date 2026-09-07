"""Dataset Manager (spec section 24) — real implementation.

Registers a dataset by copying the source file into Potato's own storage
(settings.datasets_dir), running the real analysis in analysis.py, and
persisting the result. Nothing here is estimated by guesswork — every
number comes from actually parsing the file.
"""
from __future__ import annotations

import shutil
from pathlib import Path

from potato_core.config import settings
from potato_core.db.base import get_session
from potato_core.db.models import Dataset
from potato_core.engines.datasets.analysis import DatasetAnalysis, analyze_file, detect_format
from potato_core.logging_config import get_logger

log = get_logger("datasets")


class DatasetError(Exception):
    pass


def register_dataset(name: str, source_path: str) -> dict:
    source = Path(source_path)
    if not source.exists() or not source.is_file():
        raise DatasetError(f"File not found: {source_path}")

    try:
        fmt = detect_format(source)
    except ValueError as exc:
        raise DatasetError(str(exc)) from exc

    with get_session() as session:
        dataset = Dataset(name=name, file_path="", format=fmt)
        session.add(dataset)
        session.flush()
        dataset_id = dataset.id

    target_dir = settings.datasets_dir / dataset_id
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / source.name
    shutil.copyfile(source, target)

    with get_session() as session:
        dataset = session.get(Dataset, dataset_id)
        dataset.file_path = str(target)

    try:
        return analyze_dataset(dataset_id)
    except DatasetError:
        # Registration itself succeeded (the file is safely copied) — an
        # analysis failure (e.g. corrupt file) shouldn't erase the record;
        # it stays visible with null stats so the user can see it needs attention.
        log.warning("Analysis failed for newly registered dataset %s", dataset_id, exc_info=True)
        return get_dataset(dataset_id)


def analyze_dataset(dataset_id: str) -> dict:
    with get_session() as session:
        dataset = session.get(Dataset, dataset_id)
        if dataset is None:
            raise DatasetError(f"Unknown dataset '{dataset_id}'")
        file_path = Path(dataset.file_path)
        fmt = dataset.format

    try:
        result: DatasetAnalysis = analyze_file(file_path, fmt)
    except (ValueError, OSError) as exc:
        raise DatasetError(f"Could not analyze dataset: {exc}") from exc

    with get_session() as session:
        dataset = session.get(Dataset, dataset_id)
        dataset.example_count = result.example_count
        dataset.estimated_tokens = result.estimated_tokens
        dataset.avg_tokens = result.avg_tokens
        dataset.max_tokens = result.max_tokens
        dataset.duplicate_pct = result.duplicate_pct
        dataset.valid_pct = result.valid_pct

    return get_dataset(dataset_id)


def list_datasets() -> list[dict]:
    with get_session() as session:
        rows = session.query(Dataset).order_by(Dataset.created_at.desc()).all()
        return [_serialize(d) for d in rows]


def get_dataset(dataset_id: str) -> dict:
    with get_session() as session:
        dataset = session.get(Dataset, dataset_id)
        if dataset is None:
            raise DatasetError(f"Unknown dataset '{dataset_id}'")
        return _serialize(dataset)


def delete_dataset(dataset_id: str) -> None:
    with get_session() as session:
        dataset = session.get(Dataset, dataset_id)
        if dataset is None:
            raise DatasetError(f"Unknown dataset '{dataset_id}'")
        file_path = Path(dataset.file_path) if dataset.file_path else None
        session.delete(dataset)

    if file_path and file_path.exists():
        shutil.rmtree(file_path.parent, ignore_errors=True)


def _serialize(dataset: Dataset) -> dict:
    return {
        "id": dataset.id,
        "name": dataset.name,
        "file_path": dataset.file_path,
        "format": dataset.format,
        "example_count": dataset.example_count,
        "estimated_tokens": dataset.estimated_tokens,
        "avg_tokens": dataset.avg_tokens,
        "max_tokens": dataset.max_tokens,
        "duplicate_pct": dataset.duplicate_pct,
        "valid_pct": dataset.valid_pct,
        "created_at": dataset.created_at,
    }
