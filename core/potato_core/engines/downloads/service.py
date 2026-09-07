"""Real Model Download Manager (spec section 35).

Streams a GGUF file from its Hugging Face URL to disk with resumable HTTP
Range requests, pause/cancel via in-memory control signals checked between
chunks, and a size-based corruption check before a download is allowed to
become a usable ModelArtifact. Progress lives in the DB (DownloadJob, keyed
off the generic Job row) so the API layer never needs to reach into a
running thread — it only ever reads durable state.
"""
from __future__ import annotations

import threading
import time
from pathlib import Path

import httpx

from potato_core.config import settings
from potato_core.db.base import get_session
from potato_core.db.models import DownloadJob, Job, Model, ModelArtifact
from potato_core.engines import jobs as job_manager
from potato_core.engines import settings as app_settings
from potato_core.logging_config import get_logger

log = get_logger("downloads")

_CHUNK_SIZE = 1024 * 1024  # 1 MB
_PROGRESS_INTERVAL_S = 0.5
_ACTIVE_STATUSES = ("queued", "running", "paused")


class _Cancelled(Exception):
    pass


class _Paused(Exception):
    pass


class _Control:
    def __init__(self) -> None:
        self.pause_requested = threading.Event()
        self.cancel_requested = threading.Event()


_active: dict[str, _Control] = {}
_active_lock = threading.Lock()

# Transfer slots. A worker thread starts immediately but blocks here until a
# slot frees, so an over-cap download genuinely sits at status "queued" (the
# status its Job row is created with) instead of competing for bandwidth. The
# limit is re-read on each wait, so raising it in Settings releases waiting
# downloads without a restart.
_transferring: set[str] = set()
_slot_available = threading.Condition(threading.Lock())
_SLOT_POLL_INTERVAL_S = 1.0


def _acquire_slot(job_id: str, control: _Control) -> None:
    with _slot_available:
        while True:
            if control.cancel_requested.is_set():
                raise _Cancelled
            if job_id in _transferring or len(_transferring) < app_settings.get("max_concurrent_downloads"):
                _transferring.add(job_id)
                return
            _slot_available.wait(timeout=_SLOT_POLL_INTERVAL_S)


def _release_slot(job_id: str) -> None:
    with _slot_available:
        _transferring.discard(job_id)
        _slot_available.notify_all()


def _source_url(model: Model, variant: str) -> str:
    return model.fp16_download_url if variant == "fp16" else model.download_url


def _target_path(model: Model, url: str) -> Path:
    filename = url.rsplit("/", 1)[-1]
    return settings.models_dir / model.id / filename


def start_download(model_id: str, variant: str = "quantized") -> dict:
    """Starts a fresh download, or resumes/rejoins one already in flight for
    this model+variant. variant="quantized" fetches model.download_url (the
    default pre-quantized GGUF); variant="fp16" fetches model.fp16_download_url
    (a full-precision source for local requantization, spec Phase 8) — only
    set on models where one was actually verified available."""
    with get_session() as session:
        model = session.get(Model, model_id)
        if model is None:
            raise ValueError(f"Model '{model_id}' not found")
        url = _source_url(model, variant)
        if not url:
            kind = "full-precision source" if variant == "fp16" else "download"
            raise ValueError(f"Model '{model_id}' has no {kind} configured yet")

        existing = (
            session.query(DownloadJob)
            .join(Job, Job.id == DownloadJob.job_id)
            .filter(
                DownloadJob.model_id == model_id,
                DownloadJob.variant == variant,
                Job.status.in_(_ACTIVE_STATUSES),
            )
            .first()
        )
        if existing:
            job_id = existing.job_id
        else:
            job = Job(type="download", status="queued", input_artifact=url)
            session.add(job)
            session.flush()
            job_id = job.id
            target = _target_path(model, url)
            target.parent.mkdir(parents=True, exist_ok=True)
            session.add(DownloadJob(job_id=job_id, model_id=model_id, variant=variant, file_path=str(target)))

    _spawn_worker(job_id)
    return get_download(job_id)


def pause_download(job_id: str) -> None:
    with _active_lock:
        control = _active.get(job_id)
    if control is None:
        raise ValueError("This download isn't currently running")
    control.pause_requested.set()


def cancel_download(job_id: str) -> None:
    with _active_lock:
        control = _active.get(job_id)
    if control is not None:
        control.cancel_requested.set()
        return
    # Not actively running (already paused/failed) — finalize inline.
    with get_session() as session:
        dl = session.get(DownloadJob, job_id)
        file_path = Path(dl.file_path) if dl else None
    if file_path and file_path.exists():
        file_path.unlink(missing_ok=True)
    job_manager.cancel_job(job_id)


def resume_download(job_id: str) -> dict:
    with get_session() as session:
        dl = session.get(DownloadJob, job_id)
        if dl is None:
            raise ValueError("Unknown download job")
        model_id, variant = dl.model_id, dl.variant
    return start_download(model_id, variant)


