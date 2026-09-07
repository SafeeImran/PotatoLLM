"""Real Quantization Engine (spec sections 15-17) — wraps the vendored
llama-quantize binary as a background job.

Requires a full-precision (FP16/F32) source ModelArtifact. Feeding
llama-quantize an already-quantized file technically works with
--allow-requantize but measurably degrades quality, so that path isn't
offered — this mirrors why Phase 6's downloads distinguish "quantized" vs
"fp16" variants in the first place.
"""
from __future__ import annotations

import re
import subprocess
import threading
from pathlib import Path

from potato_core.config import settings
from potato_core.db.base import get_session
from potato_core.db.models import Job, ModelArtifact, QuantizationJob
from potato_core.engines import jobs as job_manager
from potato_core.engines.inference import process_group
from potato_core.logging_config import get_logger

log = get_logger("quantization")

_ACTIVE_STATUSES = ("queued", "running")
_FULL_PRECISION_QUANTS = {"FP16", "F16", "F32", "BF16"}
_PROGRESS_RE = re.compile(r"\[\s*(\d+)\s*/\s*(\d+)\s*\]")
_QUANT_SIZE_RE = re.compile(r"quant size\s*=\s*([\d.]+)\s*MiB")

class _Handle:
    def __init__(self, process: subprocess.Popen) -> None:
        self.process = process
        self.cancel_requested = False


_active: dict[str, _Handle] = {}
_active_lock = threading.Lock()


class QuantizationError(Exception):
    pass


def _quantize_executable() -> Path:
    return settings.llama_server_executable.parent / "llama-quantize.exe"


def _validate_source(source: ModelArtifact | None) -> ModelArtifact:
    if source is None:
        raise QuantizationError("Unknown source artifact")
    if source.status != "verified":
        raise QuantizationError(f"Source artifact is '{source.status}', not verified")
    if (source.quantization or "").upper() not in _FULL_PRECISION_QUANTS:
        raise QuantizationError(
            f"Source is already quantized ({source.quantization}) — llama-quantize needs a "
            "full-precision (FP16/F32) source for good output quality"
        )
    return source


def estimate(source_artifact_id: str, target_quant: str) -> dict:
    """Runs `llama-quantize --dry-run` — a real calculation from the actual
    tensor metadata, not a guess — to preview size/savings before committing
    to a full (potentially slow) quantization job."""
    with get_session() as session:
        source = _validate_source(session.get(ModelArtifact, source_artifact_id))
        source_path = source.file_path
        input_size = source.size_bytes or Path(source_path).stat().st_size

    exe = _quantize_executable()
    if not exe.exists():
        raise QuantizationError(f"llama-quantize binary not found at {exe}")

    result = subprocess.run(
        [str(exe), "--dry-run", "--allow-requantize", source_path, target_quant],
        capture_output=True,
        text=True,
        timeout=120,
    )
    match = _QUANT_SIZE_RE.search(result.stdout + result.stderr)
    if not match:
        raise QuantizationError("Couldn't parse an estimate from llama-quantize's dry-run output")

    estimated_output_bytes = int(float(match.group(1)) * 1024 * 1024)
    return {
        "input_bytes": input_size,
        "estimated_output_bytes": estimated_output_bytes,
        "estimated_savings_pct": round((1 - estimated_output_bytes / input_size) * 100, 1) if input_size else 0.0,
    }


def start_quantization(source_artifact_id: str, target_quant: str) -> dict:
    with get_session() as session:
        source = _validate_source(session.get(ModelArtifact, source_artifact_id))

        existing = (
            session.query(QuantizationJob)
            .join(Job, Job.id == QuantizationJob.job_id)
            .filter(
                QuantizationJob.source_artifact_id == source_artifact_id,
                QuantizationJob.target_quant == target_quant,
                Job.status.in_(_ACTIVE_STATUSES),
            )
            .first()
        )
        if existing:
            return get_quantization(existing.job_id)

        exe = _quantize_executable()
        if not exe.exists():
            raise QuantizationError(f"llama-quantize binary not found at {exe}")

        model_id = source.model_id
        out_path = Path(source.file_path).parent / f"{model_id}-{target_quant}.gguf"

        job = Job(type="quantization", status="queued", input_artifact=source.file_path)
        session.add(job)
        session.flush()
        job_id = job.id
        session.add(
            QuantizationJob(
                job_id=job_id,
                model_id=model_id,
                source_artifact_id=source_artifact_id,
                target_format="gguf",
                target_quant=target_quant,
                config_json={"output_path": str(out_path)},
            )
        )

    _spawn_worker(job_id)
    return get_quantization(job_id)


