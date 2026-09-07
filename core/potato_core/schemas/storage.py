from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class StorageSummary(BaseModel):
    models_bytes: int
    datasets_bytes: int
    attachments_bytes: int
    cache_bytes: int
    logs_bytes: int
    database_bytes: int
    total_bytes: int
    models_gb: float
    datasets_gb: float
    attachments_gb: float
    cache_gb: float
    logs_gb: float
    database_gb: float
    total_gb: float
    data_dir: str
    models_dir: str
    datasets_dir: str
    attachments_dir: str
    cache_dir: str
    logs_dir: str
    disk_total_bytes: int
    disk_free_bytes: int
    disk_used_bytes: int
    disk_total_gb: float
    disk_free_gb: float
    disk_status: Literal["ok", "low", "critical"]
    low_disk_warning_gb: float
    low_disk_critical_gb: float


class StoredModel(BaseModel):
    artifact_id: str
    model_id: str
    model_name: str
    quantization: str | None
    format: str
    status: str
    file_path: str
    exists: bool
    size_bytes: int | None
    created_at: str
    in_use: bool
    used_by_builds: list[str]


class StoredDataset(BaseModel):
    dataset_id: str
    name: str
    format: str
    file_path: str
    exists: bool
    size_bytes: int | None
    example_count: int | None
    created_at: str


class UntrackedFile(BaseModel):
    file_path: str
    relative_path: str
    size_bytes: int
    is_partial_download: bool


class MissingArtifact(BaseModel):
    artifact_id: str
    model_id: str
    model_name: str
    quantization: str | None
    file_path: str
    recorded_size_bytes: int | None


class OrphanReport(BaseModel):
    untracked_files: list[UntrackedFile]
    missing_artifacts: list[MissingArtifact]
    untracked_bytes: int


class DeleteArtifactResult(BaseModel):
    artifact_id: str
    file_deleted: bool
    freed_bytes: int
    deleted_builds: list[str]


class DeleteFileRequest(BaseModel):
    file_path: str


class DeleteFileResult(BaseModel):
    file_path: str
    freed_bytes: int


class PurgeResult(BaseModel):
    purged_artifact_ids: list[str]
    deleted_builds: list[str]


class ClearCacheResult(BaseModel):
    freed_bytes: int
