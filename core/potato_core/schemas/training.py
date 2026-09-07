from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class SliderConfig(BaseModel):
    training_intensity: float = 0.5
    learning_rate: float = 0.5
    training_time: float = 0.5
    model_adaptation: float = 0.5
    memory_usage: float = 0.5


class CreateTrainingJobRequest(BaseModel):
    base_model_id: str
    dataset_id: str
    sliders: SliderConfig = SliderConfig()
    advanced_overrides: dict | None = None


class MLDependencyStatus(BaseModel):
    available: bool
    missing: list[str]
    install_hint: str


class TrainingJobResponse(BaseModel):
    job_id: str
    status: str
    progress: float
    error: str | None
    base_model_id: str
    base_model_name: str
    dataset_id: str
    dataset_name: str
    config: dict
    current_epoch: int
    total_epochs: int | None
    current_loss: float | None
    learning_rate: float | None
    output_adapter_id: str | None
    created_at: datetime
    updated_at: datetime
