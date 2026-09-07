from __future__ import annotations

from pydantic import BaseModel


class PackMemberResponse(BaseModel):
    model_id: str
    model_name: str
    #: primary | vision | code | reasoning — the duty this model takes in the pack.
    role: str
    why: str
    parameter_count: str
    capabilities: list[str]
    vision: bool
    estimated_vram_mb: int
    estimated_ram_mb: int
    downloaded: bool


class PackResponse(BaseModel):
    id: str
    name: str
    tagline: str
    description: str
    members: list[PackMemberResponse]
    #: Members named by the pack that the catalog does not have — a bug, shown
    #: rather than hidden.
    missing_from_catalog: list[str]
    #: Summed across members, because a pack is loaded all at once.
    total_estimated_vram_mb: int
    total_estimated_ram_mb: int
    context_length: int
    #: GREEN/YELLOW/RED, or null when no hardware scan has run yet.
    compatibility: str | None
    recommended_backend: str | None
    downloaded_count: int
    member_count: int


class PacksResponse(BaseModel):
    packs: list[PackResponse]
    #: The pack to lead with on this machine — the most capable one that fits.
    recommended_pack_id: str | None
    has_hardware_profile: bool
    is_mock_hardware: bool


class PackDownloadResponse(BaseModel):
    pack_id: str
    #: Download jobs started for members that were missing.
    queued_model_ids: list[str]
    #: Members already on disk, skipped rather than re-fetched.
    already_downloaded_model_ids: list[str]
    job_ids: list[str]
