"""Tests for the Storage Manager (spec section 31).

Every assertion here is against real files in the test data directory —
`get_storage_summary()` must report bytes that were actually written, and
`delete_*` must actually remove them.
"""
from __future__ import annotations

import pytest

from potato_core.config import settings
from potato_core.db.base import get_session
from potato_core.db.models import Benchmark, Build, Model, ModelArtifact
from potato_core.engines import settings as app_settings
from potato_core.engines import storage as storage_engine
from potato_core.engines.models import seed_models


@pytest.fixture(autouse=True)
def _clean_slate():
    seed_models()
    app_settings.reset()
    yield
    with get_session() as session:
        session.query(Benchmark).delete()
        session.query(Build).delete()
        session.query(ModelArtifact).delete()
    for entry in list(settings.models_dir.rglob("*")):
        if entry.is_file():
            entry.unlink(missing_ok=True)
    app_settings.reset()


def _model_id() -> str:
    with get_session() as session:
        return session.query(Model).first().id


def _make_artifact(name: str, size: int, quantization: str = "Q4_K_M") -> tuple[str, str]:
    """Writes a real file of `size` bytes and registers a ModelArtifact for it."""
    model_id = _model_id()
    path = settings.models_dir / model_id / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"\0" * size)
    with get_session() as session:
        artifact = ModelArtifact(
            model_id=model_id,
            format="gguf",
            quantization=quantization,
            file_path=str(path),
            size_bytes=size,
            status="verified",
        )
        session.add(artifact)
        session.flush()
        return artifact.id, str(path)


# --------------------------------------------------------------------------
# Measurement
# --------------------------------------------------------------------------


def test_summary_reports_bytes_that_were_really_written():
    before = storage_engine.get_storage_summary()
    _make_artifact("measured.gguf", 4096)
    after = storage_engine.get_storage_summary()
    assert after["models_bytes"] == before["models_bytes"] + 4096
    assert after["total_bytes"] >= after["models_bytes"]


def test_summary_counts_attachments_directory():
    before = storage_engine.get_storage_summary()
    attachment_dir = settings.attachments_dir / "test-attachment"
    attachment_dir.mkdir(parents=True, exist_ok=True)
    (attachment_dir / "file.bin").write_bytes(b"\0" * 2048)
    after = storage_engine.get_storage_summary()
    assert after["attachments_bytes"] == before["attachments_bytes"] + 2048
    assert after["total_bytes"] == before["total_bytes"] + 2048


def test_summary_reports_real_free_space_and_classifies_it_against_the_settings():
    import shutil

    summary = storage_engine.get_storage_summary()
    real_free = shutil.disk_usage(settings.data_dir).free
    # Free space moves between the two reads, so compare within a wide margin
    # rather than exactly — the point is that it is a real reading.
    assert abs(summary["disk_free_bytes"] - real_free) < 5 * 1024**3
    assert summary["disk_used_bytes"] == summary["disk_total_bytes"] - summary["disk_free_bytes"]

    free_gb = summary["disk_free_bytes"] / (1024**3)
    app_settings.set_value("low_disk_warning_gb", min(free_gb + 1, 500.0))
    if free_gb + 1 <= 500.0:
        assert storage_engine.get_storage_summary()["disk_status"] in ("low", "critical")


def test_listing_reports_the_real_on_disk_size_not_just_the_recorded_one():
    artifact_id, path = _make_artifact("resized.gguf", 1024)
    # Simulate a file that changed on disk behind the database's back.
    with open(path, "wb") as handle:
        handle.write(b"\0" * 2048)

    entry = next(e for e in storage_engine.list_stored_models() if e["artifact_id"] == artifact_id)
    assert entry["exists"] is True
    assert entry["size_bytes"] == 2048
    assert entry["in_use"] is False
    assert entry["used_by_builds"] == []


