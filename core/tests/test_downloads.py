"""Tests the real Download Manager against a local HTTP server (not Hugging
Face) so the suite is fast, deterministic, and doesn't require network
access. The server is deliberately slow (chunk-by-chunk with a short sleep)
so pause/cancel can be triggered reliably mid-transfer.
"""
from __future__ import annotations

import hashlib
import http.server
import os
import threading
import time

import pytest

from potato_core.db.base import get_session
from potato_core.db.models import DownloadJob, Job, Model, ModelArtifact
from potato_core.engines import downloads as download_manager
from potato_core.engines.models import seed_models

_FILE_BYTES = os.urandom(2 * 1024 * 1024)  # 2 MB
_FILE_SHA256 = hashlib.sha256(_FILE_BYTES).hexdigest()
_MODEL_ID = "tinyllama-1.1b-chat"


class _SlowRangeHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802 — stdlib method name
        start = 0
        range_header = self.headers.get("Range")
        if range_header:
            start = int(range_header.replace("bytes=", "").split("-")[0])
        body = _FILE_BYTES[start:]

        self.send_response(206 if range_header else 200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Accept-Ranges", "bytes")
        if range_header:
            self.send_header("Content-Range", f"bytes {start}-{len(_FILE_BYTES) - 1}/{len(_FILE_BYTES)}")
        else:
            self.send_header("Content-Length", str(len(body)))
        self.send_header("ETag", '"test-etag"')
        self.end_headers()

        # Slow enough (~6.4s total for 2MB) to leave a comfortable window
        # between "bytes_downloaded > 0" and a pause/cancel call in tests —
        # at 0.02s/chunk the whole transfer finished in ~1.3s, which raced
        # against slow CI/loaded-machine scheduling and made those tests
        # flaky (the download self-completed before pause() ran).
        chunk = 16 * 1024
        for i in range(0, len(body), chunk):
            self.wfile.write(body[i : i + chunk])
            self.wfile.flush()
            time.sleep(0.05)

    def log_message(self, *args):  # silence test output
        pass


@pytest.fixture
def local_server():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _SlowRangeHandler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{port}/model.gguf"
    server.shutdown()
    thread.join(timeout=2)


@pytest.fixture
def model_with_local_url(local_server):
    seed_models()
    with get_session() as session:
        model = session.get(Model, _MODEL_ID)
        model.download_url = local_server
    return _MODEL_ID


@pytest.fixture
def model_with_local_fp16_url(local_server):
    seed_models()
    with get_session() as session:
        model = session.get(Model, _MODEL_ID)
        model.fp16_download_url = local_server
    return _MODEL_ID


def _wait_until(predicate, timeout=15, interval=0.05):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(interval)
    return False


def _job_status(job_id: str) -> str:
    with get_session() as session:
        return session.get(Job, job_id).status


def test_full_download_completes_and_verifies(model_with_local_url):
    result = download_manager.start_download(model_with_local_url)
    job_id = result["job_id"]

    assert _wait_until(lambda: _job_status(job_id) in ("completed", "failed"), timeout=20)
    assert _job_status(job_id) == "completed"

    final = download_manager.get_download(job_id)
    assert final["bytes_downloaded"] == len(_FILE_BYTES)
    assert final["bytes_total"] == len(_FILE_BYTES)

    with get_session() as session:
        dl = session.get(DownloadJob, job_id)
        artifact = session.get(ModelArtifact, dl.output_artifact_id)
        assert artifact.status == "verified"
        assert artifact.size_bytes == len(_FILE_BYTES)
        with open(artifact.file_path, "rb") as f:
            assert hashlib.sha256(f.read()).hexdigest() == _FILE_SHA256


def test_pause_then_resume_produces_byte_identical_file(model_with_local_url):
    result = download_manager.start_download(model_with_local_url)
    job_id = result["job_id"]

    assert _wait_until(lambda: download_manager.get_download(job_id)["bytes_downloaded"] > 0, timeout=20)
    download_manager.pause_download(job_id)
    assert _wait_until(lambda: _job_status(job_id) == "paused", timeout=20)

    paused_bytes = download_manager.get_download(job_id)["bytes_downloaded"]
    assert 0 < paused_bytes < len(_FILE_BYTES)

    download_manager.resume_download(job_id)
    assert _wait_until(lambda: _job_status(job_id) in ("completed", "failed"), timeout=20)
    assert _job_status(job_id) == "completed"

    with get_session() as session:
        dl = session.get(DownloadJob, job_id)
        assert dl.bytes_downloaded == len(_FILE_BYTES)
        with open(dl.file_path, "rb") as f:
            content = f.read()
        assert len(content) == len(_FILE_BYTES)
        assert hashlib.sha256(content).hexdigest() == _FILE_SHA256


def test_cancel_deletes_partial_file(model_with_local_url):
    result = download_manager.start_download(model_with_local_url)
    job_id = result["job_id"]

    assert _wait_until(lambda: download_manager.get_download(job_id)["bytes_downloaded"] > 0, timeout=20)
    with get_session() as session:
        file_path = session.get(DownloadJob, job_id).file_path

    download_manager.cancel_download(job_id)
    assert _wait_until(lambda: _job_status(job_id) == "cancelled", timeout=20)
    assert not os.path.exists(file_path)


def test_start_download_for_unknown_model_raises():
    with pytest.raises(ValueError):
        download_manager.start_download("does-not-exist")


def test_start_download_for_model_without_download_url_raises():
    seed_models()
    with get_session() as session:
        model = session.get(Model, _MODEL_ID)
        model.download_url = ""
    with pytest.raises(ValueError):
        download_manager.start_download(_MODEL_ID)


def test_size_mismatch_fails_job_and_never_creates_an_artifact(tmp_path, model_with_local_url):
    """Directly exercises the corruption guard: a file whose actual size
    doesn't match the server-reported total must never become a usable
    ModelArtifact (spec section 35 — never let corrupted downloads in)."""
    from potato_core.engines.downloads.service import _finalize_success

    fake_file = tmp_path / "truncated.gguf"
    fake_file.write_bytes(b"only-part-of-the-file")

    with get_session() as session:
        model = session.get(Model, model_with_local_url)
        job = Job(type="download", status="running", input_artifact=model.download_url)
        session.add(job)
        session.flush()
        job_id = job.id
        session.add(DownloadJob(job_id=job_id, model_id=model.id, file_path=str(fake_file)))
        artifact_count_before = session.query(ModelArtifact).filter(ModelArtifact.model_id == model.id).count()

    _finalize_success(job_id, model, "quantized", fake_file, bytes_downloaded=22, total=999_999)

    with get_session() as session:
        job = session.get(Job, job_id)
        assert job.status == "failed"
        assert "incomplete" in job.error.lower()
        artifact_count_after = session.query(ModelArtifact).filter(ModelArtifact.model_id == model_with_local_url).count()
        assert artifact_count_after == artifact_count_before  # no new artifact from the corrupted download


def test_fp16_variant_downloads_from_fp16_url_and_tags_artifact_fp16(model_with_local_fp16_url):
    result = download_manager.start_download(model_with_local_fp16_url, variant="fp16")
    job_id = result["job_id"]
    assert result["variant"] == "fp16"

    assert _wait_until(lambda: _job_status(job_id) in ("completed", "failed"), timeout=20)
    assert _job_status(job_id) == "completed"

    with get_session() as session:
        dl = session.get(DownloadJob, job_id)
        artifact = session.get(ModelArtifact, dl.output_artifact_id)
        assert artifact.quantization == "FP16"


def test_quantized_and_fp16_variants_are_independent_jobs(model_with_local_url, local_server):
    with get_session() as session:
        model = session.get(Model, model_with_local_url)
        # Different filename than download_url so the two variants target
        # different files on disk, matching real registry data.
        model.fp16_download_url = local_server.replace("model.gguf", "model-fp16.gguf")

    quantized = download_manager.start_download(model_with_local_url, variant="quantized")
    fp16 = download_manager.start_download(model_with_local_url, variant="fp16")
    assert quantized["job_id"] != fp16["job_id"]

    download_manager.cancel_download(quantized["job_id"])
    download_manager.cancel_download(fp16["job_id"])
    assert _wait_until(lambda: _job_status(quantized["job_id"]) == "cancelled", timeout=20)
    assert _wait_until(lambda: _job_status(fp16["job_id"]) == "cancelled", timeout=20)


def test_starting_twice_resumes_the_same_job_not_a_duplicate(model_with_local_url):
    first = download_manager.start_download(model_with_local_url)
    second = download_manager.start_download(model_with_local_url)
    assert first["job_id"] == second["job_id"]
    download_manager.cancel_download(first["job_id"])
    assert _wait_until(lambda: _job_status(first["job_id"]) == "cancelled", timeout=20)
