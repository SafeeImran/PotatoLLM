"""Storage Manager (spec section 31) — real on-disk accounting and cleanup.

Everything reported here comes from an actual `stat()` of an actual file, and
everything deleted here is actually removed from disk. Two invariants the rest
of the app depends on:

* **The database and the disk are reconciled, not assumed to agree.** A
  ModelArtifact row whose file has vanished is reported as `missing`; a file
  under the models directory that no artifact row claims is reported as
  `untracked`. Neither is silently hidden — the %APPDATA% data directory
  really does get cleared out from under a running install, and pretending the
  rows are still backed by files produces confusing "load failed" errors
  further downstream.
* **Deletion is guarded, never guessed.** A file is only deleted if it resolves
  inside the managed data directory, an artifact currently loaded for inference
  can't be deleted at all, and an artifact a Build depends on requires an
  explicit force (which then deletes those Builds too, since a Build without
  its file isn't runnable).
"""
from __future__ import annotations

import shutil
from pathlib import Path

from potato_core.config import settings
from potato_core.db.base import get_session
from potato_core.db.models import (
    Benchmark,
    Build,
    Dataset,
    DownloadJob,
    InferenceSession,
    Model,
    ModelArtifact,
    QuantizationJob,
)
from potato_core.engines import settings as app_settings
from potato_core.logging_config import get_logger

log = get_logger("storage")

# Partial-transfer artifacts the Download Manager leaves behind if it is killed
# mid-write; they're real files taking real space but are never usable models.
_PARTIAL_SUFFIXES = (".part", ".tmp", ".download")


class StorageError(Exception):
    pass


# --------------------------------------------------------------------------
# Measurement
# --------------------------------------------------------------------------


def _dir_size_bytes(path: Path) -> int:
    if not path.exists():
        return 0
    total = 0
    for entry in path.rglob("*"):
        if entry.is_file():
            try:
                total += entry.stat().st_size
            except OSError:
                continue
    return total


def _file_size_bytes(path: Path) -> int:
    try:
        return path.stat().st_size
    except OSError:
        return 0


def _gb(num_bytes: int | float) -> float:
    return round(num_bytes / (1024**3), 2)


def get_storage_summary() -> dict:
    """Real per-category usage plus the host drive's actual free space.

    Byte counts are returned alongside the rounded GB values so the UI can show
    an honest "0.01 GB" small file as bytes instead of rounding it to zero.
    """
    models_bytes = _dir_size_bytes(settings.models_dir)
    datasets_bytes = _dir_size_bytes(settings.datasets_dir)
    attachments_bytes = _dir_size_bytes(settings.attachments_dir)
    cache_bytes = _dir_size_bytes(settings.cache_dir)
    logs_bytes = _dir_size_bytes(settings.logs_dir)
    database_bytes = _file_size_bytes(settings.db_path)
    total_bytes = (
        models_bytes
        + datasets_bytes
        + attachments_bytes
        + cache_bytes
        + logs_bytes
        + database_bytes
    )

    disk = shutil.disk_usage(settings.data_dir)
    warning_gb = app_settings.get("low_disk_warning_gb")
    critical_gb = app_settings.get("low_disk_critical_gb")
    free_gb = disk.free / (1024**3)
    if free_gb < critical_gb:
        disk_status = "critical"
    elif free_gb < warning_gb:
        disk_status = "low"
    else:
        disk_status = "ok"

    return {
        "models_bytes": models_bytes,
        "datasets_bytes": datasets_bytes,
        "attachments_bytes": attachments_bytes,
        "cache_bytes": cache_bytes,
        "logs_bytes": logs_bytes,
        "database_bytes": database_bytes,
        "total_bytes": total_bytes,
        # Kept for the existing summary cards, which read GB.
        "models_gb": _gb(models_bytes),
        "datasets_gb": _gb(datasets_bytes),
        "attachments_gb": _gb(attachments_bytes),
        "cache_gb": _gb(cache_bytes),
        "logs_gb": _gb(logs_bytes),
        "database_gb": _gb(database_bytes),
        "total_gb": _gb(total_bytes),
        "data_dir": str(settings.data_dir),
        "models_dir": str(settings.models_dir),
        "datasets_dir": str(settings.datasets_dir),
        "attachments_dir": str(settings.attachments_dir),
        "cache_dir": str(settings.cache_dir),
        "logs_dir": str(settings.logs_dir),
        "disk_total_bytes": disk.total,
        "disk_free_bytes": disk.free,
        "disk_used_bytes": disk.total - disk.free,
        "disk_total_gb": _gb(disk.total),
        "disk_free_gb": _gb(disk.free),
        "disk_status": disk_status,
        "low_disk_warning_gb": warning_gb,
        "low_disk_critical_gb": critical_gb,
    }


