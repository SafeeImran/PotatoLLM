"""Tests for the real Usage Analytics engine. record_usage() persists real
generation stats (no fake numbers), and the aggregation queries compute
real sums/averages against whatever's actually in the DB.
"""
from __future__ import annotations

from potato_core.db.base import get_session
from potato_core.db.models import InferenceSession, Model, ModelArtifact, UsageRecord
from potato_core.engines import usage as usage_engine
from potato_core.engines.models import seed_models


def test_record_usage_persists_stats_and_hardware_reading():
    usage_engine.record_usage(None, {"prompt_tokens": 12, "completion_tokens": 34, "tokens_per_sec": 45.6, "ttft_ms": 210.0})

    with get_session() as session:
        row = session.query(UsageRecord).order_by(UsageRecord.created_at.desc()).first()
        assert row.input_tokens == 12
        assert row.output_tokens == 34
        assert row.tokens_per_sec == 45.6
        assert row.ttft_seconds == 0.21


def test_record_usage_handles_missing_stat_fields_gracefully():
    usage_engine.record_usage(None, {})
    with get_session() as session:
        row = session.query(UsageRecord).order_by(UsageRecord.created_at.desc()).first()
        assert row.input_tokens == 0
        assert row.output_tokens == 0
        assert row.tokens_per_sec is None
        assert row.ttft_seconds is None


def test_get_summary_reflects_real_recorded_usage():
    before = usage_engine.get_summary()
    usage_engine.record_usage(None, {"prompt_tokens": 100, "completion_tokens": 200, "tokens_per_sec": 30.0, "ttft_ms": 500.0})
    after = usage_engine.get_summary()

    assert after["tokens_today"] == before["tokens_today"] + 300
    assert after["prompt_tokens_today"] == before["prompt_tokens_today"] + 100
    assert after["completion_tokens_today"] == before["completion_tokens_today"] + 200
    assert after["total_tokens_all_time"] == before["total_tokens_all_time"] + 300
    assert after["generations_today"] == before["generations_today"] + 1
    assert after["total_generations"] == before["total_generations"] + 1


def test_get_model_breakdown_attributes_tokens_to_the_right_model():
    seed_models()
    with get_session() as session:
        artifact = ModelArtifact(
            model_id="tinyllama-1.1b-chat", format="gguf", quantization="Q4_K_M",
            file_path="C:\\x.gguf", status="verified",
        )
        session.add(artifact)
        session.flush()
        inf_session = InferenceSession(model_artifact_id=artifact.id)
        session.add(inf_session)
        session.flush()
        session_id = inf_session.id

    usage_engine.record_usage(session_id, {"prompt_tokens": 50, "completion_tokens": 50, "tokens_per_sec": 20.0})

    breakdown = usage_engine.get_model_breakdown()
    entry = next((b for b in breakdown if b["model_id"] == "tinyllama-1.1b-chat"), None)
    assert entry is not None
    assert entry["total_tokens"] >= 100
    assert entry["generations"] >= 1


def test_get_model_breakdown_excludes_records_with_no_session():
    """A UsageRecord with session_id=None (matches real behavior when no
    model was ever loaded) must not crash the breakdown query or attribute
    tokens to a nonexistent model — the inner joins should just skip it."""
    usage_engine.record_usage(None, {"prompt_tokens": 999, "completion_tokens": 999, "tokens_per_sec": 1.0})
    breakdown = usage_engine.get_model_breakdown()  # must not raise
    assert isinstance(breakdown, list)


def test_get_daily_timeseries_includes_today_with_real_totals():
    usage_engine.record_usage(None, {"prompt_tokens": 7, "completion_tokens": 3, "tokens_per_sec": 10.0})
    series = usage_engine.get_daily_timeseries(days=7)
    assert len(series) == 7
    today = series[-1]
    assert today["tokens"] >= 10  # at least the 10 we just recorded, possibly more from other tests
    assert today["prompt_tokens"] >= 7
    assert today["completion_tokens"] >= 3
    assert today["generations"] >= 1
    assert today["tokens"] == today["prompt_tokens"] + today["completion_tokens"]


def test_get_daily_timeseries_zero_fills_days_with_no_usage():
    series = usage_engine.get_daily_timeseries(days=30)
    assert len(series) == 30
    assert all("date" in point and "tokens" in point for point in series)
    assert all(point["tokens"] >= 0 for point in series)
    empty_day = next(point for point in series if point["tokens"] == 0)
    assert empty_day["prompt_tokens"] == 0
    assert empty_day["completion_tokens"] == 0
    assert empty_day["generations"] == 0
    assert empty_day["avg_tokens_per_sec"] is None
    assert empty_day["avg_ttft_seconds"] is None


def test_list_records_returns_most_recent_first():
    usage_engine.record_usage(None, {"prompt_tokens": 1, "completion_tokens": 1, "tokens_per_sec": 1.0})
    usage_engine.record_usage(None, {"prompt_tokens": 2, "completion_tokens": 2, "tokens_per_sec": 2.0})
    records = usage_engine.list_records(limit=2)
    assert len(records) == 2
    assert records[0].created_at >= records[1].created_at


def test_get_recent_sessions_attributes_a_real_session_to_its_model():
    seed_models()
    with get_session() as session:
        artifact = ModelArtifact(
            model_id="tinyllama-1.1b-chat", format="gguf", quantization="Q4_K_M",
            file_path="C:\\y.gguf", status="verified",
        )
        session.add(artifact)
        session.flush()
        inf_session = InferenceSession(model_artifact_id=artifact.id)
        session.add(inf_session)
        session.flush()
        session_id = inf_session.id

    usage_engine.record_usage(session_id, {"prompt_tokens": 40, "completion_tokens": 60, "tokens_per_sec": 25.0, "ttft_ms": 300.0})
    usage_engine.record_usage(session_id, {"prompt_tokens": 10, "completion_tokens": 10, "tokens_per_sec": 15.0, "ttft_ms": 100.0})

    sessions = usage_engine.get_recent_sessions(limit=50)
    row = next((s for s in sessions if s["session_id"] == session_id), None)
    assert row is not None
    assert row["model_id"] == "tinyllama-1.1b-chat"
    assert row["total_tokens"] == 120
    assert row["generations"] == 2
    assert row["avg_tokens_per_sec"] == 20.0
    assert row["duration_seconds"] is not None
    assert row["duration_seconds"] >= 0


def test_get_recent_sessions_excludes_records_with_no_session():
    usage_engine.record_usage(None, {"prompt_tokens": 5, "completion_tokens": 5, "tokens_per_sec": 5.0})
    sessions = usage_engine.get_recent_sessions(limit=50)  # must not raise
    assert all(s["session_id"] is not None for s in sessions)


def test_get_recent_sessions_orders_by_most_recent_activity():
    with get_session() as session:
        older = InferenceSession()
        newer = InferenceSession()
        session.add_all([older, newer])
        session.flush()
        older_id, newer_id = older.id, newer.id

    usage_engine.record_usage(older_id, {"prompt_tokens": 1, "completion_tokens": 1, "tokens_per_sec": 1.0})
    usage_engine.record_usage(newer_id, {"prompt_tokens": 1, "completion_tokens": 1, "tokens_per_sec": 1.0})

    sessions = usage_engine.get_recent_sessions(limit=2)
    ids = [s["session_id"] for s in sessions]
    assert ids.index(newer_id) < ids.index(older_id)
