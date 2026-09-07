from __future__ import annotations

from potato_core.db.base import get_session
from potato_core.db.models import ApplicationSetting, HardwareProfile
from potato_core.engines import jobs as job_manager


def test_hardware_profile_round_trip():
    with get_session() as session:
        row = HardwareProfile(
            os_name="Windows",
            cpu_model="Test CPU",
            gpu_vram_mb=8192,
            potato_score=55,
            potato_classification="Capable Potato",
        )
        session.add(row)
        session.flush()
        saved_id = row.id

    with get_session() as session:
        fetched = session.get(HardwareProfile, saved_id)
        assert fetched is not None
        assert fetched.cpu_model == "Test CPU"
        assert fetched.potato_score == 55


def test_application_setting_upsert():
    with get_session() as session:
        session.add(ApplicationSetting(key="theme", value_json={"value": "dark"}))

    with get_session() as session:
        row = session.get(ApplicationSetting, "theme")
        assert row is not None
        assert row.value_json == {"value": "dark"}

    with get_session() as session:
        row = session.get(ApplicationSetting, "theme")
        row.value_json = {"value": "light"}

    with get_session() as session:
        row = session.get(ApplicationSetting, "theme")
        assert row.value_json == {"value": "light"}


def test_job_lifecycle():
    job = job_manager.create_job("quantization", input_artifact="artifact-1")
    assert job.status == "queued"
    assert job.progress == 0.0

    job_manager.update_progress(job.id, 0.5, status="running")
    running = [j for j in job_manager.list_jobs(status="running") if j.id == job.id]
    assert len(running) == 1
    assert running[0].progress == 0.5
    assert running[0].started_at is not None

    job_manager.complete_job(job.id, output_artifact="artifact-1-Q4_K_M")
    completed = [j for j in job_manager.list_jobs(status="completed") if j.id == job.id]
    assert len(completed) == 1
    assert completed[0].progress == 1.0
    assert completed[0].output_artifact == "artifact-1-Q4_K_M"
    assert completed[0].completed_at is not None


def test_job_failure_and_cancellation():
    failed_job = job_manager.create_job("training")
    job_manager.fail_job(failed_job.id, "out of memory")
    failed = [j for j in job_manager.list_jobs(status="failed") if j.id == failed_job.id]
    assert failed[0].error == "out of memory"

    cancelled_job = job_manager.create_job("download")
    job_manager.cancel_job(cancelled_job.id)
    cancelled = [j for j in job_manager.list_jobs(status="cancelled") if j.id == cancelled_job.id]
    assert len(cancelled) == 1
