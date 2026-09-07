"""Tests for the Training Engine's job lifecycle and dependency gate."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from potato_core.db.base import get_session
from potato_core.db.models import Job, Model
from potato_core.engines import datasets as dataset_engine
from potato_core.engines import training as training_engine
from potato_core.engines.models import seed_models
from potato_core.engines.training.hyperparameters import SliderInputs


def _register_dataset(tmp_path: Path, n: int = 10, valid_ratio: float = 1.0) -> str:
    seed_models()
    n_valid = round(n * valid_ratio)
    records = [json.dumps({"text": f"Example number {i} for training."}) for i in range(n_valid)]
    records += [json.dumps({"foo": "bar"}) for _ in range(n - n_valid)]
    p = tmp_path / "train.jsonl"
    p.write_text("\n".join(records), encoding="utf-8")
    result = dataset_engine.register_dataset("Training Data", str(p))
    return result["id"]


def test_check_ml_dependencies_reports_real_import_state():
    status = training_engine.check_ml_dependencies()
    assert isinstance(status["available"], bool)
    assert isinstance(status["missing"], list)
    # torch is not installed in this environment (Phase 12 scoped without it) —
    # this assertion is only meaningful/true for *this* dev environment, but
    # it proves the check reflects reality rather than a hardcoded flag.
    import importlib.util

    if importlib.util.find_spec("torch") is None:
        assert status["available"] is False
        assert "torch" in status["missing"]


def test_create_training_job_resolves_sliders_into_hyperparameters(tmp_path):
    dataset_id = _register_dataset(tmp_path)
    job = training_engine.create_training_job(
        "tinyllama-1.1b-chat", dataset_id, SliderInputs(training_intensity=1.0, model_adaptation=1.0)
    )
    assert job["status"] == "queued"
    assert job["config"]["hyperparameters"]["epochs"] == 5
    assert job["config"]["hyperparameters"]["lora_rank"] == 64
    assert job["total_epochs"] == 5
    assert job["dataset_name"] == "Training Data"
    assert job["base_model_name"] == "TinyLlama 1.1B Chat"


def test_create_training_job_applies_advanced_overrides(tmp_path):
    dataset_id = _register_dataset(tmp_path)
    job = training_engine.create_training_job(
        "tinyllama-1.1b-chat", dataset_id, SliderInputs(), advanced_overrides={"learning_rate": 0.001, "epochs": 7}
    )
    assert job["config"]["hyperparameters"]["learning_rate"] == 0.001
    assert job["config"]["hyperparameters"]["epochs"] == 7


def test_create_training_job_for_unknown_model_raises(tmp_path):
    dataset_id = _register_dataset(tmp_path)
    with pytest.raises(training_engine.TrainingError, match="Unknown model"):
        training_engine.create_training_job("does-not-exist", dataset_id, SliderInputs())


def test_create_training_job_for_model_without_finetune_support_raises(tmp_path):
    # _register_dataset() calls seed_models(), which re-syncs Model rows to
    # the curated registry (see engines/models/service.py) — it must run
    # *before* we flip finetune_support off, or it'll undo the override.
    dataset_id = _register_dataset(tmp_path)
    with get_session() as session:
        model = session.get(Model, "tinyllama-1.1b-chat")
        model.finetune_support = False
    with pytest.raises(training_engine.TrainingError, match="fine-tunable"):
        training_engine.create_training_job("tinyllama-1.1b-chat", dataset_id, SliderInputs())


def test_create_training_job_for_unknown_dataset_raises():
    seed_models()
    with pytest.raises(training_engine.TrainingError, match="Unknown dataset"):
        training_engine.create_training_job("tinyllama-1.1b-chat", "does-not-exist", SliderInputs())


def test_create_training_job_for_unanalyzed_dataset_raises():
    seed_models()
    from potato_core.db.models import Dataset

    with get_session() as session:
        dataset = Dataset(name="Unanalyzed", file_path="C:\\x.jsonl", format="jsonl")
        session.add(dataset)
        session.flush()
        dataset_id = dataset.id

    with pytest.raises(training_engine.TrainingError, match="hasn't been analyzed"):
        training_engine.create_training_job("tinyllama-1.1b-chat", dataset_id, SliderInputs())


def test_create_training_job_rejects_mostly_invalid_dataset(tmp_path):
    dataset_id = _register_dataset(tmp_path, n=10, valid_ratio=0.2)  # only 20% valid
    with pytest.raises(training_engine.TrainingError, match="usable"):
        training_engine.create_training_job("tinyllama-1.1b-chat", dataset_id, SliderInputs())


def test_start_training_without_ml_deps_fails_honestly_and_marks_job_failed(tmp_path):
    import importlib.util

    if importlib.util.find_spec("torch") is not None:
        pytest.skip("torch is installed in this environment — the gate can't be exercised")

    dataset_id = _register_dataset(tmp_path)
    job = training_engine.create_training_job("tinyllama-1.1b-chat", dataset_id, SliderInputs())

    with pytest.raises(training_engine.TrainingError, match="PyTorch"):
        training_engine.start_training(job["job_id"])

    with get_session() as session:
        row = session.get(Job, job["job_id"])
        assert row.status == "failed"
        assert "PyTorch" in row.error


def test_pause_a_non_running_job_raises(tmp_path):
    dataset_id = _register_dataset(tmp_path)
    job = training_engine.create_training_job("tinyllama-1.1b-chat", dataset_id, SliderInputs())
    with pytest.raises(training_engine.TrainingError, match="not running"):
        training_engine.pause_training(job["job_id"])


def test_stop_a_queued_job_cancels_it(tmp_path):
    dataset_id = _register_dataset(tmp_path)
    job = training_engine.create_training_job("tinyllama-1.1b-chat", dataset_id, SliderInputs())
    stopped = training_engine.stop_training(job["job_id"])
    assert stopped["status"] == "cancelled"


def test_stop_an_already_terminal_job_raises(tmp_path):
    dataset_id = _register_dataset(tmp_path)
    job = training_engine.create_training_job("tinyllama-1.1b-chat", dataset_id, SliderInputs())
    training_engine.stop_training(job["job_id"])
    with pytest.raises(training_engine.TrainingError, match="already"):
        training_engine.stop_training(job["job_id"])


def test_list_training_jobs_includes_created_job(tmp_path):
    dataset_id = _register_dataset(tmp_path)
    job = training_engine.create_training_job("tinyllama-1.1b-chat", dataset_id, SliderInputs())
    jobs = training_engine.list_training_jobs()
    assert any(j["job_id"] == job["job_id"] for j in jobs)


def test_get_unknown_training_job_raises():
    with pytest.raises(training_engine.TrainingError):
        training_engine.get_training_job("does-not-exist")
