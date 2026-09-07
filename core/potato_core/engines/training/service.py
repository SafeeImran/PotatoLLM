"""Fine-tuning Engine (spec sections 23, 26-27) — real job lifecycle and
slider→hyperparameter resolution; the actual PEFT/TRL training loop is
gated behind a real dependency check (dependencies.py). Starting a job
without torch/transformers/peft/trl installed fails honestly rather than
faking progress, per spec section 51.
"""
from __future__ import annotations

from potato_core.db.base import get_session
from potato_core.db.models import Dataset, Job, Model, TrainingJob
from potato_core.engines import jobs as job_manager
from potato_core.engines.training.dependencies import check_ml_dependencies
from potato_core.engines.training.hyperparameters import SliderInputs, map_sliders_to_hyperparameters
from potato_core.logging_config import get_logger

log = get_logger("training")

_ACTIVE_STATUSES = ("queued", "running", "paused")


class TrainingError(Exception):
    pass


def create_training_job(
    base_model_id: str,
    dataset_id: str,
    sliders: SliderInputs,
    advanced_overrides: dict | None = None,
) -> dict:
    with get_session() as session:
        model = session.get(Model, base_model_id)
        if model is None:
            raise TrainingError(f"Unknown model '{base_model_id}'")
        if not model.finetune_support:
            raise TrainingError(f"'{model.name}' isn't marked as fine-tunable in the registry")

        dataset = session.get(Dataset, dataset_id)
        if dataset is None:
            raise TrainingError(f"Unknown dataset '{dataset_id}'")
        if dataset.example_count is None:
            raise TrainingError("Dataset hasn't been analyzed yet — re-upload or re-analyze it first")
        if dataset.valid_pct is not None and dataset.valid_pct < 50.0:
            raise TrainingError(
                f"Only {dataset.valid_pct}% of this dataset's records are usable — "
                "fix the data before training (see the dataset's analysis for why records were rejected)"
            )

        hyperparams = map_sliders_to_hyperparameters(sliders).to_dict()
        if advanced_overrides:
            hyperparams = {**hyperparams, **advanced_overrides}

        config = {
            "sliders": {
                "training_intensity": sliders.training_intensity,
                "learning_rate": sliders.learning_rate,
                "training_time": sliders.training_time,
                "model_adaptation": sliders.model_adaptation,
                "memory_usage": sliders.memory_usage,
            },
            "hyperparameters": hyperparams,
        }

        job = Job(type="training", status="queued")
        session.add(job)
        session.flush()
        job_id = job.id

        session.add(
            TrainingJob(
                job_id=job_id,
                base_model_id=base_model_id,
                dataset_id=dataset_id,
                config_json=config,
                total_epochs=hyperparams["epochs"],
                learning_rate=hyperparams["learning_rate"],
            )
        )

    return get_training_job(job_id)


def start_training(job_id: str) -> dict:
    deps = check_ml_dependencies()
    if not deps["available"]:
        message = (
            "Fine-tuning needs PyTorch, Transformers, PEFT, and TRL, which aren't installed. "
            f"Missing: {', '.join(deps['missing'])}. Install with: {deps['install_hint']}"
        )
        job_manager.fail_job(job_id, message)
        log.info("Refused to start training job %s — missing ML deps: %s", job_id, deps["missing"])
        raise TrainingError(message)

    # Dependencies are present past this point, but the actual PEFT/TRL
    # training loop implementation is out of scope for this session (see
    # README/ARCHITECTURE) — this is the single seam where it plugs in.
    raise TrainingError(
        "ML dependencies are installed, but the training loop itself isn't implemented yet in this build."
    )


def pause_training(job_id: str) -> dict:
    with get_session() as session:
        job = session.get(Job, job_id)
        if job is None:
            raise TrainingError(f"Unknown training job '{job_id}'")
        if job.status != "running":
            raise TrainingError(f"Job is '{job.status}', not running — nothing to pause")
        job.status = "paused"
    return get_training_job(job_id)


def stop_training(job_id: str) -> dict:
    with get_session() as session:
        job = session.get(Job, job_id)
        if job is None:
            raise TrainingError(f"Unknown training job '{job_id}'")
        if job.status not in _ACTIVE_STATUSES:
            raise TrainingError(f"Job is already '{job.status}'")
    job_manager.cancel_job(job_id)
    return get_training_job(job_id)


def list_training_jobs() -> list[dict]:
    with get_session() as session:
        rows = (
            session.query(Job, TrainingJob, Model, Dataset)
            .join(TrainingJob, TrainingJob.job_id == Job.id)
            .join(Model, Model.id == TrainingJob.base_model_id)
            .join(Dataset, Dataset.id == TrainingJob.dataset_id)
            .order_by(Job.created_at.desc())
            .all()
        )
        return [_serialize(job, tj, model, dataset) for job, tj, model, dataset in rows]


def get_training_job(job_id: str) -> dict:
    with get_session() as session:
        row = (
            session.query(Job, TrainingJob, Model, Dataset)
            .join(TrainingJob, TrainingJob.job_id == Job.id)
            .join(Model, Model.id == TrainingJob.base_model_id)
            .join(Dataset, Dataset.id == TrainingJob.dataset_id)
            .filter(Job.id == job_id)
            .first()
        )
        if row is None:
            raise TrainingError(f"Unknown training job '{job_id}'")
        return _serialize(*row)


def _serialize(job: Job, tj: TrainingJob, model: Model, dataset: Dataset) -> dict:
    return {
        "job_id": job.id,
        "status": job.status,
        "progress": job.progress,
        "error": job.error,
        "base_model_id": tj.base_model_id,
        "base_model_name": model.name,
        "dataset_id": tj.dataset_id,
        "dataset_name": dataset.name,
        "config": tj.config_json,
        "current_epoch": tj.current_epoch,
        "total_epochs": tj.total_epochs,
        "current_loss": tj.current_loss,
        "learning_rate": tj.learning_rate,
        "output_adapter_id": tj.output_adapter_id,
        "created_at": job.created_at,
        "updated_at": job.updated_at,
    }
