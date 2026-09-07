"""SQLAlchemy models for every entity in spec section 34.

Only HardwareProfile and ApplicationSetting have real engine logic behind them
this phase. The rest exist so later phases add engines, not schema migrations.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from potato_core.db.base import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class HardwareProfile(Base):
    __tablename__ = "hardware_profiles"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    os_name: Mapped[str] = mapped_column(String, default="Unknown")
    os_version: Mapped[str] = mapped_column(String, default="Unknown")

    cpu_model: Mapped[str] = mapped_column(String, default="Unknown")
    cpu_vendor: Mapped[str] = mapped_column(String, default="Unknown")
    cpu_cores: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cpu_threads: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cpu_architecture: Mapped[str] = mapped_column(String, default="Unknown")
    cpu_instruction_sets: Mapped[list] = mapped_column(JSON, default=list)

    gpu_vendor: Mapped[str] = mapped_column(String, default="Unknown")
    gpu_model: Mapped[str] = mapped_column(String, default="Unknown")
    gpu_vram_mb: Mapped[int | None] = mapped_column(Integer, nullable=True)
    gpu_driver_version: Mapped[str] = mapped_column(String, default="Unknown")
    gpu_utilization_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    gpu_temp_c: Mapped[float | None] = mapped_column(Float, nullable=True)
    compute_backend: Mapped[str] = mapped_column(String, default="CPU")  # CUDA/ROCm/Metal/CPU/Unknown

    ram_total_mb: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ram_available_mb: Mapped[int | None] = mapped_column(Integer, nullable=True)

    storage_total_gb: Mapped[float | None] = mapped_column(Float, nullable=True)
    storage_available_gb: Mapped[float | None] = mapped_column(Float, nullable=True)

    potato_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    potato_classification: Mapped[str] = mapped_column(String, default="Unknown")

    is_mock: Mapped[bool] = mapped_column(Boolean, default=False)
    raw_detection_json: Mapped[dict] = mapped_column(JSON, default=dict)


class Model(Base):
    __tablename__ = "models"

    id: Mapped[str] = mapped_column(String, primary_key=True)  # curated slug, e.g. "qwen2.5-7b-instruct"
    name: Mapped[str] = mapped_column(String)
    family: Mapped[str] = mapped_column(String)
    parameter_count: Mapped[str] = mapped_column(String)  # display string e.g. "7B"
    architecture: Mapped[str] = mapped_column(String)
    context_length: Mapped[int] = mapped_column(Integer)
    license: Mapped[str] = mapped_column(String)
    source: Mapped[str] = mapped_column(String)
    model_url: Mapped[str] = mapped_column(String)
    download_url: Mapped[str] = mapped_column(String, default="")  # direct GGUF file URL for the default quant
    fp16_download_url: Mapped[str] = mapped_column(String, default="")  # full-precision source for local requantization; "" if none verified yet
    # Vision models ship as two files: the LLM itself plus a separate
    # multimodal projector ("mmproj") holding the vision encoder. "" means the
    # model is text-only — no flag can give it sight.
    mmproj_download_url: Mapped[str] = mapped_column(String, default="")
    supported_backends: Mapped[list] = mapped_column(JSON, default=list)
    supported_quant_formats: Mapped[list] = mapped_column(JSON, default=list)
    finetune_support: Mapped[bool] = mapped_column(Boolean, default=False)
    est_ram_mb: Mapped[int] = mapped_column(Integer)
    est_vram_mb: Mapped[int] = mapped_column(Integer)
    recommended_quantizations: Mapped[list] = mapped_column(JSON, default=list)
    description: Mapped[str] = mapped_column(Text, default="")
    tags: Mapped[list] = mapped_column(JSON, default=list)
    capabilities: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    @property
    def fp16_available(self) -> bool:
        return bool(self.fp16_download_url)

    @property
    def multimodal(self) -> bool:
        return bool(self.mmproj_download_url)


class ModelArtifact(Base):
    __tablename__ = "model_artifacts"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    model_id: Mapped[str] = mapped_column(String, ForeignKey("models.id"))
    format: Mapped[str] = mapped_column(String)  # safetensors/gguf/pytorch
    quantization: Mapped[str | None] = mapped_column(String, nullable=True)
    file_path: Mapped[str] = mapped_column(String)
    # Local path to the downloaded mmproj companion; NULL for text-only models.
    # Its presence is what makes llama-server start with vision enabled.
    mmproj_path: Mapped[str | None] = mapped_column(String, nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    checksum: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, default="pending")  # pending/downloading/verified/corrupt
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class Dataset(Base):
    __tablename__ = "datasets"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String)
    file_path: Mapped[str] = mapped_column(String)
    format: Mapped[str] = mapped_column(String)  # jsonl/json/csv/txt
    example_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    estimated_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    avg_tokens: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duplicate_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    valid_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class Attachment(Base):
    """A file attached to a chat message in the Playground.

    Attachments are stored under settings.attachments_dir and referenced by
    client-generated message ids so the frontend can render preview chips.
    """

    __tablename__ = "attachments"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    file_name: Mapped[str] = mapped_column(String)
    file_path: Mapped[str] = mapped_column(String)
    mime_type: Mapped[str | None] = mapped_column(String, nullable=True)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    # Client-supplied opaque id the UI uses to group attachments with messages.
    message_id: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class Adapter(Base):
    __tablename__ = "adapters"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String)
    base_model_id: Mapped[str] = mapped_column(String, ForeignKey("models.id"))
    # No FK back to training_jobs here (would create a cycle with
    # training_jobs.output_adapter_id) — to find the job that produced an
    # adapter, query training_jobs WHERE output_adapter_id = adapter.id.
    file_path: Mapped[str] = mapped_column(String)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class Job(Base):
    """Generic job lifecycle row backing the Job Manager (spec section 16).

    Domain-specific jobs (quantization, training) store their payload in a
    child table keyed by job_id; lifecycle fields live here once.
    """

    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    type: Mapped[str] = mapped_column(String)  # quantization/training/download/benchmark
    status: Mapped[str] = mapped_column(String, default="queued")  # queued/running/paused/completed/failed/cancelled
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    input_artifact: Mapped[str | None] = mapped_column(String, nullable=True)
    output_artifact: Mapped[str | None] = mapped_column(String, nullable=True)
    logs_path: Mapped[str | None] = mapped_column(String, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class DownloadJob(Base):
    __tablename__ = "download_jobs"

    job_id: Mapped[str] = mapped_column(String, ForeignKey("jobs.id"), primary_key=True)
    model_id: Mapped[str] = mapped_column(String, ForeignKey("models.id"))
    variant: Mapped[str] = mapped_column(String, default="quantized")  # "quantized" (download_url) | "fp16" (fp16_download_url)
    file_path: Mapped[str] = mapped_column(String)
    bytes_downloaded: Mapped[int] = mapped_column(Integer, default=0)
    bytes_total: Mapped[int | None] = mapped_column(Integer, nullable=True)
    speed_bps: Mapped[float | None] = mapped_column(Float, nullable=True)
    etag: Mapped[str | None] = mapped_column(String, nullable=True)
    resumed_count: Mapped[int] = mapped_column(Integer, default=0)
    output_artifact_id: Mapped[str | None] = mapped_column(String, ForeignKey("model_artifacts.id"), nullable=True)


class QuantizationJob(Base):
    __tablename__ = "quantization_jobs"

    job_id: Mapped[str] = mapped_column(String, ForeignKey("jobs.id"), primary_key=True)
    model_id: Mapped[str] = mapped_column(String, ForeignKey("models.id"))
    source_artifact_id: Mapped[str | None] = mapped_column(String, ForeignKey("model_artifacts.id"), nullable=True)
    target_format: Mapped[str] = mapped_column(String)
    target_quant: Mapped[str] = mapped_column(String)
    config_json: Mapped[dict] = mapped_column(JSON, default=dict)
    output_artifact_id: Mapped[str | None] = mapped_column(String, ForeignKey("model_artifacts.id"), nullable=True)


class TrainingJob(Base):
    __tablename__ = "training_jobs"

    job_id: Mapped[str] = mapped_column(String, ForeignKey("jobs.id"), primary_key=True)
    base_model_id: Mapped[str] = mapped_column(String, ForeignKey("models.id"))
    dataset_id: Mapped[str] = mapped_column(String, ForeignKey("datasets.id"))
    config_json: Mapped[dict] = mapped_column(JSON, default=dict)
    current_epoch: Mapped[int] = mapped_column(Integer, default=0)
    total_epochs: Mapped[int | None] = mapped_column(Integer, nullable=True)
    current_loss: Mapped[float | None] = mapped_column(Float, nullable=True)
    learning_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    output_adapter_id: Mapped[str | None] = mapped_column(String, ForeignKey("adapters.id"), nullable=True)


class Benchmark(Base):
    __tablename__ = "benchmarks"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    # Same pattern as InferenceSession: exactly one of these is set. build_id
    # once the Build Manager (Phase 11) exists; model_artifact_id for
    # benchmarking straight off a downloaded/quantized artifact (today's
    # only path).
    build_id: Mapped[str | None] = mapped_column(String, ForeignKey("builds.id"), nullable=True)
    model_artifact_id: Mapped[str | None] = mapped_column(String, ForeignKey("model_artifacts.id"), nullable=True)
    tokens_per_sec: Mapped[float | None] = mapped_column(Float, nullable=True)
    prompt_tokens_per_sec: Mapped[float | None] = mapped_column(Float, nullable=True)
    ttft_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    total_latency_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    cpu_util_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    gpu_util_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    vram_mb: Mapped[float | None] = mapped_column(Float, nullable=True)
    ram_mb: Mapped[float | None] = mapped_column(Float, nullable=True)
    temp_c: Mapped[float | None] = mapped_column(Float, nullable=True)
    power_w: Mapped[float | None] = mapped_column(Float, nullable=True)
    context_length: Mapped[int | None] = mapped_column(Integer, nullable=True)
    backend: Mapped[str | None] = mapped_column(String, nullable=True)
    gpu_offload_layers: Mapped[int | None] = mapped_column(Integer, nullable=True)
    generation_params_json: Mapped[dict] = mapped_column(JSON, default=dict)
    is_measured: Mapped[bool] = mapped_column(Boolean, default=True)  # always True; estimates aren't persisted here
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class Build(Base):
    __tablename__ = "builds"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String)
    base_model_id: Mapped[str] = mapped_column(String, ForeignKey("models.id"))
    model_artifact_id: Mapped[str] = mapped_column(String, ForeignKey("model_artifacts.id"))
    adapter_id: Mapped[str | None] = mapped_column(String, ForeignKey("adapters.id"), nullable=True)
    backend: Mapped[str] = mapped_column(String, default="llama.cpp")
    gpu_offload_layers: Mapped[int | None] = mapped_column(Integer, nullable=True)
    context_length: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # No FK to benchmarks here (would create a cycle with benchmarks.build_id)
    # — the latest benchmark for a build is `benchmarks WHERE build_id = build.id
    # ORDER BY created_at DESC LIMIT 1`.
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class InferenceSession(Base):
    __tablename__ = "inference_sessions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    # Exactly one of these is set: build_id once the Build Manager (Phase 11)
    # exists, model_artifact_id for running inference straight off a
    # downloaded artifact before a Build wraps it (today's only path).
    build_id: Mapped[str | None] = mapped_column(String, ForeignKey("builds.id"), nullable=True)
    model_artifact_id: Mapped[str | None] = mapped_column(String, ForeignKey("model_artifacts.id"), nullable=True)
    system_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    params_json: Mapped[dict] = mapped_column(JSON, default=dict)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class UsageRecord(Base):
    __tablename__ = "usage_records"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    session_id: Mapped[str | None] = mapped_column(String, ForeignKey("inference_sessions.id"), nullable=True)
    build_id: Mapped[str | None] = mapped_column(String, ForeignKey("builds.id"), nullable=True)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    tokens_per_sec: Mapped[float | None] = mapped_column(Float, nullable=True)
    ttft_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    cpu_util_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    gpu_util_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    vram_mb: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class ApplicationSetting(Base):
    __tablename__ = "application_settings"

    key: Mapped[str] = mapped_column(String, primary_key=True)
    value_json: Mapped[dict] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)
