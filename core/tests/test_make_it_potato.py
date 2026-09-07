"""Tests for the "Make It Potato" orchestration (spec section 14) — verifies
it advances through the real download/quantization pipeline rather than
faking any step, and is safe to call repeatedly.
"""
from __future__ import annotations

import http.server
import threading

import pytest

from potato_core.db.base import get_session
from potato_core.db.models import DownloadJob, HardwareProfile, Model, ModelArtifact
from potato_core.engines import downloads as download_engine
from potato_core.engines import quantization as quantization_engine
from potato_core.engines import recommendation as recommendation_engine
from potato_core.engines.hardware.mock import MockHardwareProvider
from potato_core.engines.hardware.score import compute_potato_score
from potato_core.engines.models import seed_models

_FILE_BYTES = b"gguf-fake-bytes-for-testing" * 1000


class _StaticFileHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        self.send_response(200)
        self.send_header("Content-Length", str(len(_FILE_BYTES)))
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()
        self.wfile.write(_FILE_BYTES)

    def log_message(self, *args):
        pass


@pytest.fixture
def local_file_server():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _StaticFileHandler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{port}/model.gguf"
    server.shutdown()
    thread.join(timeout=2)


@pytest.fixture
def real_hardware_profile():
    seed_models()
    snapshot = MockHardwareProvider().detect()
    score = compute_potato_score(snapshot)
    with get_session() as session:
        session.add(
            HardwareProfile(
                gpu_vram_mb=snapshot.gpu.vram_mb, ram_total_mb=snapshot.memory.total_mb,
                compute_backend=snapshot.compute_backend, is_mock=True,
                potato_score=score.score, potato_classification=score.classification,
            )
        )


def _wait_until(predicate, timeout=15, interval=0.1):
    import time

    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(interval)
    return False


def test_make_it_potato_starts_a_real_download_when_nothing_is_downloaded(real_hardware_profile, local_file_server):
    # mistral-7b-instruct-v0.3 isn't touched by any other test file's
    # download/artifact fixtures — using tinyllama-1.1b-chat here raced
    # against test_downloads.py's own tinyllama fixtures in the shared
    # session DB (see conftest.py) and intermittently found an artifact
    # already verified from an unrelated test.
    with get_session() as session:
        model = session.get(Model, "mistral-7b-instruct-v0.3")
        model.download_url = local_file_server

    result = recommendation_engine.make_it_potato("mistral-7b-instruct-v0.3")
    assert result["status"] == "preparing"
    assert result["step"] == "downloading"
    assert result["recommendation"]["recommended"]["quantization"] == "Q4_K_M"

    job_id = result["job"]["job_id"]
    assert _wait_until(lambda: download_engine.get_download(job_id)["status"] == "completed", timeout=20)


def test_make_it_potato_reports_ready_once_a_matching_artifact_is_verified(real_hardware_profile):
    seed_models()
    with get_session() as session:
        session.add(
            ModelArtifact(
                model_id="tinyllama-1.1b-chat", format="gguf", quantization="Q4_K_M",
                file_path="C:\\already-here.gguf", status="verified", size_bytes=123,
            )
        )

    result = recommendation_engine.make_it_potato("tinyllama-1.1b-chat")
    assert result["status"] == "ready"
    assert result["artifact_id"] is not None


def test_make_it_potato_is_safe_to_call_twice_without_duplicating_the_download(real_hardware_profile, local_file_server):
    # A distinct model from the other tests in this file — they share one
    # session-scoped DB (see conftest.py), so reusing tinyllama here could
    # pick up a verified artifact an earlier test already created for it.
    with get_session() as session:
        model = session.get(Model, "gemma-2-2b-it")
        model.download_url = local_file_server

    first = recommendation_engine.make_it_potato("gemma-2-2b-it")
    assert first["status"] == "preparing"
    first_job_id = first["job"]["job_id"]

    second = recommendation_engine.make_it_potato("gemma-2-2b-it")
    if second["status"] == "preparing":
        # Still in flight when the second call landed — must be the *same*
        # job, not a duplicate download kicked off underneath it.
        assert second["job"]["job_id"] == first_job_id
    else:
        # The (tiny, local) file finished downloading between the two calls
        # — also correct: it should report the artifact from that same job
        # as ready, not have started a second download.
        assert second["status"] == "ready"
        with get_session() as session:
            dl = session.get(DownloadJob, first_job_id)
            assert dl.output_artifact_id == second["artifact_id"]


def test_make_it_potato_never_requantizes_fp16_into_itself(real_hardware_profile):
    """Regression test: recommending a full-precision quant (e.g. "FP16")
    must reuse an already-downloaded fp16 source directly, never spawn a
    real llama-quantize pass to convert FP16 into FP16 — that's a pointless
    multi-hundred-MB-to-GB duplicate file and wasted compute. This exact
    bug shipped once: the registry labeled the option "F16" while the
    download engine tags fp16 artifacts "FP16", so the string mismatch hid
    the existing source and triggered a real no-op quantization job."""
    seed_models()
    with get_session() as session:
        model = session.get(Model, "qwen2.5-0.5b-instruct")
        model.recommended_quantizations = ["FP16"]  # force FP16 as the only/best option
        artifact = ModelArtifact(
            model_id="qwen2.5-0.5b-instruct", format="gguf", quantization="FP16",
            file_path="C:\\already-have-fp16.gguf", status="verified", size_bytes=1_000_000,
        )
        session.add(artifact)
        session.flush()
        artifact_id = artifact.id

    result = recommendation_engine.make_it_potato("qwen2.5-0.5b-instruct")
    assert result["status"] == "ready"
    assert result["artifact_id"] == artifact_id


def test_make_it_potato_for_unknown_model_raises(real_hardware_profile):
    with pytest.raises(recommendation_engine.RecommendationError):
        recommendation_engine.make_it_potato("does-not-exist")