def retry_download(job_id: str) -> dict:
    with get_session() as session:
        dl = session.get(DownloadJob, job_id)
        if dl is None:
            raise ValueError("Unknown download job")
        model_id, variant = dl.model_id, dl.variant
    return start_download(model_id, variant)


def list_downloads() -> list[dict]:
    with get_session() as session:
        rows = (
            session.query(Job, DownloadJob, Model)
            .join(DownloadJob, DownloadJob.job_id == Job.id)
            .join(Model, Model.id == DownloadJob.model_id)
            .filter(Job.type == "download")
            .order_by(Job.created_at.desc())
            .all()
        )
        return [_serialize(job, dl, model) for job, dl, model in rows]


def get_download(job_id: str) -> dict:
    with get_session() as session:
        row = (
            session.query(Job, DownloadJob, Model)
            .join(DownloadJob, DownloadJob.job_id == Job.id)
            .join(Model, Model.id == DownloadJob.model_id)
            .filter(Job.id == job_id)
            .first()
        )
        if row is None:
            raise ValueError(f"Unknown download job '{job_id}'")
        return _serialize(*row)


def _serialize(job: Job, dl: DownloadJob, model: Model) -> dict:
    return {
        "job_id": job.id,
        "model_id": model.id,
        "model_name": model.name,
        "variant": dl.variant,
        "status": job.status,
        "progress": job.progress,
        "bytes_downloaded": dl.bytes_downloaded,
        "bytes_total": dl.bytes_total,
        "speed_bps": dl.speed_bps,
        "error": job.error,
        "created_at": job.created_at,
        "updated_at": job.updated_at,
    }


def _spawn_worker(job_id: str) -> None:
    with _active_lock:
        if job_id in _active:
            return
        control = _Control()
        _active[job_id] = control
    thread = threading.Thread(target=_run, args=(job_id, control), daemon=True, name=f"download-{job_id[:8]}")
    thread.start()


def _run(job_id: str, control: _Control) -> None:
    try:
        _acquire_slot(job_id, control)
        _download_loop(job_id, control)
    except _Cancelled:
        _finalize_cancelled(job_id)
    except _Paused:
        _finalize_paused(job_id)
    except Exception as exc:  # noqa: BLE001 — a failed download must never crash the process
        log.exception("Download failed for job %s", job_id)
        job_manager.fail_job(job_id, str(exc))
    finally:
        _release_slot(job_id)
        with _active_lock:
            _active.pop(job_id, None)


def _download_loop(job_id: str, control: _Control) -> None:
    with get_session() as session:
        dl = session.get(DownloadJob, job_id)
        model = session.get(Model, dl.model_id)
        file_path = Path(dl.file_path)
        bytes_downloaded = dl.bytes_downloaded
        stored_etag = dl.etag
        variant = dl.variant
        url = _source_url(model, variant)

    resuming = bytes_downloaded > 0 and file_path.exists() and file_path.stat().st_size == bytes_downloaded
    headers = {"Range": f"bytes={bytes_downloaded}-"} if resuming else {}
    mode = "ab" if resuming else "wb"
    if not resuming:
        bytes_downloaded = 0

    job_manager.update_progress(job_id, dl.bytes_total and bytes_downloaded / dl.bytes_total or 0.0, status="running")

    with httpx.stream("GET", url, headers=headers, follow_redirects=True, timeout=httpx.Timeout(30.0, read=60.0)) as response:
        response.raise_for_status()

        total = _resolve_total_bytes(response, bytes_downloaded)
        etag = response.headers.get("etag")
        if resuming and stored_etag and etag and stored_etag != etag:
            # The file changed server-side since we started — the partial
            # bytes we have no longer correspond to this file. Restart clean
            # rather than silently splicing two different files together.
            log.warning("ETag changed for download job %s — restarting from scratch", job_id)
            file_path.unlink(missing_ok=True)
            bytes_downloaded = 0
            mode = "wb"

        with get_session() as session:
            dl = session.get(DownloadJob, job_id)
            dl.bytes_total = total
            dl.etag = etag

        last_update = time.monotonic()
        last_bytes = bytes_downloaded
        with open(file_path, mode) as f:
            for chunk in response.iter_bytes(_CHUNK_SIZE):
                if control.cancel_requested.is_set():
                    raise _Cancelled()
                if control.pause_requested.is_set():
                    raise _Paused()

                f.write(chunk)
                bytes_downloaded += len(chunk)

                now = time.monotonic()
                if now - last_update >= _PROGRESS_INTERVAL_S:
                    elapsed = now - last_update
                    speed = (bytes_downloaded - last_bytes) / elapsed if elapsed > 0 else None
                    _update_progress(job_id, bytes_downloaded, speed, total)
                    last_update = now
                    last_bytes = bytes_downloaded

        _update_progress(job_id, bytes_downloaded, None, total)

    _finalize_success(job_id, model, variant, file_path, bytes_downloaded, total)


