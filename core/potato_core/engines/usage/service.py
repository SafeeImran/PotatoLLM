"""Usage/Telemetry Engine (spec section 28) — real implementation.

Every UsageRecord is written from an actual completed generation (see
api/inference.py's generate_stream, which calls record_usage() once a
stream finishes) — never synthesized. All aggregation happens locally
against the local SQLite DB; nothing here uploads anything anywhere.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import func

from potato_core.db.base import get_session
from potato_core.db.models import InferenceSession, Model, ModelArtifact, UsageRecord
from potato_core.engines import settings as app_settings
from potato_core.engines.hardware import service as hardware_service
from potato_core.logging_config import get_logger

log = get_logger("usage")


def record_usage(session_id: str | None, stats: dict) -> None:
    """Called once per completed generation. A best-effort, one-shot hardware
    poll (not a sampling thread like Benchmark's — usage tracking prioritizes
    being cheap and unintrusive over peak-precision) captures utilization at
    the moment the generation just finished.

    Honours the `usage_analytics_enabled` setting: when the user turns local
    tracking off, nothing is written at all — the row is not collected and
    discarded later, it is never created.
    """
    if not app_settings.get("usage_analytics_enabled"):
        return

    try:
        live = hardware_service.poll_live()
        cpu_util = live.cpu.utilization_pct
        gpu_util = live.gpu.utilization_pct
        vram_mb = float(live.gpu.vram_mb) if live.gpu.vram_mb is not None else None
    except Exception:  # noqa: BLE001 — a hardware read failure must never drop the usage record
        log.warning("Hardware read failed while recording usage", exc_info=True)
        cpu_util = gpu_util = vram_mb = None

    with get_session() as session:
        session.add(
            UsageRecord(
                session_id=session_id,
                input_tokens=stats.get("prompt_tokens") or 0,
                output_tokens=stats.get("completion_tokens") or 0,
                tokens_per_sec=stats.get("tokens_per_sec"),
                ttft_seconds=(stats["ttft_ms"] / 1000) if stats.get("ttft_ms") is not None else None,
                cpu_util_pct=cpu_util,
                gpu_util_pct=gpu_util,
                vram_mb=vram_mb,
            )
        )


def _today_start() -> datetime:
    now = datetime.now(timezone.utc)
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


def get_summary() -> dict:
    with get_session() as session:
        today_start = _today_start()

        today_totals = (
            session.query(
                func.coalesce(func.sum(UsageRecord.input_tokens), 0),
                func.coalesce(func.sum(UsageRecord.output_tokens), 0),
                func.avg(UsageRecord.tokens_per_sec),
                func.avg(UsageRecord.ttft_seconds),
                func.count(UsageRecord.id),
            )
            .filter(UsageRecord.created_at >= today_start)
            .one()
        )
        prompt_today, completion_today, avg_speed_today, avg_ttft_today, generations_today = today_totals

        all_time_tokens = session.query(
            func.coalesce(func.sum(UsageRecord.input_tokens + UsageRecord.output_tokens), 0)
        ).scalar()
        total_sessions = session.query(func.count(InferenceSession.id)).scalar()
        total_generations = session.query(func.count(UsageRecord.id)).scalar()

        return {
            "tokens_today": int(prompt_today or 0) + int(completion_today or 0),
            "prompt_tokens_today": int(prompt_today or 0),
            "completion_tokens_today": int(completion_today or 0),
            "avg_tokens_per_sec_today": float(avg_speed_today) if avg_speed_today is not None else None,
            "avg_ttft_seconds_today": float(avg_ttft_today) if avg_ttft_today is not None else None,
            "generations_today": int(generations_today or 0),
            "total_tokens_all_time": int(all_time_tokens or 0),
            "total_sessions": int(total_sessions or 0),
            "total_generations": int(total_generations or 0),
        }


def get_model_breakdown() -> list[dict]:
    with get_session() as session:
        rows = (
            session.query(
                Model.id,
                Model.name,
                func.coalesce(func.sum(UsageRecord.input_tokens + UsageRecord.output_tokens), 0),
                func.count(UsageRecord.id),
                func.avg(UsageRecord.tokens_per_sec),
            )
            .select_from(UsageRecord)
            .join(InferenceSession, InferenceSession.id == UsageRecord.session_id)
            .join(ModelArtifact, ModelArtifact.id == InferenceSession.model_artifact_id)
            .join(Model, Model.id == ModelArtifact.model_id)
            .group_by(Model.id, Model.name)
            .order_by(func.sum(UsageRecord.input_tokens + UsageRecord.output_tokens).desc())
            .all()
        )
        return [
            {
                "model_id": model_id,
                "model_name": model_name,
                "total_tokens": int(total_tokens),
                "generations": int(generations),
                "avg_tokens_per_sec": float(avg_speed) if avg_speed is not None else None,
            }
            for model_id, model_name, total_tokens, generations, avg_speed in rows
        ]


def get_daily_timeseries(days: int = 14) -> list[dict]:
    with get_session() as session:
        start = _today_start() - timedelta(days=days - 1)
        rows = (
            session.query(
                func.date(UsageRecord.created_at),
                func.coalesce(func.sum(UsageRecord.input_tokens), 0),
                func.coalesce(func.sum(UsageRecord.output_tokens), 0),
                func.count(UsageRecord.id),
                func.avg(UsageRecord.tokens_per_sec),
                func.avg(UsageRecord.ttft_seconds),
            )
            .filter(UsageRecord.created_at >= start)
            .group_by(func.date(UsageRecord.created_at))
            .all()
        )
        by_day = {
            str(day): {
                "prompt_tokens": int(prompt),
                "completion_tokens": int(completion),
                "generations": int(generations),
                "avg_tokens_per_sec": float(avg_speed) if avg_speed is not None else None,
                "avg_ttft_seconds": float(avg_ttft) if avg_ttft is not None else None,
            }
            for day, prompt, completion, generations, avg_speed, avg_ttft in rows
        }

        result = []
        for i in range(days):
            day = (start + timedelta(days=i)).date()
            point = by_day.get(
                day.isoformat(),
                {"prompt_tokens": 0, "completion_tokens": 0, "generations": 0, "avg_tokens_per_sec": None, "avg_ttft_seconds": None},
            )
            result.append(
                {
                    "date": day.isoformat(),
                    "tokens": point["prompt_tokens"] + point["completion_tokens"],
                    **point,
                }
            )
        return result


def get_recent_sessions(limit: int = 10) -> list[dict]:
    """One row per InferenceSession that has recorded usage, newest activity
    first — the Usage page's "Recent Sessions" table. Real aggregation over
    UsageRecord grouped by session, joined out to the model that was loaded
    (mirrors get_model_breakdown's artifact join, so a record left over from
    before any model was ever loaded is skipped rather than crashing)."""
    with get_session() as session:
        last_activity = func.max(UsageRecord.created_at)
        rows = (
            session.query(
                UsageRecord.session_id,
                InferenceSession.started_at,
                InferenceSession.ended_at,
                Model.id,
                Model.name,
                func.coalesce(func.sum(UsageRecord.input_tokens + UsageRecord.output_tokens), 0),
                func.count(UsageRecord.id),
                func.avg(UsageRecord.tokens_per_sec),
                func.avg(UsageRecord.ttft_seconds),
                last_activity,
            )
            .join(InferenceSession, InferenceSession.id == UsageRecord.session_id)
            .outerjoin(ModelArtifact, ModelArtifact.id == InferenceSession.model_artifact_id)
            .outerjoin(Model, Model.id == ModelArtifact.model_id)
            .filter(UsageRecord.session_id.isnot(None))
            .group_by(UsageRecord.session_id, InferenceSession.started_at, InferenceSession.ended_at, Model.id, Model.name)
            .order_by(last_activity.desc())
            .limit(limit)
            .all()
        )

        result = []
        for session_id, started_at, ended_at, model_id, model_name, total_tokens, generations, avg_speed, avg_ttft, last_seen in rows:
            end = ended_at or last_seen
            duration = (end - started_at).total_seconds() if started_at and end else None
            result.append(
                {
                    "session_id": session_id,
                    "model_id": model_id,
                    "model_name": model_name,
                    "total_tokens": int(total_tokens),
                    "generations": int(generations),
                    "avg_tokens_per_sec": float(avg_speed) if avg_speed is not None else None,
                    "avg_ttft_seconds": float(avg_ttft) if avg_ttft is not None else None,
                    "duration_seconds": duration,
                    "started_at": started_at,
                    "last_activity_at": last_seen,
                }
            )
        return result


def clear_records() -> dict:
    """Deletes every locally-stored usage row. Backs the Privacy section's
    "delete my usage history" action — a real DELETE, not a hidden flag."""
    with get_session() as session:
        deleted = session.query(UsageRecord).delete(synchronize_session=False)
    log.info("Cleared %d usage record(s) at user request", deleted)
    return {"deleted": int(deleted)}


def list_records(limit: int = 100) -> list[UsageRecord]:
    with get_session() as session:
        rows = session.query(UsageRecord).order_by(UsageRecord.created_at.desc()).limit(limit).all()
        session.expunge_all()
        return rows