def test_listing_flags_an_artifact_whose_file_has_vanished():
    from pathlib import Path

    artifact_id, path = _make_artifact("vanishing.gguf", 512)
    Path(path).unlink()

    entry = next(e for e in storage_engine.list_stored_models() if e["artifact_id"] == artifact_id)
    assert entry["exists"] is False
    assert entry["size_bytes"] == 512  # the recorded size, clearly flagged as gone


def test_listing_names_the_builds_that_depend_on_an_artifact():
    artifact_id, _ = _make_artifact("built.gguf", 256)
    with get_session() as session:
        session.add(
            Build(name="My Build", base_model_id=_model_id(), model_artifact_id=artifact_id)
        )

    entry = next(e for e in storage_engine.list_stored_models() if e["artifact_id"] == artifact_id)
    assert entry["used_by_builds"] == ["My Build"]


# --------------------------------------------------------------------------
# Reconciliation
# --------------------------------------------------------------------------


def test_orphan_scan_finds_untracked_files_and_missing_rows():
    from pathlib import Path

    tracked_id, _ = _make_artifact("tracked.gguf", 128)
    missing_id, missing_path = _make_artifact("gone.gguf", 64)
    Path(missing_path).unlink()

    stray = settings.models_dir / "stray.gguf"
    stray.write_bytes(b"\0" * 32)
    partial = settings.models_dir / "half-done.gguf.part"
    partial.write_bytes(b"\0" * 16)

    report = storage_engine.find_orphans()
    untracked = {f["relative_path"]: f for f in report["untracked_files"]}

    assert "stray.gguf" in untracked
    assert untracked["stray.gguf"]["size_bytes"] == 32
    assert untracked["half-done.gguf.part"]["is_partial_download"] is True
    assert untracked["stray.gguf"]["is_partial_download"] is False
    assert report["untracked_bytes"] == 48

    # A file a real artifact claims is never called untracked.
    assert not any("tracked.gguf" in path for path in untracked)
    assert {a["artifact_id"] for a in report["missing_artifacts"]} == {missing_id}
    assert tracked_id not in {a["artifact_id"] for a in report["missing_artifacts"]}


def test_purge_missing_drops_only_rows_whose_files_are_gone():
    from pathlib import Path

    kept_id, _ = _make_artifact("kept.gguf", 128)
    gone_id, gone_path = _make_artifact("purged.gguf", 128)
    Path(gone_path).unlink()

    result = storage_engine.purge_missing_artifacts()
    assert result["purged_artifact_ids"] == [gone_id]

    with get_session() as session:
        assert session.get(ModelArtifact, gone_id) is None
        assert session.get(ModelArtifact, kept_id) is not None


def test_purge_missing_also_removes_builds_that_can_no_longer_run():
    from pathlib import Path

    artifact_id, path = _make_artifact("orphaned-build.gguf", 128)
    with get_session() as session:
        session.add(Build(name="Doomed", base_model_id=_model_id(), model_artifact_id=artifact_id))
    Path(path).unlink()

    result = storage_engine.purge_missing_artifacts()
    assert result["deleted_builds"] == ["Doomed"]
    with get_session() as session:
        assert session.query(Build).filter(Build.name == "Doomed").count() == 0


# --------------------------------------------------------------------------
# Deletion
# --------------------------------------------------------------------------


def test_delete_artifact_removes_the_real_file_and_the_row():
    from pathlib import Path

    artifact_id, path = _make_artifact("deleteme.gguf", 2048)

    result = storage_engine.delete_artifact(artifact_id)
    assert result["file_deleted"] is True
    assert result["freed_bytes"] == 2048
    assert not Path(path).exists()
    with get_session() as session:
        assert session.get(ModelArtifact, artifact_id) is None


def test_delete_artifact_prunes_the_now_empty_model_directory():
    from pathlib import Path

    artifact_id, path = _make_artifact("only-file.gguf", 128)
    parent = Path(path).parent

    storage_engine.delete_artifact(artifact_id)
    assert not parent.exists()
    assert settings.models_dir.exists()  # never prunes past the managed root