def _loaded_artifact_id() -> str | None:
    """The artifact llama-server currently holds open, if any. Imported lazily
    so the storage engine stays usable in contexts (tests, migrations) that
    never touch the inference engine."""
    try:
        from potato_core.engines import inference as inference_engine

        return inference_engine.get_status().get("model_artifact_id")
    except Exception:  # noqa: BLE001 — inference availability must not break a storage read
        log.debug("Could not read inference status while listing storage", exc_info=True)
        return None


def list_stored_models() -> list[dict]:
    """Every ModelArtifact with its real on-disk size and what depends on it."""
    loaded_id = _loaded_artifact_id()

    with get_session() as session:
        rows = (
            session.query(ModelArtifact, Model)
            .join(Model, Model.id == ModelArtifact.model_id)
            .order_by(ModelArtifact.created_at.desc())
            .all()
        )
        builds_by_artifact: dict[str, list[str]] = {}
        for build in session.query(Build).all():
            builds_by_artifact.setdefault(build.model_artifact_id, []).append(build.name)

        entries = []
        for artifact, model in rows:
            path = Path(artifact.file_path)
            exists = path.is_file()
            entries.append(
                {
                    "artifact_id": artifact.id,
                    "model_id": model.id,
                    "model_name": model.name,
                    "quantization": artifact.quantization,
                    "format": artifact.format,
                    "status": artifact.status,
                    "file_path": str(path),
                    "exists": exists,
                    # Real size when the file is there; the recorded size when
                    # it isn't, clearly flagged by `exists` so the UI can say
                    # "missing" rather than imply the space is still in use.
                    "size_bytes": _file_size_bytes(path) if exists else artifact.size_bytes,
                    "created_at": artifact.created_at.isoformat(),
                    "in_use": artifact.id == loaded_id,
                    "used_by_builds": builds_by_artifact.get(artifact.id, []),
                }
            )
        return entries


def list_stored_datasets() -> list[dict]:
    with get_session() as session:
        entries = []
        for dataset in session.query(Dataset).order_by(Dataset.created_at.desc()).all():
            path = Path(dataset.file_path)
            exists = path.is_file()
            entries.append(
                {
                    "dataset_id": dataset.id,
                    "name": dataset.name,
                    "format": dataset.format,
                    "file_path": str(path),
                    "exists": exists,
                    "size_bytes": _file_size_bytes(path) if exists else None,
                    "example_count": dataset.example_count,
                    "created_at": dataset.created_at.isoformat(),
                }
            )
        return entries


# --------------------------------------------------------------------------
# Reconciliation
# --------------------------------------------------------------------------


def _tracked_paths(session) -> set[str]:
    tracked = {
        str(Path(p).resolve())
        for (p,) in session.query(ModelArtifact.file_path).all()
        if p
    }
    # An in-flight download's target path is legitimately on disk without an
    # artifact row yet (the row is only created once the size check passes) —
    # reporting it as junk would invite the user to delete a live transfer.
    tracked |= {
        str(Path(p).resolve())
        for (p,) in session.query(DownloadJob.file_path).all()
        if p
    }
    return tracked