def _resolve_total_bytes(response: httpx.Response, bytes_downloaded: int) -> int | None:
    content_range = response.headers.get("content-range")
    if content_range and "/" in content_range:
        try:
            return int(content_range.rsplit("/", 1)[-1])
        except ValueError:
            pass
    content_length = response.headers.get("content-length")
    if content_length is not None:
        return bytes_downloaded + int(content_length)
    return None


def _update_progress(job_id: str, bytes_downloaded: int, speed_bps: float | None, total: int | None) -> None:
    with get_session() as session:
        dl = session.get(DownloadJob, job_id)
        dl.bytes_downloaded = bytes_downloaded
        if speed_bps is not None:
            dl.speed_bps = speed_bps
    progress = (bytes_downloaded / total) if total else 0.0
    job_manager.update_progress(job_id, min(progress, 1.0), status="running")


# Quant names as they appear in GGUF filenames, longest first so "Q4_K_M"
# wins over "Q4_K" and "Q4" on the same name.
_QUANT_NAMES = [
    "Q2_K", "Q3_K_S", "Q3_K_M", "Q3_K_L", "Q3_K", "Q4_K_S", "Q4_K_M", "Q4_K",
    "Q4_0", "Q4_1", "Q5_K_S", "Q5_K_M", "Q5_K", "Q5_0", "Q5_1", "Q6_K",
    "Q8_0", "IQ4_XS", "IQ4_NL", "IQ3_XS", "IQ3_S", "IQ3_M", "F16", "BF16",
]


def _quantization_of(model: Model) -> str:
    """The quant this model's download URL actually points at.

    Read from the filename rather than assumed: most of the catalog is Q4_K_M,
    but the tiny vision models only ship Q8_0, and labelling those artifacts
    Q4_K_M made the Storage and Playground rows quietly lie about what is on
    disk.
    """
    filename = (model.download_url or "").rsplit("/", 1)[-1]
    for name in sorted(_QUANT_NAMES, key=len, reverse=True):
        if name.lower() in filename.lower():
            return name
    recommended = model.recommended_quantizations or []
    return recommended[0] if recommended else "Q4_K_M"


def _finalize_success(
    job_id: str, model: Model, variant: str, file_path: Path, bytes_downloaded: int, total: int | None
) -> None:
    actual_size = file_path.stat().st_size
    if total is not None and actual_size != total:
        # Never let a truncated/corrupted download pass as a usable artifact.
        job_manager.fail_job(job_id, f"Downloaded {actual_size} bytes but expected {total} — file is incomplete.")
        return

    quantization = "FP16" if variant == "fp16" else _quantization_of(model)

    # Vision models are only usable with their projector, so fetch it as part
    # of finishing this download rather than leaving a half-capable artifact.
    # A failure here is not fatal: the model still works, just text-only.
    mmproj_path: str | None = None
    if variant == "quantized" and model.mmproj_download_url:
        try:
            mmproj_path = str(_download_companion(model.mmproj_download_url, file_path.parent))
        except Exception as exc:  # noqa: BLE001 — degrade to text-only, don't fail the model
            log.warning("mmproj download failed for %s (%s) — model stays text-only", model.id, exc)

    with get_session() as session:
        artifact = ModelArtifact(
            model_id=model.id,
            format="gguf",
            quantization=quantization,
            file_path=str(file_path),
            mmproj_path=mmproj_path,
            size_bytes=actual_size,
            status="verified",
        )
        session.add(artifact)
        session.flush()
        artifact_id = artifact.id
        dl = session.get(DownloadJob, job_id)
        dl.output_artifact_id = artifact_id

    job_manager.complete_job(job_id, output_artifact=artifact_id)
    log.info("Download complete for %s (%d bytes) -> artifact %s", model.id, actual_size, artifact_id)


def _download_companion(url: str, target_dir: Path) -> Path:
    """Streams a companion file (currently only the mmproj projector) beside the
    model it belongs to. Small relative to the model itself and not resumable —
    a failed attempt is simply retried on the next download.
    """
    target = target_dir / url.rsplit("/", 1)[-1]
    if target.exists():
        return target
    partial = target.with_suffix(target.suffix + ".part")
    with httpx.stream("GET", url, follow_redirects=True, timeout=httpx.Timeout(30.0, read=60.0)) as response:
        response.raise_for_status()
        with open(partial, "wb") as handle:
            for block in response.iter_bytes(chunk_size=1024 * 1024):
                handle.write(block)
    partial.replace(target)
    log.info("Fetched companion file %s (%d bytes)", target.name, target.stat().st_size)
    return target


def _finalize_cancelled(job_id: str) -> None:
    with get_session() as session:
        dl = session.get(DownloadJob, job_id)
        file_path = Path(dl.file_path) if dl else None
    if file_path and file_path.exists():
        file_path.unlink(missing_ok=True)
    job_manager.cancel_job(job_id)


def _finalize_paused(job_id: str) -> None:
    job_manager.update_progress(job_id, _current_progress(job_id), status="paused")


def _current_progress(job_id: str) -> float:
    with get_session() as session:
        job = session.get(Job, job_id)
        return job.progress if job else 0.0
