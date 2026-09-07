"""Job Manager — real CRUD/lifecycle bookkeeping (spec section 16); no executor yet.

Quantization/training/download engines will call `create_job` / `update_progress`
/ `complete_job` / `fail_job` once they exist. This session there are no
producers, so the table stays empty in normal use — it's here so those
engines have a lifecycle store to plug into rather than inventing their own.
"""
from __future__ import annotations

from datetime import datetime, timezone

from potato_core.db.base import get_session
from potato_core.db.models import Job


def create_job(job_type: str, input_artifact: str | None = None) -> Job:
    with get_session() as session:
        job = Job(type=job_type, status="queued", progress=0.0, input_artifact=input_artifact)
        session.add(job)
        session.flush()
        session.refresh(job)
        session.expunge(job)
        return job


def update_progress(job_id: str, progress: float, status: str | None = None) -> None:
    with get_session() as session:
        job = session.get(Job, job_id)
        if job is None:
            return
        job.progress = progress
        if status:
            job.status = status
        if status == "running" and job.started_at is None:
            job.started_at = datetime.now(timezone.utc)


def complete_job(job_id: str, output_artifact: str | None = None) -> None:
    with get_session() as session:
        job = session.get(Job, job_id)
        if job is None:
            return
        job.status = "completed"
        job.progress = 1.0
        job.output_artifact = output_artifact
        job.completed_at = datetime.now(timezone.utc)


def fail_job(job_id: str, error: str) -> None:
    with get_session() as session:
        job = session.get(Job, job_id)
        if job is None:
            return
        job.status = "failed"
        job.error = error
        job.completed_at = datetime.now(timezone.utc)


def cancel_job(job_id: str) -> None:
    with get_session() as session:
        job = session.get(Job, job_id)
        if job is None:
            return
        job.status = "cancelled"
        job.completed_at = datetime.now(timezone.utc)


def list_jobs(status: str | None = None) -> list[Job]:
    with get_session() as session:
        query = session.query(Job)
        if status:
            query = query.filter(Job.status == status)
        jobs = query.order_by(Job.created_at.desc()).all()
        for j in jobs:
            session.expunge(j)
        return jobs
