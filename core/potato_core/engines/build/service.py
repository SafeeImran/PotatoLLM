"""Build/Artifact Manager (spec section 18) — real implementation.

A Build wraps a verified ModelArtifact plus runtime config (backend, GPU
offload, context length) under a user-facing name, so results from
Optimize/Downloads/Fine-tuning become something the user can run, benchmark,
rename, duplicate, and delete — rather than being addressed by a raw
artifact UUID.

Deleting a Build only removes the Build row, never the underlying
ModelArtifact file — the same artifact can back more than one Build (e.g.
two different context-length configs of the same file), and destroying
downloaded/quantized model data is Storage Manager's job (spec section 31),
gated behind its own explicit confirmation, not an implicit side effect here.
"""
from __future__ import annotations

from potato_core.db.base import get_session
from potato_core.db.models import Benchmark, Build, Model, ModelArtifact

_DEFAULT_BACKEND = "llama.cpp"


class BuildError(Exception):
    pass


def _validate_artifact(session, model_artifact_id: str) -> ModelArtifact:
    artifact = session.get(ModelArtifact, model_artifact_id)
    if artifact is None:
        raise BuildError(f"Unknown model artifact '{model_artifact_id}'")
    if artifact.status != "verified":
        raise BuildError(f"Artifact is '{artifact.status}', not verified — can't build from it")
    return artifact


def create_build(
    name: str,
    model_artifact_id: str,
    context_length: int | None = None,
    gpu_offload_layers: int | None = None,
    backend: str = _DEFAULT_BACKEND,
) -> dict:
    with get_session() as session:
        artifact = _validate_artifact(session, model_artifact_id)
        build = Build(
            name=name,
            base_model_id=artifact.model_id,
            model_artifact_id=model_artifact_id,
            backend=backend,
            gpu_offload_layers=gpu_offload_layers,
            context_length=context_length,
        )
        session.add(build)
        session.flush()
        build_id = build.id
    return get_build(build_id)


def duplicate_build(build_id: str, new_name: str | None = None) -> dict:
    with get_session() as session:
        source = session.get(Build, build_id)
        if source is None:
            raise BuildError(f"Unknown build '{build_id}'")
        copy = Build(
            name=new_name or f"{source.name} (copy)",
            base_model_id=source.base_model_id,
            model_artifact_id=source.model_artifact_id,
            adapter_id=source.adapter_id,
            backend=source.backend,
            gpu_offload_layers=source.gpu_offload_layers,
            context_length=source.context_length,
        )
        session.add(copy)
        session.flush()
        copy_id = copy.id
    return get_build(copy_id)


def rename_build(build_id: str, name: str) -> dict:
    with get_session() as session:
        build = session.get(Build, build_id)
        if build is None:
            raise BuildError(f"Unknown build '{build_id}'")
        build.name = name
    return get_build(build_id)


def delete_build(build_id: str) -> None:
    with get_session() as session:
        build = session.get(Build, build_id)
        if build is None:
            raise BuildError(f"Unknown build '{build_id}'")
        session.delete(build)


def list_builds() -> list[dict]:
    with get_session() as session:
        rows = (
            session.query(Build, Model)
            .join(Model, Model.id == Build.base_model_id)
            .order_by(Build.updated_at.desc())
            .all()
        )
        return [_serialize(session, build, model) for build, model in rows]


def get_build(build_id: str) -> dict:
    with get_session() as session:
        row = session.query(Build, Model).join(Model, Model.id == Build.base_model_id).filter(Build.id == build_id).first()
        if row is None:
            raise BuildError(f"Unknown build '{build_id}'")
        return _serialize(session, *row)


def _serialize(session, build: Build, model: Model) -> dict:
    artifact = session.get(ModelArtifact, build.model_artifact_id)
    latest_benchmark = (
        session.query(Benchmark)
        .filter(Benchmark.build_id == build.id)
        .order_by(Benchmark.created_at.desc())
        .first()
    )
    return {
        "id": build.id,
        "name": build.name,
        "base_model_id": build.base_model_id,
        "base_model_name": model.name,
        "model_artifact_id": build.model_artifact_id,
        "quantization": artifact.quantization if artifact else None,
        "size_bytes": artifact.size_bytes if artifact else None,
        "backend": build.backend,
        "gpu_offload_layers": build.gpu_offload_layers,
        "context_length": build.context_length,
        "last_benchmark_tokens_per_sec": latest_benchmark.tokens_per_sec if latest_benchmark else None,
        "created_at": build.created_at,
        "updated_at": build.updated_at,
    }