def test_delete_artifact_refuses_while_a_build_depends_on_it():
    artifact_id, _ = _make_artifact("depended-on.gguf", 128)
    with get_session() as session:
        session.add(Build(name="Needs It", base_model_id=_model_id(), model_artifact_id=artifact_id))

    with pytest.raises(storage_engine.StorageError, match="Needs It"):
        storage_engine.delete_artifact(artifact_id)

    with get_session() as session:
        assert session.get(ModelArtifact, artifact_id) is not None


def test_force_delete_removes_the_dependent_builds_too():
    artifact_id, _ = _make_artifact("forced.gguf", 128)
    with get_session() as session:
        session.add(Build(name="Collateral", base_model_id=_model_id(), model_artifact_id=artifact_id))

    result = storage_engine.delete_artifact(artifact_id, force=True)
    assert result["deleted_builds"] == ["Collateral"]
    with get_session() as session:
        assert session.query(Build).filter(Build.name == "Collateral").count() == 0


def test_delete_artifact_keeps_benchmark_history_by_detaching_it():
    artifact_id, _ = _make_artifact("benchmarked.gguf", 128)
    with get_session() as session:
        benchmark = Benchmark(model_artifact_id=artifact_id, tokens_per_sec=42.0)
        session.add(benchmark)
        session.flush()
        benchmark_id = benchmark.id

    storage_engine.delete_artifact(artifact_id)

    with get_session() as session:
        row = session.get(Benchmark, benchmark_id)
        assert row is not None, "a real measurement must survive its model file being deleted"
        assert row.model_artifact_id is None
        assert row.tokens_per_sec == 42.0


def test_delete_artifact_refuses_while_the_model_is_loaded(monkeypatch):
    from potato_core.engines.storage import service as storage_service

    artifact_id, _ = _make_artifact("in-use.gguf", 128)
    monkeypatch.setattr(storage_service, "_loaded_artifact_id", lambda: artifact_id)

    with pytest.raises(storage_engine.StorageError, match="loaded for inference"):
        storage_engine.delete_artifact(artifact_id)


def test_delete_artifact_rejects_an_unknown_id():
    with pytest.raises(storage_engine.StorageError, match="Unknown model artifact"):
        storage_engine.delete_artifact("not-a-real-id")


def test_deleting_an_untracked_file_removes_it():
    stray = settings.models_dir / "junk.bin"
    stray.write_bytes(b"\0" * 100)

    result = storage_engine.delete_untracked_file(str(stray))
    assert result["freed_bytes"] == 100
    assert not stray.exists()


def test_deleting_a_tracked_file_through_the_orphan_path_is_refused():
    _, path = _make_artifact("protected.gguf", 128)
    with pytest.raises(storage_engine.StorageError, match="tracked"):
        storage_engine.delete_untracked_file(path)
    from pathlib import Path

    assert Path(path).exists()


def test_paths_outside_the_data_directory_are_refused(tmp_path):
    outside = tmp_path / "important.txt"
    outside.write_text("do not delete me", encoding="utf-8")

    with pytest.raises(storage_engine.StorageError, match="outside"):
        storage_engine.delete_untracked_file(str(outside))
    assert outside.exists()

    # Traversal out of the managed directory is refused for the same reason.
    escape = settings.models_dir / ".." / ".." / "important.txt"
    with pytest.raises(storage_engine.StorageError):
        storage_engine.delete_untracked_file(str(escape))


def test_clear_cache_removes_real_files_and_reports_what_it_freed():
    cache_file = settings.cache_dir / "scratch.bin"
    cache_file.parent.mkdir(parents=True, exist_ok=True)
    cache_file.write_bytes(b"\0" * 4096)
    nested = settings.cache_dir / "sub" / "nested.bin"
    nested.parent.mkdir(parents=True, exist_ok=True)
    nested.write_bytes(b"\0" * 2048)

    result = storage_engine.clear_cache()
    assert result["freed_bytes"] == 6144
    assert not cache_file.exists()
    assert not nested.parent.exists()
    assert settings.cache_dir.exists()  # the directory itself is kept usable