def cancel_quantization(job_id: str) -> None:
    with _active_lock:
        handle = _active.get(job_id)
    if handle is not None:
        handle.cancel_requested = True
        handle.process.kill()
        return
    job_manager.cancel_job(job_id)


def list_quantizations() -> list[dict]:
    with get_session() as session:
        rows = session.query(Job, QuantizationJob).join(QuantizationJob, QuantizationJob.job_id == Job.id).order_by(
            Job.created_at.desc()
        ).all()
        return [_serialize(job, qj) for job, qj in rows]


def get_quantization(job_id: str) -> dict:
    with get_session() as session:
        row = (
            session.query(Job, QuantizationJob)
            .join(QuantizationJob, QuantizationJob.job_id == Job.id)
            .filter(Job.id == job_id)
            .first()
        )
        if row is None:
            raise QuantizationError(f"Unknown quantization job '{job_id}'")
        return _serialize(*row)


def _serialize(job: Job, qj: QuantizationJob) -> dict:
    return {
        "job_id": job.id,
        "model_id": qj.model_id,
        "source_artifact_id": qj.source_artifact_id,
        "target_quant": qj.target_quant,
        "status": job.status,
        "progress": job.progress,
        "output_artifact_id": qj.output_artifact_id,
        "error": job.error,
        "created_at": job.created_at,
        "updated_at": job.updated_at,
    }


def _spawn_worker(job_id: str) -> None:
    thread = threading.Thread(target=_run, args=(job_id,), daemon=True, name=f"quantize-{job_id[:8]}")
    thread.start()


def _run(job_id: str) -> None:
    try:
        _quantize(job_id)
    except Exception as exc:  # noqa: BLE001 — a failed job must never crash the process
        log.exception("Quantization failed for job %s", job_id)
        job_manager.fail_job(job_id, str(exc))
    finally:
        with _active_lock:
            _active.pop(job_id, None)


def _quantize(job_id: str) -> None:
    with get_session() as session:
        qj = session.get(QuantizationJob, job_id)
        source = session.get(ModelArtifact, qj.source_artifact_id)
        source_path = source.file_path
        target_quant = qj.target_quant
        out_path = Path(qj.config_json["output_path"])
        model_id = qj.model_id

    job_manager.update_progress(job_id, 0.0, status="running")

    exe = _quantize_executable()
    process = subprocess.Popen(
        [str(exe), source_path, str(out_path), target_quant],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        cwd=str(exe.parent),
    )
    process_group.assign(process)
    handle = _Handle(process)
    with _active_lock:
        _active[job_id] = handle

    assert process.stdout is not None
    for line in process.stdout:
        log.debug("[llama-quantize] %s", line.rstrip())
        match = _PROGRESS_RE.search(line)
        if match:
            current, total = int(match.group(1)), int(match.group(2))
            if total > 0:
                job_manager.update_progress(job_id, min(current / total, 1.0), status="running")

    return_code = process.wait()

    if handle.cancel_requested:
        out_path.unlink(missing_ok=True)  # don't leave a partial/killed-mid-write file behind
        job_manager.cancel_job(job_id)
        return
    if return_code != 0:
        job_manager.fail_job(job_id, f"llama-quantize exited with code {return_code}")
        return
    if not out_path.exists() or out_path.stat().st_size == 0:
        job_manager.fail_job(job_id, "llama-quantize reported success but produced no output file")
        return

    with get_session() as session:
        artifact = ModelArtifact(
            model_id=model_id,
            format="gguf",
            quantization=target_quant,
            file_path=str(out_path),
            size_bytes=out_path.stat().st_size,
            status="verified",
        )
        session.add(artifact)
        session.flush()
        artifact_id = artifact.id
        qj = session.get(QuantizationJob, job_id)
        qj.output_artifact_id = artifact_id

    job_manager.complete_job(job_id, output_artifact=artifact_id)
    log.info("Quantization complete: %s -> %s (%d bytes)", model_id, target_quant, out_path.stat().st_size)