def find_orphans() -> dict:
    """Reconciles the models directory against the artifact table.

    Returns `untracked_files` (real files nothing in the DB claims) and
    `missing_artifacts` (DB rows whose file is gone).
    """
    with get_session() as session:
        tracked = _tracked_paths(session)
        missing = []
        for artifact, model in (
            session.query(ModelArtifact, Model)
            .join(Model, Model.id == ModelArtifact.model_id)
            .all()
        ):
            if not Path(artifact.file_path).is_file():
                missing.append(
                    {
                        "artifact_id": artifact.id,
                        "model_id": model.id,
                        "model_name": model.name,
                        "quantization": artifact.quantization,
                        "file_path": artifact.file_path,
                        "recorded_size_bytes": artifact.size_bytes,
                    }
                )

    untracked = []
    models_dir = settings.models_dir
    if models_dir.exists():
        for entry in sorted(models_dir.rglob("*")):
            if not entry.is_file():
                continue
            resolved = str(entry.resolve())
            if resolved in tracked:
                continue
            untracked.append(
                {
                    "file_path": resolved,
                    "relative_path": str(entry.relative_to(models_dir)),
                    "size_bytes": _file_size_bytes(entry),
                    "is_partial_download": entry.suffix.lower() in _PARTIAL_SUFFIXES,
                }
            )

    return {
        "untracked_files": untracked,
        "missing_artifacts": missing,
        "untracked_bytes": sum(f["size_bytes"] for f in untracked),
    }


# --------------------------------------------------------------------------
# Deletion
# --------------------------------------------------------------------------


def _assert_inside_data_dir(path: Path) -> Path:
    """Refuses any path outside the managed data directory.

    The delete-a-file endpoint takes a path from the client, so this is the
    boundary that keeps a malformed or hostile request from reaching, say,
    C:\\Windows. Resolved first so `..` segments and symlinks can't slip past.
    """
    resolved = path.resolve()
    root = settings.data_dir.resolve()
    if not resolved.is_relative_to(root):
        raise StorageError(f"Refusing to touch '{resolved}' — it is outside {root}")
    return resolved


def _prune_empty_parents(path: Path) -> None:
    """Removes now-empty per-model subdirectories left behind by a deletion,
    stopping at the models directory itself."""
    root = settings.models_dir.resolve()
    parent = path.parent.resolve()
    while parent != root and parent.is_relative_to(root):
        try:
            if any(parent.iterdir()):
                return
            parent.rmdir()
        except OSError:
            return
        parent = parent.parent


def _detach_artifact_references(session, artifact_id: str) -> None:
    """Nulls the nullable references to an artifact so history (benchmarks,
    past sessions, the job that produced it) survives the file being deleted.
    SQLite doesn't enforce these FKs by default, but leaving dangling ids would
    make later joins silently drop rows."""
    session.query(Benchmark).filter(Benchmark.model_artifact_id == artifact_id).update(
        {Benchmark.model_artifact_id: None}, synchronize_session=False
    )
    session.query(InferenceSession).filter(InferenceSession.model_artifact_id == artifact_id).update(
        {InferenceSession.model_artifact_id: None}, synchronize_session=False
    )
    session.query(DownloadJob).filter(DownloadJob.output_artifact_id == artifact_id).update(
        {DownloadJob.output_artifact_id: None}, synchronize_session=False
    )
    session.query(QuantizationJob).filter(QuantizationJob.output_artifact_id == artifact_id).update(
        {QuantizationJob.output_artifact_id: None}, synchronize_session=False
    )
    session.query(QuantizationJob).filter(QuantizationJob.source_artifact_id == artifact_id).update(
        {QuantizationJob.source_artifact_id: None}, synchronize_session=False
    )


