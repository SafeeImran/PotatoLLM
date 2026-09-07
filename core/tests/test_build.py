"""Tests for the real Build/Artifact Manager."""
from __future__ import annotations

import pytest

from potato_core.db.base import get_session
from potato_core.db.models import Benchmark, Build, ModelArtifact
from potato_core.engines import build as build_engine
from potato_core.engines.models import seed_models


def _make_verified_artifact(model_id: str = "tinyllama-1.1b-chat") -> str:
    seed_models()
    with get_session() as session:
        artifact = ModelArtifact(
            model_id=model_id, format="gguf", quantization="Q4_K_M",
            file_path="C:\\test.gguf", status="verified", size_bytes=123456,
        )
        session.add(artifact)
        session.flush()
        return artifact.id


def test_create_build_from_verified_artifact():
    artifact_id = _make_verified_artifact()
    build = build_engine.create_build("My Build", artifact_id, context_length=4096)

    assert build["name"] == "My Build"
    assert build["model_artifact_id"] == artifact_id
    assert build["base_model_id"] == "tinyllama-1.1b-chat"
    assert build["base_model_name"] == "TinyLlama 1.1B Chat"
    assert build["quantization"] == "Q4_K_M"
    assert build["context_length"] == 4096
    assert build["backend"] == "llama.cpp"
    assert build["last_benchmark_tokens_per_sec"] is None


def test_create_build_for_unknown_artifact_raises():
    with pytest.raises(build_engine.BuildError, match="Unknown model artifact"):
        build_engine.create_build("X", "does-not-exist")


def test_create_build_for_unverified_artifact_raises():
    seed_models()
    with get_session() as session:
        artifact = ModelArtifact(
            model_id="tinyllama-1.1b-chat", format="gguf", quantization="Q4_K_M",
            file_path="C:\\test.gguf", status="downloading",
        )
        session.add(artifact)
        session.flush()
        artifact_id = artifact.id

    with pytest.raises(build_engine.BuildError, match="not verified"):
        build_engine.create_build("X", artifact_id)


def test_rename_build():
    artifact_id = _make_verified_artifact()
    build = build_engine.create_build("Original", artifact_id)
    renamed = build_engine.rename_build(build["id"], "Renamed")
    assert renamed["name"] == "Renamed"
    assert renamed["id"] == build["id"]


def test_rename_unknown_build_raises():
    with pytest.raises(build_engine.BuildError):
        build_engine.rename_build("does-not-exist", "X")


def test_duplicate_build_copies_config_with_new_id():
    artifact_id = _make_verified_artifact()
    original = build_engine.create_build("Original", artifact_id, context_length=8192, gpu_offload_layers=20)
    copy = build_engine.duplicate_build(original["id"])

    assert copy["id"] != original["id"]
    assert copy["name"] == "Original (copy)"
    assert copy["model_artifact_id"] == original["model_artifact_id"]
    assert copy["context_length"] == 8192
    assert copy["gpu_offload_layers"] == 20


def test_duplicate_build_with_custom_name():
    artifact_id = _make_verified_artifact()
    original = build_engine.create_build("Original", artifact_id)
    copy = build_engine.duplicate_build(original["id"], new_name="My Copy")
    assert copy["name"] == "My Copy"


def test_duplicate_unknown_build_raises():
    with pytest.raises(build_engine.BuildError):
        build_engine.duplicate_build("does-not-exist")


def test_delete_build_removes_the_build_but_not_the_artifact():
    artifact_id = _make_verified_artifact()
    build = build_engine.create_build("Doomed", artifact_id)
    build_engine.delete_build(build["id"])

    with pytest.raises(build_engine.BuildError):
        build_engine.get_build(build["id"])

    with get_session() as session:
        # The underlying artifact must survive — Builds don't own artifact
        # lifecycle (spec section 31: deletion is Storage Manager's job).
        assert session.get(ModelArtifact, artifact_id) is not None


def test_delete_unknown_build_raises():
    with pytest.raises(build_engine.BuildError):
        build_engine.delete_build("does-not-exist")


def test_list_builds_returns_most_recently_updated_first():
    artifact_id = _make_verified_artifact()
    first = build_engine.create_build("First", artifact_id)
    second = build_engine.create_build("Second", artifact_id)

    builds = build_engine.list_builds()
    ids = [b["id"] for b in builds]
    assert ids.index(second["id"]) < ids.index(first["id"])


def test_get_build_reflects_its_latest_benchmark():
    artifact_id = _make_verified_artifact()
    build = build_engine.create_build("Benchmarked", artifact_id)

    with get_session() as session:
        session.add(Benchmark(build_id=build["id"], tokens_per_sec=12.3))
        session.add(Benchmark(build_id=build["id"], tokens_per_sec=45.6))  # more recent

    refreshed = build_engine.get_build(build["id"])
    assert refreshed["last_benchmark_tokens_per_sec"] == 45.6


def test_rename_then_duplicate_preserves_new_name_as_source():
    artifact_id = _make_verified_artifact()
    build = build_engine.create_build("A", artifact_id)
    build_engine.rename_build(build["id"], "B")
    copy = build_engine.duplicate_build(build["id"])
    assert copy["name"] == "B (copy)"