def delete_artifact(artifact_id: str, force: bool = False) -> dict:
    """Deletes a model file and its artifact row.

    Refuses while the model is loaded for inference (the file is open and
    llama-server would keep serving a deleted file). Refuses when a Build
    depends on it unless `force`, which then deletes those Builds too — a Build
    pointing at a deleted file can't be run or benchmarked.
    """
    if _loaded_artifact_id() == artifact_id:
        raise StorageError(
            "This model is currently loaded for inference. Unload it from the Playground first."
        )

    with get_session() as session:
        artifact = session.get(ModelArtifact, artifact_id)
        if artifact is None:
            raise StorageError(f"Unknown model artifact '{artifact_id}'")

        builds = session.query(Build).filter(Build.model_artifact_id == artifact_id).all()
        build_names = [b.name for b in builds]
        if build_names and not force:
            raise StorageError(
                f"{len(build_names)} build(s) use this model: {', '.join(build_names)}. "
                "Delete them too, or remove them first."
            )

        path = Path(artifact.file_path)
        freed_bytes = _file_size_bytes(path) if path.is_file() else 0
        file_deleted = False
        if path.is_file():
            _assert_inside_data_dir(path)
            path.unlink()
            _prune_empty_parents(path)
            file_deleted = True

        for build in builds:
            session.query(Benchmark).filter(Benchmark.build_id == build.id).update(
                {Benchmark.build_id: None}, synchronize_session=False
            )
            session.query(InferenceSession).filter(InferenceSession.build_id == build.id).update(
                {InferenceSession.build_id: None}, synchronize_session=False
            )
            session.delete(build)

        _detach_artifact_references(session, artifact_id)
        session.delete(artifact)

    log.info("Deleted artifact %s (%d bytes freed, %d builds removed)", artifact_id, freed_bytes, len(build_names))
    return {
        "artifact_id": artifact_id,
        "file_deleted": file_deleted,
        "freed_bytes": freed_bytes,
        "deleted_builds": build_names,
    }


def delete_untracked_file(file_path: str) -> dict:
    """Deletes one file reported by `find_orphans()`.

    Re-derives orphan status rather than trusting the caller: a file that has
    become tracked since the UI last refreshed must not be deleted.
    """
    path = _assert_inside_data_dir(Path(file_path))
    if not path.is_file():
        raise StorageError(f"'{path}' is not a file")

    with get_session() as session:
        if str(path) in _tracked_paths(session):
            raise StorageError(
                f"'{path.name}' is tracked by a model artifact or an active download — "
                "delete the model itself instead."
            )

    freed_bytes = _file_size_bytes(path)
    path.unlink()
    _prune_empty_parents(path)
    log.info("Deleted untracked file %s (%d bytes freed)", path, freed_bytes)
    return {"file_path": str(path), "freed_bytes": freed_bytes}


def purge_missing_artifacts() -> dict:
    """Drops artifact rows whose files are gone, plus any Builds that pointed at
    them. Touches no files — there are none left to touch."""
    purged: list[str] = []
    removed_builds: list[str] = []

    with get_session() as session:
        for artifact in session.query(ModelArtifact).all():
            if Path(artifact.file_path).is_file():
                continue
            for build in session.query(Build).filter(Build.model_artifact_id == artifact.id).all():
                session.query(Benchmark).filter(Benchmark.build_id == build.id).update(
                    {Benchmark.build_id: None}, synchronize_session=False
                )
                session.query(InferenceSession).filter(InferenceSession.build_id == build.id).update(
                    {InferenceSession.build_id: None}, synchronize_session=False
                )
                removed_builds.append(build.name)
                session.delete(build)
            _detach_artifact_references(session, artifact.id)
            purged.append(artifact.id)
            session.delete(artifact)

    if purged:
        log.info("Purged %d artifact row(s) with no file on disk", len(purged))
    return {"purged_artifact_ids": purged, "deleted_builds": removed_builds}


def clear_cache() -> dict:
    """Empties the cache directory. Nothing in it is authoritative — it is
    recreated on demand — so this is safe to run at any time."""
    cache_dir = settings.cache_dir
    before_bytes = _dir_size_bytes(cache_dir)
    if cache_dir.exists():
        for entry in cache_dir.iterdir():
            try:
                if entry.is_dir():
                    shutil.rmtree(entry)
                else:
                    entry.unlink()
            except OSError:
                log.warning("Could not remove cache entry %s", entry, exc_info=True)
    cache_dir.mkdir(parents=True, exist_ok=True)
    # Measured, not assumed: an entry held open by another process stays put,
    # and the reported number has to reflect that.
    freed_bytes = before_bytes - _dir_size_bytes(cache_dir)
    log.info("Cleared cache (%d bytes freed)", freed_bytes)
    return {"freed_bytes": freed_bytes}
